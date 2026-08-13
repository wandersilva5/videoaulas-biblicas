/**
 * util.mjs — Helpers compartilhados entre os scripts (fonte única de verdade).
 */
import { createHash } from 'node:crypto';
import { readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Nome do modelo (id da API) usado nas chamadas ao llama-server.
 * Precedência: env `LLAMA_MODELO` → basename de `LLAMA_MODEL` (caminho do
 * arquivo GGUF, ex.: `E:\llama.cpp\models\Qwen2.5-7B-Instruct.Q5_K_M.gguf`) → padrão
 * `Qwen2.5-7B-Instruct.Q5_K_M.gguf`. O id do llama-server é o nome do arquivo carregado.
 */
export function modeloLLama() {
  return (
    process.env.LLAMA_MODELO ||
    (process.env.LLAMA_MODEL ? basename(process.env.LLAMA_MODEL) : 'Qwen2.5-7B-Instruct.Q5_K_M.gguf')
  );
}

/**
 * Configuração do Qwen3-TTS (clone de voz local). Fonte única dos defaults,
 * usada por `gerar_narracao.mjs`, `smoke.mjs` e `servidor.mjs`. Aceita um
 * objeto de overrides (ex.: `{ ...process.env, ...CONFIG }`) para o servidor
 * respeitar o que for persistido no `.config.json`.
 */
export function qwenEnv(env = process.env) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  return {
    TTS: env.TTS || 'qwen',
    QWEN_ROOT: env.QWEN_ROOT || 'E:/llama.cpp/qwen3-tts-gguf',
    QWEN_PYTHON: env.QWEN_PYTHON || 'python',
    QWEN_MODEL: env.QWEN_MODEL || 'model-base',
    QWEN_REF: env.QWEN_REF || join(ROOT, 'voz-base', 'vander-24k.wav'),
    QWEN_REF_START: env.QWEN_REF_START || '0',
    QWEN_REF_END: env.QWEN_REF_END || '7.2',
    QWEN_REF_TEXTO:
      env.QWEN_REF_TEXTO ||
      'Bem-vindos a mais uma videoaula. Hoje vamos estudar a Palavra de Deus com atenção e fé.',
    QWEN_MAX_STEPS: env.QWEN_MAX_STEPS || '600',
    // Temperatura maior no estágio Talker = mais variação emocional/entonação (voz menos monótona).
    // Repeat penalty maior = mais variação de tom (menos "leitura cadenciada").
    QWEN_TEMP: env.QWEN_TEMP || '1.2',
    QWEN_SUB_TEMP: env.QWEN_SUB_TEMP || '0.6',
    QWEN_TOP_P: env.QWEN_TOP_P || '1.0',
    QWEN_TOP_K: env.QWEN_TOP_K || '50',
    QWEN_MIN_P: env.QWEN_MIN_P || '0.05',
    QWEN_REPEAT_PENALTY: env.QWEN_REPEAT_PENALTY || '1.4',
    // Seeds vazios = derivados do hash do texto no bridge (cada slide varia, mas é
    // determinístico por texto). Defina QWEN_SEED/QWEN_SUB_SEED para fixar tudo num valor.
    QWEN_SEED: env.QWEN_SEED || '',
    QWEN_SUB_SEED: env.QWEN_SUB_SEED || '',
    QWEN_ZERO_SHOT: env.QWEN_ZERO_SHOT || '0',
    QWEN_ONNX_PROVIDER: env.QWEN_ONNX_PROVIDER || 'CUDA',
  };
}

/**
 * Remove projetos de render antigos em `<root>/.html-video/projects/` (cada
 * render cria uma pasta UUID nova). Retorna a quantidade removida.
 * `maxDias` (default 30) pode ser ajustado via env HTML_VIDEO_PROJ_MAXDIAS.
 */
export async function limparProjetosAntigosHtmlVideo(root, { maxDias = Number(process.env.HTML_VIDEO_PROJ_MAXDIAS) || 30, agora = Date.now() } = {}) {
  const projDir = join(root, '.html-video', 'projects');
  if (!existsSync(projDir)) return 0;
  const limite = agora - maxDias * 24 * 60 * 60 * 1000;
  const dirs = await readdir(projDir, { withFileTypes: true });
  let removidos = 0;
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const st = await stat(join(projDir, d.name));
      if (st.mtimeMs < limite) {
        await rm(join(projDir, d.name), { recursive: true, force: true });
        removidos++;
      }
    } catch {
      /* pasta ilegível/inacessível — ignora */
    }
  }
  return removidos;
}

/** Prefixo do arquivo de narração de um item do roteiro (intro, slide ou conclusão). */
export function prefixoNarracao(index, total) {
  if (index === 0) return '00-intro';
  if (index === total - 1) return `${String(total - 1).padStart(2, '0')}-conclusao`;
  return String(index).padStart(2, '0');
}

/** Prompt da imagem de capa (abertura) — do roteiro ou derivado se ausente (roteiros antigos). */
export function imagemPromptIntro(roteiro) {
  if (roteiro?.introducao_imagem_prompt?.trim()) return roteiro.introducao_imagem_prompt;
  return 'flat illustration, open bible with golden light rays, candle and ancient scroll, warm cream and navy palette, educational minimal style, no text';
}

/** Prompt da imagem de capa (encerramento) — do roteiro ou derivado se ausente (roteiros antigos). */
export function imagemPromptConclusao(roteiro) {
  if (roteiro?.conclusao_imagem_prompt?.trim()) return roteiro.conclusao_imagem_prompt;
  return 'flat illustration, sunrise over an open bible, dove with olive branch, warm cream and navy palette, educational minimal style, no text';
}

/** Lista de itens narrados do roteiro (intro + slides + conclusão) com prefixo, prompt e índice. */
export function itensDoRoteiro(roteiro) {
  const total = roteiro.slides.length + 2;
  return [
    { id: 'intro', prefix: prefixoNarracao(0, total), texto: roteiro.introducao },
    ...roteiro.slides.map((s, i) => ({
      id: s.id,
      prefix: prefixoNarracao(i + 1, total),
      texto: s.narracao,
      prompt: s.imagem_prompt,
      idx: i,
    })),
    { id: 'conclusao', prefix: prefixoNarracao(total - 1, total), texto: roteiro.conclusao },
  ];
}

/** Slug da pasta de saída: minúsculo, sem acentos, não-alfanuméricos viram hífen. */
export function slugDe(t) {
  return String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Tenta reparar um JSON truncado/malformado antes de abandonar:
 *  - remove vírgulas soltas (ex.: `[1, 2, ]`, `{"a": 1,}`)
 *  - fecha string aberta no fim (modelo cortou no meio de uma narração)
 *  - fecha colchetes/chaves desbalanceados (append do que falta)
 * Retorna o texto reparado (pode continuar inválido — o parse decide).
 */
export function repararJsonTruncado(s) {
  let t = String(s ?? '').trim();
  if (!t) return t;

  // 1) Vírgulas antes de fechamento
  t = t.replace(/,\s*([\]}])/g, '$1');

  // 2) Varredura para achar string aberta e delimitadores desbalanceados
  const pilha = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      pilha.push(ch);
    } else if (ch === '}' || ch === ']') {
      if (pilha.length) {
        const topo = pilha[pilha.length - 1];
        if ((topo === '{' && ch === '}') || (topo === '[' && ch === ']')) pilha.pop();
      }
    }
  }

  // 3) Fecha string aberta no fim (valor truncado vira string incompleta válida)
  if (inString) t += '"';

  // 4) Remove vírgula final solta (ex.: termina em `,`)
  t = t.replace(/,\s*$/, '');

  // 5) Fecha os delimitadores que sobraram na pilha
  while (pilha.length) {
    t += pilha.pop() === '{' ? '}' : ']';
  }
  return t;
}

/** Extrai JSON de uma resposta do modelo (fences/prosa), reparando quando possível. */
export function extrairJson(content) {
  const candidatos = [];
  const puro = String(content ?? '').trim();
  if (puro) candidatos.push(puro);
  const semFence = puro.replace(/```json/gi, '').replace(/```/g, '').trim();
  if (semFence && semFence !== puro) candidatos.push(semFence);
  const inicio = semFence.indexOf('{');
  if (inicio !== -1) {
    const fim = semFence.lastIndexOf('}');
    if (fim >= inicio) candidatos.push(semFence.slice(inicio, fim + 1));
    candidatos.push(semFence.slice(inicio));
  }
  for (const c of candidatos) {
    try {
      return JSON.parse(c);
    } catch {
      /* segue */
    }
    try {
      return JSON.parse(repararJsonTruncado(c));
    } catch {
      /* tenta o próximo candidato */
    }
  }
  throw new Error('Resposta do modelo não contém JSON válido. Resposta: ' + puro.slice(0, 400));
}

/** Hash SHA-1 do texto/prompt — usado no manifesto para detectar itens desatualizados. */
export const hashDe = (t) => createHash('sha1').update(t ?? '').digest('hex');

/** Escapa texto para HTML (atributos/innerHTML). */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Trunca um texto longo (ex.: material extraído de PDF) para caber no contexto
 * do llama-server. Mantém o início (estrutura/introdução) e o fim (conclusão),
 * cortando o miolo — em vez de descartar só a cauda.
 */
export function truncarMaterial(texto, max) {
  const t = String(texto ?? '');
  if (t.length <= max) return t;
  const ini = Math.floor(max * 0.7);
  const fim = max - ini;
  return `${t.slice(0, ini)}\n[... ${t.length - max} caracteres omitidos ...]\n${t.slice(-fim)}`;
}

/** Limite padrão de caracteres do material de apoio enviado ao llama (default seguro p/ n_ctx=8192). */
export const MATERIAL_MAX_CHARS = Number(process.env.MATERIAL_MAX_CHARS) || 12000;

/** Mapa de extensão → Content-Type para servir arquivos. */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};
