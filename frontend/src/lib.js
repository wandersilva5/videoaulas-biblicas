// Utilidades compartilhadas (espelham web/app.js + scripts/util.mjs).

export const ETAPAS = [
  { n: 1, rotulo: 'Roteiro' },
  { n: 2, rotulo: 'Imagens' },
  { n: 3, rotulo: 'Narração' },
  { n: 4, rotulo: 'Vídeo' },
  { n: 5, rotulo: 'Roteiro Short' },
  { n: 6, rotulo: 'Short' },
  { n: 7, rotulo: 'PDF' },
  { n: 8, rotulo: 'Questionário' },
];

export const NOME_ETAPA = {
  roteiro: 'Roteiro',
  imagens: 'Imagens',
  narracao: 'Narração',
  video: 'Vídeo',
  'roteiro-short': 'Roteiro Short',
  short: 'Short',
  pdf: 'PDF',
  questionario: 'Questionário',
};

export const ORDEM_SERVICOS = ['llama', 'comfy', 'qwen', 'ffmpeg', 'ffprobe', 'chromium'];

// Campos do modal de configurações (mesma ordem do index.html legado).
export const CFG_FIELDS = [
  { k: 'LLAMA_URL', tipo: 'text', rotulo: 'LLAMA_URL' },
  { k: 'COMFY_URL', tipo: 'text', rotulo: 'COMFY_URL' },
  { k: 'COMFY_OUTPUT_DIR', tipo: 'text', rotulo: 'COMFY_OUTPUT_DIR' },
  { k: 'ANIMA_UNET', tipo: 'text', rotulo: 'ANIMA_UNET' },
  { k: 'ANIMA_CLIP', tipo: 'text', rotulo: 'ANIMA_CLIP' },
  { k: 'ANIMA_VAE', tipo: 'text', rotulo: 'ANIMA_VAE' },
  { k: 'ANIMA_LORA', tipo: 'text', rotulo: 'ANIMA_LORA' },
  { k: 'TTS', tipo: 'select', rotulo: 'TTS (qwen = clone de voz local, edge-tts = fallback)', opcoes: ['qwen', 'edge-tts'] },
  { k: 'QWEN_REF', tipo: 'text', rotulo: 'QWEN_REF (WAV da voz de referência)' },
  { k: 'VOZ', tipo: 'text', rotulo: 'VOZ (edge-tts, fallback)' },
  { k: 'PORTA', tipo: 'number', rotulo: 'PORTA' },
  { k: 'LLAMA_EXE', tipo: 'text', rotulo: 'LLAMA_EXE (caminho do llama-server)' },
  { k: 'LLAMA_MODEL', tipo: 'text', rotulo: 'LLAMA_MODEL (modelo do llama-server)' },
  { k: 'COMFY_DIR', tipo: 'text', rotulo: 'COMFY_DIR (pasta do ComfyUI)' },
  { k: 'KREA2_SEED_BASE', tipo: 'number', rotulo: 'KREA2_SEED_BASE (seed das imagens)' },
  { k: 'COMFY_TIMEOUT_MS', tipo: 'number', rotulo: 'COMFY_TIMEOUT_MS (timeout por imagem, ms)' },
  { k: 'PULAR_ROTEIRO', tipo: 'check', rotulo: 'Pular geração do roteiro se já existir' },
  { k: 'PULAR_ENRIQUECIMENTO', tipo: 'check', rotulo: 'Pular conteúdo complementar do PDF' },
  { k: 'VIDEO_FPS', tipo: 'number', rotulo: 'VIDEO_FPS', min: 1 },
  { k: 'VIDEO_WIDTH', tipo: 'number', rotulo: 'VIDEO_WIDTH', min: 320 },
  { k: 'VIDEO_HEIGHT', tipo: 'number', rotulo: 'VIDEO_HEIGHT', min: 240 },
  { k: 'VIDEO_PADDING', tipo: 'number', rotulo: 'VIDEO_PADDING (pausa entre slides, s)', min: 0, step: 0.1 },
];

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* sem corpo */
  }
  if (!res.ok) throw new Error(data?.erro || `Erro HTTP ${res.status}`);
  return data;
}

// Cópia de slugDe (scripts/util.mjs) — mantida em sincronia.
export function slugDe(topico) {
  return String(topico ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function contarPalavras(texto) {
  return (String(texto ?? '').trim().match(/\S+/g) || []).length;
}

export function tempoDesde(msIni) {
  const s = Math.max(0, Math.floor((Date.now() - msIni) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function servicoOk(servicos, nome) {
  return servicos?.servicos?.[nome]?.ok === true;
}

// URL de imagem com cache-busting pelo mtime (igual ao legado).
export function urlImagem(slug, arquivo, mtime) {
  const v = mtime != null && mtime !== false ? mtime : Date.now();
  return `/media/${slug}/${arquivo}?v=${v}`;
}

export function statusEtapa(n, st) {
  if (!st) return 'erro';
  if (n === 1) return 'ok';
  if (n === 2) {
    const temAlguma = [st.intro, ...st.slides, st.conclusao].some((x) => x?.imagem?.existe);
    return st.imagensCompletas ? 'ok' : temAlguma ? 'alerta' : 'erro';
  }
  if (n === 3) return st.audioCompleto ? 'ok' : 'alerta';
  if (n === 4) return st.video.existe ? 'ok' : 'erro';
  if (n === 5) return st.roteiro_short?.existe ? 'ok' : 'erro';
  if (n === 6) return st.short?.existe ? 'ok' : 'erro';
  if (n === 7) return st.pdf?.existe ? 'ok' : 'erro';
  return st.questionario?.existe ? 'ok' : 'erro';
}

export function dicaProximo(st) {
  if (!st) return '';
  if (!st.imagensCompletas) return 'Próximo: gerar imagens dos slides';
  if (!st.audioCompleto) return 'Próximo: gerar narrações';
  if (!st.video.existe) return 'Próximo: montar o vídeo';
  return 'Tudo pronto — revise ou ajuste à vontade';
}

const pad2 = (n) => String(n).padStart(2, '0');

export function itensImagem(st) {
  if (!st) return [];
  const imgDe = (x) => ({ existe: !!x?.existe, mtime: x?.mtime ?? null, desatualizado: !!x?.desatualizado });
  return [
    { id: 'intro', titulo: 'Introdução', arquivo: 'slide-00.png', imagem: imgDe(st.intro?.imagem) },
    ...st.slides.map((s) => ({ id: s.id, titulo: s.titulo, arquivo: `slide-${pad2(s.idx)}.png`, imagem: imgDe(s.imagem) })),
    { id: 'conclusao', titulo: 'Conclusão', arquivo: `slide-${pad2(st.slides.length + 1)}.png`, imagem: imgDe(st.conclusao?.imagem) },
  ];
}

export function itensNarracao(st) {
  const itens = [
    { id: 'intro', rotulo: 'Introdução', prefix: '00-intro', audio: st.intro },
    ...st.slides.map((s) => ({ id: s.id, rotulo: s.titulo, prefix: pad2(s.idx), audio: s.audio })),
    {
      id: 'conclusao',
      rotulo: 'Conclusão',
      prefix: st.slides.length ? `${pad2(st.slides.length + 1)}-conclusao` : '01-conclusao',
      audio: st.conclusao,
    },
  ];
  return itens;
}

export function renumerarSlides(roteiro) {
  roteiro.slides.forEach((s, i) => {
    s.id = `slide-${pad2(i + 1)}`;
  });
  return roteiro;
}
