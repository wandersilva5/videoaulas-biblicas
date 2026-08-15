import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, unlink, rename, rm } from 'node:fs/promises';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { join, dirname, basename, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { slugDe, hashDe, esc, MIME, itensDoRoteiro, limparProjetosAntigosHtmlVideo, qwenEnv, truncarMaterial, MATERIAL_MAX_CHARS, imagemPromptIntro, imagemPromptConclusao } from './util.mjs';
import { extrairTextoPDF } from './pdf_texto.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS_DIR, '..');
const WEB_DIR = join(ROOT, 'web');
const OUTPUT_DIR = join(ROOT, 'output');
const PDFS_DIR = join(ROOT, 'pdfs');
const CONFIG_PATH = join(ROOT, '.config.json');

const DEFAULTS = {
  LLAMA_URL: 'http://127.0.0.1:8091',
  COMFY_URL: 'http://127.0.0.1:8188',
  COMFY_OUTPUT_DIR: 'D:\\ComfyUI_windows_portable\\ComfyUI\\output',
  ANIMA_UNET: 'anima\\animeStudio_v4Anima.safetensors',
  ANIMA_CLIP: 'qwen\\qwen_3_06b_base.safetensors',
  ANIMA_VAE: 'qwen_image_vae.safetensors',
  ANIMA_LORA: 'Anima\\minimalistflat-000006.safetensors',
  VOZ: 'pt-BR-AntonioNeural',
  PORTA: '5176',
  LLAMA_EXE: 'E:\\llama.cpp\\llama-server.exe',
  LLAMA_MODEL: 'E:\\llama.cpp\\models\\Qwen2.5-7B-Instruct.Q5_K_M.gguf',
  COMFY_DIR: 'D:\\ComfyUI_windows_portable',
};

async function carregarConfig() {
  const doArquivo = await (async () => {
    try {
      return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    } catch {
      return {};
    }
  })();
  const cfg = { ...DEFAULTS, ...doArquivo };
  if (process.env.PORTA) cfg.PORTA = process.env.PORTA;
  return cfg;
}

let CONFIG = await carregarConfig();

async function salvarConfig() {
  await writeFile(CONFIG_PATH, JSON.stringify(CONFIG, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Fila de eventos (SSE)
// ---------------------------------------------------------------------------
const clientes = new Set();

function broadcast(msg) {
  const payload = `event: progresso\ndata: ${JSON.stringify(msg)}\n\n`;
  for (const res of clientes) {
    try {
      res.write(payload);
    } catch {
      /* cliente caiu */
    }
  }
}

// ---------------------------------------------------------------------------
// Executor de jobs (um por vez)
// ---------------------------------------------------------------------------
let jobAtual = null;
let ultimoJob = null;

function cancelarJob() {
  if (!jobAtual) return { cancelado: false, erro: 'Nenhum job em execução' };
  const j = jobAtual;
  j.cancelado = true;
  broadcast({ jobId: j.jobId, etapa: j.etapa, tipo: 'erro', linha: 'Cancelado pelo usuário. Encerrando processo...', ts: Date.now() });
  try {
    j.child.kill();
  } catch {
    /* processo já encerrado */
  }
  return { cancelado: true, etapa: j.etapa };
}

/** Estado do job para o frontend: job ativo (com horário de início) + último resultado. */
function estadoDoJob() {
  return {
    ativo: !!jobAtual,
    etapa: jobAtual?.etapa ?? null,
    jobId: jobAtual?.jobId ?? null,
    iniciadoEm: jobAtual?.iniciadoEm ?? null,
    ultimo: ultimoJob,
  };
}

const statusDeErroJob = (e) =>
  e.code === 'JOB_ATIVO' ? 409 : e.code === 'JOB_CANCELADO' ? 499 : 500;

function runJob({ etapa, args, env = {} }) {
  return new Promise((resolve, reject) => {
    if (jobAtual) {
      const err = new Error(`Já existe um job em execução (${jobAtual.etapa}). Aguarde terminar.`);
      err.code = 'JOB_ATIVO';
      reject(err);
      return;
    }
    const jobId = `${etapa}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const iniciadoEm = Date.now();
    const emit = (tipo, linha) => broadcast({ jobId, etapa, tipo, linha, ts: Date.now(), iniciadoEm });
    const child = spawn(process.execPath, args, { env: { ...process.env, ...CONFIG, ...env } });
    jobAtual = { jobId, etapa, child, cancelado: false, iniciadoEm };
    let stdout = '';
    let stderr = '';
    emit('inicio', `Iniciando etapa: ${etapa} ...`);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      for (const raw of d.toString().split(/\r?\n/)) {
        const l = raw.trim();
        if (!l) continue;
        const m = /^(\d{1,3})%\s+(.*)$/.exec(l);
        if (m) emit('progress', m[2].trim() + ` (${m[1]}%)`);
        else {
          const pm = /^\[([^\]]+?)\s+(\d+)\/(\d+)\]\s*(.*)$/.exec(l);
          if (pm) {
            const pct = Math.round((Number(pm[2]) / Number(pm[3])) * 100);
            emit('progress', `${pm[1]} ${pm[2]}/${pm[3]}${pm[4] ? ' · ' + pm[4].trim() : ''} (${pct}%)`);
          } else if (/erro/i.test(l)) emit('erro', l);
          else if (/OK:/.test(l)) emit('ok', l);
          else emit('log', l);
        }
      }
    });
    child.on('error', (err) => {
      jobAtual = null;
      ultimoJob = { jobId, etapa, ok: false, cancelado: false, terminadoEm: Date.now(), erro: err.message };
      emit('erro', `Falha ao iniciar processo: ${err.message}`);
      broadcast({ jobId, etapa, tipo: 'fim', ok: false, ts: Date.now() });
      reject(err);
    });
    child.on('exit', (code) => {
      const j = jobAtual;
      jobAtual = null;
      const cancelado = j?.cancelado === true;
      ultimoJob = { jobId, etapa, ok: code === 0 && !cancelado, cancelado, terminadoEm: Date.now() };
      let resultado = null;
      try {
        resultado = JSON.parse(stdout.trim());
      } catch {
        /* stdout não é JSON */
      }
      broadcast({ jobId, etapa, tipo: 'fim', ok: code === 0 && !cancelado, cancelado, resultado, ts: Date.now() });
      if (cancelado) {
        const err = new Error(`Job ${etapa} cancelado pelo usuário.`);
        err.code = 'JOB_CANCELADO';
        reject(err);
        return;
      }
      if (code === 0) {
        resolve(resultado ?? {});
      } else {
        const stderrSummary = stderr.trim().split(/\r?\n/).slice(-20).join('\n');
        const err = new Error(
          stderrSummary || `Etapa ${etapa} falhou (código ${code})`,
        );
        err.code = 'JOB_FALHOU';
        err.stderr = stderr; // stderr completo para debug
        err.stdout = stdout;
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Leitura do roteiro e artefatos
// ---------------------------------------------------------------------------
async function lerRoteiro(slug) {
  return JSON.parse(await readFile(join(OUTPUT_DIR, slug, 'roteiro.json'), 'utf8'));
}

async function lerManifesto(slug) {
  try {
    return JSON.parse(await readFile(join(OUTPUT_DIR, slug, 'manifesto.json'), 'utf8'));
  } catch {
    return { audio: {}, imagem: {} };
  }
}

async function salvarManifesto(slug, manifest) {
  await writeFile(join(OUTPUT_DIR, slug, 'manifesto.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

const mtimeDe = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
};

async function artefatos(slug) {
  const roteiro = await lerRoteiro(slug);
  const outDir = join(OUTPUT_DIR, slug);
  const manifest = await lerManifesto(slug);
  const itens = itensDoRoteiro(roteiro);
  const roteiroMtime = mtimeDe(join(outDir, 'roteiro.json'));

  const audioDe = (item) => {
    const p = join(outDir, `${item.prefix}-narracao.mp3`);
    const esperado = manifest.audio?.[item.id];
    return {
      existe: existsSync(p),
      mtime: mtimeDe(p),
      desatualizado: esperado ? esperado !== hashDe(item.texto) : false,
    };
  };

  const imagemDe = (id, p, prompt) => {
    const esperado = manifest.imagem?.[id];
    return {
      existe: existsSync(p),
      mtime: mtimeDe(p),
      desatualizado: esperado ? esperado !== hashDe(prompt) : false,
    };
  };

  const pad = (n) => String(n).padStart(2, '0');
  const introImg = join(outDir, 'slide-00.png');
  const conclImg = join(outDir, `slide-${pad(roteiro.slides.length + 1)}.png`);

  const slides = roteiro.slides.map((s, i) => {
    const item = itens[i + 1];
    const img = join(outDir, `slide-${pad(i + 1)}.png`);
    return {
      id: s.id,
      idx: i + 1,
      titulo: s.titulo,
      imagem: imagemDe(s.id, img, s.imagem_prompt),
      audio: audioDe(item),
    };
  });

  const intro = {
    ...audioDe(itens[0]),
    imagem: imagemDe('intro', introImg, imagemPromptIntro(roteiro)),
  };
  const conclusao = {
    ...audioDe(itens[itens.length - 1]),
    imagem: imagemDe('conclusao', conclImg, imagemPromptConclusao(roteiro)),
  };

  const todosVideos = (await readdir(outDir))
    .filter((f) => f.toLowerCase().endsWith('.mp4'));

  const videosPrincipais = todosVideos
    .filter((f) => !f.includes('-questionario-'))
    .map((f) => {
      const p = join(outDir, f);
      return { arquivo: f, mtime: mtimeDe(p), tamanho: existsSync(p) ? statSync(p).size : 0 };
    })
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  const ultimoPrincipal = videosPrincipais[0] ?? null;

  const videosQuiz = todosVideos
    .filter((f) => f.includes('-questionario-'))
    .map((f) => {
      const p = join(outDir, f);
      return { arquivo: f, mtime: mtimeDe(p), tamanho: existsSync(p) ? statSync(p).size : 0 };
    })
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  const ultimoQuiz = videosQuiz[0] ?? null;

  const questionarioPath = join(outDir, 'questionario.json');
  const perguntasQuiz = await (async () => {
    if (!existsSync(questionarioPath)) return [];
    try {
      const q = JSON.parse(await readFile(questionarioPath, 'utf8'));
      return (q.perguntas || []).map((p, i) => {
        const prefix = `q${String(i + 1).padStart(2, '0')}`;
        const audioP = join(outDir, `${prefix}-pergunta-narracao.mp3`);
        const audioR = join(outDir, `${prefix}-resposta-narracao.mp3`);
        return {
          id: p.id,
          numero: i + 1,
          tema: p.tema,
          pergunta_audio: {
            id: `${prefix}-pergunta`,
            existe: existsSync(audioP),
            mtime: mtimeDe(audioP),
          },
          resposta_audio: {
            id: `${prefix}-resposta`,
            existe: existsSync(audioR),
            mtime: mtimeDe(audioR),
          },
        };
      });
    } catch {
      return [];
    }
  })();

  const pdfPath = join(PDFS_DIR, `${slug}-estudo.pdf`);
  return {
    slug,
    roteiroMtime,
    intro,
    slides,
    conclusao,
    video: {
      existe: !!ultimoPrincipal,
      mtime: ultimoPrincipal?.mtime ?? null,
      tamanho: ultimoPrincipal?.tamanho ?? 0,
      arquivo: ultimoPrincipal?.arquivo ?? null,
    },
    videos: videosPrincipais,
    questionario: {
      existe: !!ultimoQuiz,
      mtime: ultimoQuiz?.mtime ?? null,
      tamanho: ultimoQuiz?.tamanho ?? 0,
      arquivo: ultimoQuiz?.arquivo ?? null,
      perguntas: perguntasQuiz,
    },
    pdf: {
      existe: existsSync(pdfPath),
      mtime: mtimeDe(pdfPath),
      tamanho: existsSync(pdfPath) ? statSync(pdfPath).size : 0,
      arquivo: `${slug}-estudo.pdf`,
    },
    audioCompleto: [itens[0], ...itens.slice(1, -1), itens[itens.length - 1]].every((it) => audioDe(it).existe),
    imagensCompletas: [intro, ...slides, conclusao].every((x) => x.imagem.existe),
  };
}

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------
async function lerBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function arquivo(res, path) {
  if (!existsSync(path)) {
    json(res, 404, { erro: 'Arquivo não encontrado' });
    return;
  }
  const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  createReadStream(path).pipe(res);
}

function dentroDe(base, alvo) {
  const rel = resolve(base).length + 1;
  return resolve(alvo).startsWith(resolve(base) + sep) || resolve(alvo) === resolve(base);
}

function ehSlugValido(s) {
  return /^[a-z0-9-]+$/.test(s);
}

async function limparProjetosHtmlVideo(slug) {
  const projDir = join(ROOT, '.html-video', 'projects');
  if (!existsSync(projDir)) return 0;
  const dirs = await readdir(projDir, { withFileTypes: true });
  let removidos = 0;
  const ehDaAula = (pth) => {
    const s = String(pth ?? '');
    return s.includes(`output\\${slug}\\`) || s.includes(`output/${slug}/`);
  };
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pj = join(projDir, d.name, 'project.json');
    if (!existsSync(pj)) continue;
    try {
      const p = JSON.parse(await readFile(pj, 'utf8'));
      const caminhos = [p.lastOutputMp4Path, ...(p.exports || []).map((e) => e.path)].filter(Boolean);
      if (caminhos.some(ehDaAula)) {
        await rm(join(projDir, d.name), { recursive: true, force: true });
        removidos++;
      }
    } catch {
      /* projeto ilegível — ignora */
    }
  }
  return removidos;
}

async function listarAulas() {
  if (!existsSync(OUTPUT_DIR)) return [];
  const dirs = (await readdir(OUTPUT_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
  const aulas = [];
  for (const d of dirs) {
    const rp = join(OUTPUT_DIR, d.name, 'roteiro.json');
    if (!existsSync(rp)) continue;
    try {
      const roteiro = JSON.parse(await readFile(rp, 'utf8'));
      const st = await artefatos(d.name);
      aulas.push({
        slug: d.name,
        topico: roteiro.topico || roteiro.titulo_aula,
        titulo_aula: roteiro.titulo_aula,
        slides: roteiro.slides.length,
        audioCompleto: st.audioCompleto,
        imagensCompletas: st.imagensCompletas,
        videoPronto: st.video.existe,
        pdfPronto: st.pdf.existe,
        thumbnail: existsSync(join(OUTPUT_DIR, d.name, 'slide-01.png')) ? `/media/${d.name}/slide-01.png` : null,
      });
    } catch (e) {
      console.error(`[listarAulas] Erro ao ler ${d.name}/roteiro.json:`, e.message);
    }
  }
  aulas.sort((a, b) => (a.slug < b.slug ? 1 : -1));
  return aulas;
}

// ---------------------------------------------------------------------------
// Health check dos serviços externos (GET /api/health)
// ---------------------------------------------------------------------------
const NOMES_SERVICO = {
  llama: 'llama-server (roteiro/enriquecimento)',
  comfy: 'ComfyUI (imagens)',
  qwen: 'Qwen3-TTS (narração)',
  ffmpeg: 'ffmpeg (vídeo)',
  ffprobe: 'ffprobe (vídeo)',
  chromium: 'Chromium (Playwright)',
};

function checarHttp(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    fetch(url, { signal: ctl.signal })
      .then((r) => resolve({ ok: r.status < 500, erro: r.ok ? null : `HTTP ${r.status}`, versao: null }))
      .catch((e) =>
        resolve({ ok: false, erro: e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message, versao: null }),
      )
      .finally(() => clearTimeout(t));
  });
}

function checarComando(nome, args = [], maxMs = 8000) {
  return new Promise((resolve) => {
    let proc = null;
    const t = setTimeout(() => {
      proc?.kill();
      resolve({ ok: false, erro: 'timeout', versao: null });
    }, maxMs);
    proc = spawn(nome, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    proc.stdout.on('data', (d) => (saida += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, erro: e.code || e.message, versao: null });
    });
    proc.on('exit', (code) => {
      clearTimeout(t);
      const primeira = saida.trim().split(/\r?\n/)[0] || null;
      resolve({ ok: code === 0, erro: code === 0 ? null : `exit ${code}`, versao: primeira });
    });
  });
}

async function checarChromium() {
  try {
    const { chromium } = await import('playwright');
    const exe = chromium.executablePath();
    if (!exe || !existsSync(exe)) return { ok: false, erro: 'chromium não instalado no cache do Playwright', versao: null };
    return { ok: true, erro: null, versao: basename(dirname(exe)) };
  } catch (e) {
    return { ok: false, erro: e.message, versao: null };
  }
}

/** Qwen3-TTS (clone de voz): engine GGUF, voz de referência e python importável. */
function checarQwen() {
  const QWEN = qwenEnv({ ...process.env, ...CONFIG });
  const engineDir = join(QWEN.QWEN_ROOT, QWEN.QWEN_MODEL || 'model-base');
  if (!existsSync(engineDir)) {
    return Promise.resolve({ ok: false, erro: `engine não encontrada em ${engineDir}`, versao: null });
  }
  if (!existsSync(QWEN.QWEN_REF)) {
    return Promise.resolve({ ok: false, erro: `voz de referência não encontrada: ${QWEN.QWEN_REF}`, versao: null });
  }
  return new Promise((resolve) => {
    const py = [
      'import sys;',
      `sys.path.insert(0, ${JSON.stringify(QWEN.QWEN_ROOT)});`,
      'from qwen3_tts_gguf.inference import TTSEngine, TTSConfig;',
      'print("import ok")',
    ].join('');
    let proc = null;
    const t = setTimeout(() => {
      proc?.kill();
      resolve({ ok: false, erro: 'timeout', versao: null });
    }, 30000);
    proc = spawn(QWEN.QWEN_PYTHON, ['-c', py], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...CONFIG, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let saida = '';
    proc.stdout.on('data', (d) => (saida += d.toString()));
    proc.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, erro: e.code || e.message, versao: null });
    });
    proc.on('exit', (code) => {
      clearTimeout(t);
      const primeira = saida.trim().split(/\r?\n/)[0] || null;
      resolve({ ok: code === 0, erro: code === 0 ? null : 'python não importou a engine (veja QWEN_ROOT/PYTHON)', versao: primeira });
    });
  });
}

async function statusDosServicos() {
  const llmBase = String(CONFIG.LLAMA_URL || '').replace(/\/+$/, '');
  const comfyBase = String(CONFIG.COMFY_URL || '').replace(/\/+$/, '');
  const [llama, comfy, qwen, ffmpeg, ffprobe, chromium] = await Promise.all([
    checarHttp(`${llmBase}/v1/models`),
    checarHttp(`${comfyBase}/system_stats`),
    checarQwen(),
    checarComando('ffmpeg', ['-version']),
    checarComando('ffprobe', ['-version']),
    checarChromium(),
  ]);
  const servicos = { llama, comfy, qwen, ffmpeg, ffprobe, chromium };
  const nomes = Object.keys(servicos);
  return {
    ok: nomes.every((k) => servicos[k].ok),
    checado_em: new Date().toISOString(),
    servicos: Object.fromEntries(nomes.map((k) => [k, { ...servicos[k], rotulo: NOMES_SERVICO[k] }])),
  };
}

let healthCache = { ts: 0, dados: null };
let healthEmAndamento = null;

async function rotaHealth() {
  const agora = Date.now();
  if (healthCache.dados && agora - healthCache.ts < 8000) return healthCache.dados;
  if (!healthEmAndamento) {
    healthEmAndamento = statusDosServicos()
      .then((dados) => {
        healthCache = { ts: Date.now(), dados };
        return dados;
      })
      .finally(() => {
        healthEmAndamento = null;
      });
  }
  return healthEmAndamento;
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // ---- SSE de progresso ----
    if (path === '/api/progresso' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('event: pronto\ndata: {}\n\n');
      clientes.add(res);
      const hb = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(hb);
        }
      }, 25000);
      req.on('close', () => {
        clearInterval(hb);
        clientes.delete(res);
      });
      return;
    }

    // ---- PDFs de estudo (pdfs/) ----
    if (path.startsWith('/pdfs/')) {
      const [, , fname] = path.split('/');
      if (!fname || fname.includes('/')) return json(res, 400, { erro: 'Caminho inválido' });
      const alvo = join(PDFS_DIR, basename(fname));
      if (!dentroDe(PDFS_DIR, alvo)) return json(res, 400, { erro: 'Caminho inválido' });
      return arquivo(res, alvo);
    }

    // ---- Arquivos de mídia (output/<slug>/...) ----
    if (path.startsWith('/media/')) {
      const [, , slug, ...resto] = path.split('/');
      if (!ehSlugValido(slug) || resto.length !== 1) return json(res, 400, { erro: 'Caminho inválido' });
      const alvo = join(OUTPUT_DIR, slug, basename(resto[0]));
      if (!dentroDe(OUTPUT_DIR, alvo)) return json(res, 400, { erro: 'Caminho inválido' });
      return arquivo(res, alvo);
    }

    // ---- Estáticos (web/) ----
    if (path === '/' || path.startsWith('/api/') === false) {
      const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
      const alvo = join(WEB_DIR, rel);
      if (dentroDe(WEB_DIR, alvo) && existsSync(alvo) && !statSync(alvo).isDirectory()) {
        return arquivo(res, alvo);
      }
      return arquivo(res, join(WEB_DIR, 'index.html'));
    }

    // ---- API ----
    const m = path.match(/^\/api\/([^/]+)(?:\/([^/]+))?$/);
    if (!m) return json(res, 404, { erro: 'Rota não encontrada' });
    const recurso = m[1];
    const slug = m[2] ?? '';

    if (recurso === 'aulas' && req.method === 'GET') {
      return json(res, 200, await listarAulas());
    }

    // --- DELETE /api/aulas/:slug — apaga aula e artefatos derivados ---
    if (recurso === 'aulas' && req.method === 'DELETE') {
      if (!slug || !ehSlugValido(slug)) return json(res, 400, { erro: 'Slug inválido' });
      const outDir = join(OUTPUT_DIR, slug);
      if (!existsSync(outDir)) return json(res, 404, { erro: 'Aula não encontrada' });
      const pdf = join(PDFS_DIR, `${slug}-estudo.pdf`);
      await rm(outDir, { recursive: true, force: true });
      if (existsSync(pdf)) await rm(pdf, { force: true });
      const projetos = await limparProjetosHtmlVideo(slug);
      console.error(`[aulas] Excluída "${slug}" (${projetos} projeto(s) de render removidos)`);
      return json(res, 200, { ok: true, removidos_html_video: projetos });
    }

    if (recurso === 'config') {
      if (req.method === 'GET') return json(res, 200, CONFIG);
      if (req.method === 'PUT') {
        const body = await lerBody(req);
        CONFIG = { ...CONFIG, ...body };
        await salvarConfig();
        return json(res, 200, CONFIG);
      }
    }

    if (recurso === 'health' && req.method === 'GET') {
      return json(res, 200, await rotaHealth());
    }

    // --- Cancelamento de job em execução ---
    if (recurso === 'cancelar-job' && req.method === 'POST') {
      return json(res, 200, cancelarJob());
    }

    // --- Estado do job (ativo + último resultado) — permite o frontend saber
    //     que há um job rodando mesmo após recarregar a página ---
    if (recurso === 'job' && req.method === 'GET') {
      return json(res, 200, estadoDoJob());
    }

    // --- Roteiro (POST cria nova aula — não tem slug ainda) ---
    if (recurso === 'roteiro' && req.method === 'POST') {
      const body = await lerBody(req);
      if (!body.topico) return json(res, 400, { erro: 'Campo "topico" é obrigatório' });
      const novoSlug = slugDe(body.topico);
      const args = [join(SCRIPTS_DIR, 'gerar_roteiro.mjs'), body.topico];
      let material = typeof body.material === 'string' && body.material.trim() ? body.material : null;
      let pdfExtraido = null;

      // Upload de PDF: decodifica base64, valida assinatura, extrai o texto e
      // usa-o como material de apoio para a geração do roteiro.
      if (body.pdf && (body.pdf.base64 || body.pdf.nome)) {
        const base64 = String(body.pdf.base64 || '')
          .trim()
          .replace(/^data:application\/pdf;base64,/i, '');
        if (!base64) return json(res, 400, { erro: 'base64 do PDF ausente no campo "pdf.base64"' });
        const bytes = Buffer.from(base64, 'base64');
        if (bytes.length < 8 || bytes.toString('latin1', 0, 5) !== '%PDF-') {
          return json(res, 400, { erro: 'O arquivo enviado não é um PDF válido (assinatura %PDF ausente).' });
        }
        const outDir = join(OUTPUT_DIR, novoSlug);
        await mkdir(outDir, { recursive: true });
        const pdfPath = join(outDir, 'fonte.pdf');
        await writeFile(pdfPath, bytes);
        let extraido;
        try {
          extraido = extrairTextoPDF(pdfPath);
        } catch (e) {
          return json(res, 400, { erro: `Não foi possível ler o texto do PDF: ${e.message}` });
        }
        if (!extraido.texto.trim()) {
          return json(res, 400, { erro: 'Nenhum texto foi extraído do PDF (pode ser escaneado, só imagem).' });
        }
        material = extraido.texto;
        pdfExtraido = {
          arquivo: 'fonte.pdf',
          paginas: extraido.paginas,
          caracteres: extraido.caracteres,
        };
      }

      if (material) {
        const outDir = join(OUTPUT_DIR, novoSlug);
        await mkdir(outDir, { recursive: true });
        if (material.length > MATERIAL_MAX_CHARS) {
          console.error(`[roteiro] material truncado de ${material.length} para ${MATERIAL_MAX_CHARS} caracteres (${novoSlug})`);
          material = truncarMaterial(material, MATERIAL_MAX_CHARS);
        }
        await writeFile(join(outDir, 'material.txt'), material, 'utf8');
        args.push('--material', join(outDir, 'material.txt'));
      }

      try {
        await runJob({ etapa: 'roteiro', args });
      } catch (e) {
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      const roteiro = await lerRoteiro(novoSlug);
      return json(res, 200, { slug: novoSlug, roteiro, pdf: pdfExtraido });
    }

    if (!slug || !ehSlugValido(slug)) return json(res, 400, { erro: 'Slug inválido' });
    const roteiroPath = join(OUTPUT_DIR, slug, 'roteiro.json');

    if (recurso === 'roteiro' && req.method === 'GET') {
      if (!existsSync(roteiroPath)) return json(res, 404, { erro: 'Roteiro não existe' });
      return json(res, 200, await lerRoteiro(slug));
    }

    if (recurso === 'roteiro' && req.method === 'PUT') {
      const body = await lerBody(req);
      if (!body.titulo_aula || !Array.isArray(body.slides)) {
        return json(res, 400, { erro: 'Roteiro inválido: faltam "titulo_aula" ou "slides"' });
      }
      body.slug = slug;
      if (!body.topico) body.topico = body.titulo_aula;
      await writeFile(roteiroPath, JSON.stringify(body, null, 2), 'utf8');
      return json(res, 200, body);
    }

    // --- Artefatos ---
    if (recurso === 'artefatos' && req.method === 'GET') {
      if (!existsSync(roteiroPath)) return json(res, 404, { erro: 'Roteiro não existe' });
      return json(res, 200, await artefatos(slug));
    }

    // --- Imagens ---
    if (recurso === 'imagens' && req.method === 'POST') {
      const body = await lerBody(req);
      const roteiro = await lerRoteiro(slug);
      const outDir = join(OUTPUT_DIR, slug);
      const padImg = (n) => `slide-${String(n).padStart(2, '0')}.png`;
      const itemDeImagem = (id) => {
        if (id === 'intro') return { prompt: imagemPromptIntro(roteiro), arquivo: padImg(0) };
        if (id === 'conclusao') return { prompt: imagemPromptConclusao(roteiro), arquivo: padImg(roteiro.slides.length + 1) };
        const idx = roteiro.slides.findIndex((s) => s.id === id);
        if (idx === -1) return null;
        return { prompt: roteiro.slides[idx].imagem_prompt, arquivo: padImg(idx + 1) };
      };
      const backups = [];
      const backupDe = async (arquivo) => {
        const png = join(outDir, arquivo);
        if (existsSync(png)) {
          const bak = png + '.bak';
          await rename(png, bak);
          backups.push({ original: png, backup: bak });
        }
      };
      if (body.slideId) {
        const item = itemDeImagem(body.slideId);
        if (!item) return json(res, 400, { erro: `Item "${body.slideId}" não encontrado` });
        await backupDe(item.arquivo);
      } else if (body.recriarTodos) {
        await backupDe(padImg(0));
        for (let i = 0; i < roteiro.slides.length; i++) await backupDe(padImg(i + 1));
        await backupDe(padImg(roteiro.slides.length + 1));
      }
      const env = body.variar ? { KREA2_SEED_BASE: String(Math.floor(Math.random() * 1e9)) } : {};
      try {
        await runJob({ etapa: 'imagens', args: [join(SCRIPTS_DIR, 'gerar_imagens.mjs'), roteiroPath], env });
        for (const { backup } of backups) {
          if (existsSync(backup)) await unlink(backup);
        }
      } catch (e) {
        for (const { original, backup } of backups) {
          if (existsSync(backup)) await rename(backup, original);
        }
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      const manifest = await lerManifesto(slug);
      const alvos = body.slideId
        ? [body.slideId]
        : ['intro', ...roteiro.slides.map((s) => s.id), 'conclusao'];
      for (const id of alvos) {
        const item = itemDeImagem(id);
        if (item) manifest.imagem[id] = hashDe(item.prompt);
      }
      await salvarManifesto(slug, manifest);
      return json(res, 200, { ok: true });
    }

    // --- Narração ---
    if (recurso === 'narracao' && req.method === 'POST') {
      const body = await lerBody(req);
      const roteiro = await lerRoteiro(slug);
      const args = [join(SCRIPTS_DIR, 'gerar_narracao.mjs'), roteiroPath];
      if (body.slideId) args.push('--apenas', body.slideId);
      else if (body.todos) args.push('--todos');
      try {
        await runJob({ etapa: 'narracao', args });
      } catch (e) {
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      const manifest = await lerManifesto(slug);
      const itens = itensDoRoteiro(roteiro);
      const alvos = body.slideId ? [body.slideId] : itens.map((it) => it.id);
      for (const id of alvos) {
        const it = itens.find((x) => x.id === id);
        if (it) manifest.audio[id] = hashDe(it.texto);
      }
      await salvarManifesto(slug, manifest);
      return json(res, 200, { ok: true });
    }

    // --- Narração: apagar áudio(s) ---
    if (recurso === 'narracao' && req.method === 'DELETE') {
      const body = await lerBody(req);
      const roteiro = await lerRoteiro(slug);
      const outDir = join(OUTPUT_DIR, slug);
      const itens = itensDoRoteiro(roteiro);
      const alvos = body.slideId ? itens.filter((it) => it.id === body.slideId) : itens;
      if (body.slideId && alvos.length === 0) {
        return json(res, 400, { erro: `Item "${body.slideId}" não encontrado` });
      }
      let removidos = 0;
      for (const it of alvos) {
        const mp3 = join(outDir, `${it.prefix}-narracao.mp3`);
        const tmp = join(outDir, `${it.prefix}-narracao.tmp.wav`);
        if (existsSync(mp3)) { await unlink(mp3); removidos++; }
        if (existsSync(tmp)) await unlink(tmp);
      }
      const manifest = await lerManifesto(slug);
      for (const it of alvos) delete manifest.audio[it.id];
      await salvarManifesto(slug, manifest);
      return json(res, 200, { ok: true, removidos });
    }

    // --- Vídeo ---
    if (recurso === 'video' && req.method === 'POST') {
      const body = await lerBody(req);
      if (!existsSync(roteiroPath)) return json(res, 404, { erro: 'Roteiro não existe' });
      const st = await artefatos(slug);
      const faltando = [];
      if (!st.imagensCompletas) faltando.push('imagens de todos os slides');
      if (!st.audioCompleto) faltando.push('narrações de todos os itens');
      if (faltando.length) {
        return json(res, 400, { erro: `Faltam artefatos: ${faltando.join(' e ')}. Gere-os antes de montar o vídeo.` });
      }
      const env = {
        VIDEO_FPS: String(body.fps ?? 24),
        VIDEO_WIDTH: String(body.width ?? 1920),
        VIDEO_HEIGHT: String(body.height ?? 1080),
        VIDEO_PADDING: String(body.padding ?? 0.3),
      };
      try {
        await runJob({ etapa: 'video', args: [join(SCRIPTS_DIR, 'montar_video.mjs'), roteiroPath], env });
      } catch (e) {
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      const arquivo = `${slug}-${String(body.width ?? 1920)}x${String(body.height ?? 1080)}.mp4`;
      return json(res, 200, { ok: true, output_path: arquivo, url: `/media/${slug}/${arquivo}` });
    }

    // --- PDF de estudo ---
    if (recurso === 'pdf' && req.method === 'POST') {
      if (!existsSync(roteiroPath)) return json(res, 404, { erro: 'Roteiro não existe' });
      const body = await lerBody(req);
      if (body.regenerarEnriquecimento) {
        try {
          await unlink(join(OUTPUT_DIR, slug, 'enriquecimento.json'));
          console.error(`[pdf] cache de enriquecimento removido (${slug})`);
        } catch {
          /* cache não existia */
        }
      }
      try {
        await runJob({ etapa: 'pdf', args: [join(SCRIPTS_DIR, 'gerar_pdf.mjs'), roteiroPath] });
      } catch (e) {
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      const arquivo = `${slug}-estudo.pdf`;
      return json(res, 200, { ok: true, arquivo, url: `/pdfs/${arquivo}` });
    }

    // --- Questionário (Quiz) ---
    if (recurso === 'questionario' && req.method === 'POST') {
      if (!existsSync(roteiroPath)) return json(res, 404, { erro: 'Roteiro não existe' });
      try {
        await runJob({ etapa: 'questionario', args: [join(SCRIPTS_DIR, 'pipeline_questionario.mjs'), roteiroPath] });
      } catch (e) {
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      return json(res, 200, { ok: true });
    }

    // --- Questionário: remontar vídeo com os áudios atuais (sem regenerar perguntas/narração) ---
    if (recurso === 'video-questionario' && req.method === 'POST') {
      const body = await lerBody(req);
      const questionarioPath = join(OUTPUT_DIR, slug, 'questionario.json');
      if (!existsSync(questionarioPath)) {
        return json(res, 400, { erro: 'Questionário não existe. Gere-o primeiro.' });
      }
      const st = await artefatos(slug);
      const faltando = (st.questionario?.perguntas || [])
        .filter((p) => !p.pergunta_audio.existe || !p.resposta_audio.existe)
        .map((p) => `Pergunta ${p.numero}`);
      if (faltando.length) {
        return json(res, 400, { erro: `Faltam áudios das ${faltando.join(', ')}. Regene-os antes de remontar o vídeo.` });
      }
      const env = {
        VIDEO_FPS: String(body.fps ?? 24),
        VIDEO_WIDTH: String(body.width ?? 1920),
        VIDEO_HEIGHT: String(body.height ?? 1080),
      };
      try {
        await runJob({ etapa: 'questionario', args: [join(SCRIPTS_DIR, 'montar_video_questionario.mjs'), roteiroPath], env });
      } catch (e) {
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      const arquivo = `${slug}-questionario-${String(body.width ?? 1920)}x${String(body.height ?? 1080)}.mp4`;
      return json(res, 200, { ok: true, output_path: arquivo, url: `/media/${slug}/${arquivo}` });
    }

    // --- Questionário: regenerar áudios (um item ou todos) ---
    if (recurso === 'narracao-questionario' && req.method === 'POST') {
      const body = await lerBody(req);
      const questionarioPath = join(OUTPUT_DIR, slug, 'questionario.json');
      if (!existsSync(questionarioPath)) {
        return json(res, 400, { erro: 'Questionário não existe. Gere-o primeiro.' });
      }
      const args = [join(SCRIPTS_DIR, 'gerar_narracao_questionario.mjs'), roteiroPath];
      if (body.itemId) args.push('--apenas', body.itemId);
      else if (body.todos) args.push('--todos');
      if (body.variar) args.push('--variar');
      try {
        await runJob({ etapa: 'narracao-questionario', args });
      } catch (e) {
        return json(res, statusDeErroJob(e), { erro: e.message });
      }
      return json(res, 200, { ok: true });
    }

    // --- Questionário: apagar áudios (um item ou todos) ---
    if (recurso === 'narracao-questionario' && req.method === 'DELETE') {
      const body = await lerBody(req);
      const questionarioPath = join(OUTPUT_DIR, slug, 'questionario.json');
      if (!existsSync(questionarioPath)) {
        return json(res, 400, { erro: 'Questionário não existe.' });
      }
      const outDir = join(OUTPUT_DIR, slug);
      const alvos = [];
      if (body.itemId) {
        const m = /^q(\d+)-(pergunta|resposta)$/i.exec(String(body.itemId));
        if (!m) return json(res, 400, { erro: `Item "${body.itemId}" inválido (use q1-pergunta ou q1-resposta)` });
        alvos.push(`q${String(Number(m[1])).padStart(2, '0')}-${m[2]}`);
      } else {
        const q = JSON.parse(await readFile(questionarioPath, 'utf8'));
        for (let i = 0; i < (q.perguntas || []).length; i++) {
          const prefix = `q${String(i + 1).padStart(2, '0')}`;
          alvos.push(`${prefix}-pergunta`, `${prefix}-resposta`);
        }
      }
      let removidos = 0;
      for (const id of alvos) {
        const mp3 = join(outDir, `${id}-narracao.mp3`);
        const tmp = join(outDir, `${id}-narracao.tmp.wav`);
        if (existsSync(mp3)) { await unlink(mp3); removidos++; }
        if (existsSync(tmp)) await unlink(tmp);
      }
      return json(res, 200, { ok: true, removidos });
    }

    return json(res, 404, { erro: 'Rota não encontrada' });
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { erro: e.message });
    res.end();
  }
});

await mkdir(OUTPUT_DIR, { recursive: true });
try {
  const removidos = await limparProjetosAntigosHtmlVideo(ROOT);
  if (removidos > 0) console.error(`[cache] ${removidos} projeto(s) antigo(s) removido(s) de .html-video/projects`);
} catch (e) {
  console.error(`[cache] limpeza de projetos antigos falhou: ${e.message}`);
}
server.listen(Number(CONFIG.PORTA), () => {
  console.log(`Servidor rodando em http://localhost:${CONFIG.PORTA}`);
});
