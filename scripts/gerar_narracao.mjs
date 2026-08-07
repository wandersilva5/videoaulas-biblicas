import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prefixoNarracao, hashDe, qwenEnv } from './util.mjs';
const TTS = process.env.TTS || 'qwen';
const VOZ = process.env.VOZ || 'pt-BR-AntonioNeural';

// Qwen3-TTS (clone de voz local). Padrões vindos de util.mjs (qwenEnv).
const QWEN = qwenEnv();

const ORDINAIS_LIVROS = { '1': 'Primeira', '2': 'Segunda', '3': 'Terceira' };

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** Converte um inteiro (0..999999) para texto por extenso em pt-BR. */
export function numeroPorExtenso(n) {
  n = Math.trunc(Number(n));
  if (Number.isNaN(n) || n < 0 || n >= 1000000) return String(n);
  if (n === 0) return 'zero';
  let s = '';
  if (n >= 1000) {
    const m = Math.floor(n / 1000);
    s += m === 1 ? 'mil' : `${numeroPorExtenso(m)} mil`;
    n %= 1000;
    if (n) s += ' e ';
  }
  if (n >= 100) {
    const c = Math.floor(n / 100);
    s += c === 1 && n !== 100 ? 'cento' : CENTENAS[c];
    n %= 100;
    if (n) s += ' e ';
  }
  if (n > 0) {
    if (n < 10) s += UNIDADES[n];
    else if (n < 20) s += DEZ_A_DEZENOVE[n - 10];
    else {
      const d = Math.floor(n / 10);
      const u = n % 10;
      s += DEZENAS[d];
      if (u) s += ` e ${UNIDADES[u]}`;
    }
  }
  return s;
}

/**
 * Normaliza o texto para o leitor de voz (TTS) pronunciar referências
 * bíblicas e números corretamente, tudo por extenso:
 *   - "1 Timóteo 3:1"      -> "Primeira Timóteo, capítulo três, versículo um"
 *   - "Salmo 111:3"        -> "Salmo, capítulo cento e onze, versículo três"
 *   - "1 Cor 13:4-7"       -> "Primeira Coríntios, capítulo treze, versículo quatro a sete"
 *   - "50 anos"            -> "cinquenta anos"
 * Sem isso o TTS lê "1 Timóteo 3 horas e 1 minuto" ou engole números.
 */
export function normalizarReferenciasParaTts(texto) {
  let t = String(texto ?? '');
  // Numeral do livro -> ordinal (somente antes de nome de livro bíblico)
  t = t.replace(
    /\b([123])\s+(Timóteo|Coríntios|Tessalonicenses|Pedro|João|Joao|Reis|Crônicas|Cronicas|Samuel|Esdras|Macabeus)\b/gi,
    (_, n, livro) => `${ORDINAIS_LIVROS[n]} ${livro}`,
  );
  // capítulo:versículo (com faixa opcional) -> capítulo/versículo por extenso
  t = t.replace(/\b(\d{1,3}):(\d{1,3})(?:\s*-\s*(\d{1,3}))?\b/g, (_, c, v, f) =>
    f
      ? `capítulo ${numeroPorExtenso(c)}, versículo ${numeroPorExtenso(v)} a ${numeroPorExtenso(f)}`
      : `capítulo ${numeroPorExtenso(c)}, versículo ${numeroPorExtenso(v)}`,
  );
  // Qualquer número inteiro restante -> por extenso
  t = t.replace(/\b\d{1,6}\b/g, (m) => numeroPorExtenso(m));
  return t;
}

function tts(texto, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('edge-tts', ['--voice', VOZ, '--text', texto, '--write-media', outPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`edge-tts exit ${code}: ${err.slice(0, 300)}`));
    });
  });
}

/** Roda o bridge Python do Qwen3-TTS (gera WAV 24kHz) e converte para MP3. */
function ttsQwen(texto, outMp3) {
  return new Promise((resolve, reject) => {
    const wavTmp = outMp3.replace(/\.mp3$/, '.tmp.wav');
    const args = [
      join(dirname(fileURLToPath(import.meta.url)), 'qwen_tts_bridge.py'),
      '--texto', texto,
      '--saida', wavTmp,
    ];
    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      QWEN_ROOT: QWEN.QWEN_ROOT,
      QWEN_REF: QWEN.QWEN_REF,
      QWEN_REF_START: QWEN.QWEN_REF_START,
      QWEN_REF_END: QWEN.QWEN_REF_END,
      QWEN_REF_TEXTO: QWEN.QWEN_REF_TEXTO,
      QWEN_MAX_STEPS: QWEN.QWEN_MAX_STEPS,
      QWEN_TEMP: QWEN.QWEN_TEMP,
      QWEN_SUB_TEMP: QWEN.QWEN_SUB_TEMP,
      QWEN_TOP_P: QWEN.QWEN_TOP_P,
      QWEN_TOP_K: QWEN.QWEN_TOP_K,
      QWEN_MIN_P: QWEN.QWEN_MIN_P,
      QWEN_REPEAT_PENALTY: QWEN.QWEN_REPEAT_PENALTY,
      QWEN_SEED: QWEN.QWEN_SEED,
      QWEN_SUB_SEED: QWEN.QWEN_SUB_SEED,
      QWEN_ZERO_SHOT: QWEN.QWEN_ZERO_SHOT,
      QWEN_ONNX_PROVIDER: QWEN.QWEN_ONNX_PROVIDER,
    };
    const proc = spawn(QWEN.QWEN_PYTHON, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let log = '';
    proc.stdout.on('data', (d) => (log += d.toString()));
    proc.stderr.on('data', (d) => (log += d.toString()));
    proc.on('error', reject);
    proc.on('exit', async (code) => {
      try {
        if (code !== 0) throw new Error(`qwen bridge exit ${code}: ${log.slice(0, 500)}`);
        await new Promise((res, rej) => {
          const ff = spawn('ffmpeg', ['-y', '-i', wavTmp, '-codec:a', 'libmp3lame', '-b:a', '128k', outMp3], {
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let ferr = '';
          ff.stderr.on('data', (d) => (ferr += d.toString()));
          ff.on('error', rej);
          ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}: ${ferr.slice(0, 300)}`))));
        });
        try { unlinkSync(wavTmp); } catch { /* já foi limpo */ }
        resolve(outMp3);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** Gera o MP3 de um item com 2 tentativas (falha de GPU é transitória). */
export async function gerarNarracaoItem(item, outDir) {
  const outPath = join(outDir, `${item.prefix}-narracao.mp3`);
  const texto = normalizarReferenciasParaTts(item.texto);
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      console.error(`  [narração] ${item.titulo} ...`);
      if (TTS === 'qwen') {
        await ttsQwen(texto, outPath);
      } else {
        await tts(texto, outPath);
      }
      console.error(`  OK: ${outPath}`);
      return { id: item.id, titulo: item.titulo, path: outPath };
    } catch (e) {
      ultimoErro = e;
      console.error(`  [narração] tentativa ${tentativa}/2 falhou: ${e.message}`);
    }
  }
  throw ultimoErro;
}

export async function gerarNarracao(roteiro, outDir) {
  const narracao = [];
  const textos = [
    { id: 'intro', titulo: 'Introdução', texto: roteiro.introducao },
    ...roteiro.slides.map((s) => ({ id: s.id, titulo: s.titulo, texto: s.narracao })),
    { id: 'conclusao', titulo: 'Conclusão', texto: roteiro.conclusao },
  ];
  const total = textos.length;
  for (let i = 0; i < textos.length; i++) {
    const item = { ...textos[i], prefix: prefixoNarracao(i, total) };
    console.error(`  [narração ${i + 1}/${total}] ${item.titulo} ...`);
    narracao.push(await gerarNarracaoItem(item, outDir));
  }
  return narracao;
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_narracao.mjs <caminho/roteiro.json> [--apenas <id>] [--todos]');
    console.error('  --apenas <id>  regenera só um item: intro, slide-01..., conclusao');
    console.error('  --todos         regenera todos (ignora o manifesto — por padrão pula itens já atualizados)');
    console.error('  TTS= qwen (padrão, clone de voz) | edge-tts (fallback)');
    process.exit(1);
  }
  const apenasIdx = process.argv.indexOf('--apenas');
  const apenas = apenasIdx !== -1 ? process.argv[apenasIdx + 1] : null;
  const todos = process.argv.includes('--todos');
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);
  const textos = [
    { id: 'intro', titulo: 'Introdução', texto: roteiro.introducao },
    ...roteiro.slides.map((s) => ({ id: s.id, titulo: s.titulo, texto: s.narracao })),
    { id: 'conclusao', titulo: 'Conclusão', texto: roteiro.conclusao },
  ];
  const total = textos.length;
  let items = textos.map((t, i) => ({ ...t, prefix: prefixoNarracao(i, total) }));
  if (apenas) {
    items = items.filter((t) => t.id === apenas);
    if (items.length === 0) {
      console.error(`ERRO: item "${apenas}" não encontrado (use: intro, slide-XX ou conclusao)`);
      process.exit(1);
    }
  } else if (!todos) {
    const manifest = await (async () => {
      try {
        return JSON.parse(await readFile(join(outDir, 'manifesto.json'), 'utf8'));
      } catch {
        return { audio: {} };
      }
    })();
    const filtrados = [];
    for (const item of items) {
      const mp3 = join(outDir, `${item.prefix}-narracao.mp3`);
      const atualizado = existsSync(mp3) && manifest.audio?.[item.id] === hashDe(item.texto);
      if (atualizado) {
        console.error(`  OK: ${item.prefix}-narracao.mp3 já atualizado — pulando (${item.titulo})`);
      } else {
        filtrados.push(item);
      }
    }
    items = filtrados;
  }
  if (items.length === 0) {
    console.error('[3/4] Nenhuma narração precisa ser gerada — tudo atualizado no manifesto.');
    console.log(JSON.stringify([]));
    return;
  }
  console.error(`[3/4] Gerando ${items.length} arquivo(s) de narração ...`);
  const narracao = [];
  for (const item of items) narracao.push(await gerarNarracaoItem(item, outDir));
  console.log(JSON.stringify(narracao));
}

if (process.argv[1]) {
  const scriptPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  const argPath = process.argv[1].replace(/\\/g, '/');
  if (scriptPath === argPath) {
    main().catch((e) => {
      console.error('ERRO:', e.message);
      process.exit(1);
    });
  }
}
