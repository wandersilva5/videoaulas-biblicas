/**
 * util.mjs — Helpers compartilhados entre os scripts (fonte única de verdade).
 */
import { createHash } from 'node:crypto';
import { readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * Nome do modelo (id da API) usado nas chamadas ao llama-server.
 * Precedência: env `LLAMA_MODELO` → basename de `LLAMA_MODEL` (caminho do
 * arquivo GGUF, ex.: `E:\llama.cpp\models\Qwen3.5-9B-Q4_K_M.gguf`) → padrão
 * `Qwen3.5-9B-Q4_K_M.gguf`. O id do llama-server é o nome do arquivo carregado.
 */
export function modeloLLama() {
  return (
    process.env.LLAMA_MODELO ||
    (process.env.LLAMA_MODEL ? basename(process.env.LLAMA_MODEL) : 'Qwen3.5-9B-Q4_K_M.gguf')
  );
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

/** Hash SHA-1 do texto/prompt — usado no manifesto para detectar itens desatualizados. */
export const hashDe = (t) => createHash('sha1').update(t ?? '').digest('hex');

/** Escapa texto para HTML (atributos/innerHTML). */
export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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
