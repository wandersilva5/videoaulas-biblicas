/**
 * util.mjs — Helpers compartilhados entre os scripts (fonte única de verdade).
 */
import { createHash } from 'node:crypto';
import { readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
    QWEN_REF_END: env.QWEN_REF_END || '46.5',
    QWEN_REF_TEXTO:
      env.QWEN_REF_TEXTO ||
      'Olá, meus queridos amigos! Sejam bem-vindos a mais uma videoaula de teologia. Hoje vamos refletir sobre a verdade de Deus, que permanece firme em todas as gerações. Você já parou para pensar no tamanho do seu amor? Prestem atenção, porque cada versículo traz ensinamentos preciosos: sobre o perdão, sobre a fé e sobre a esperança que renova o nosso coração. Quando a vida fica difícil, lembre-se de que Deus nunca nos abandona, e que a fé nos dá forças para recomeçar. Que a paz do Senhor encha os seus dias, agora e para sempre. Amém!',
    QWEN_MAX_STEPS: env.QWEN_MAX_STEPS || '600',
    // Amostragem mais enxuta no estágio semântico (talker) = o modelo segue melhor
    // o texto (menos paráfrase/variacão de frase) sem virar leitura mecânica.
    //   - Temp menor (0.8->0.5): decodifica mais próximo do texto.
    //   - Top-P/Top-K menores (1.0/50 -> 0.9/30): menos espaço de amostragem.
    //   - Repeat penalty maior (1.4): variação de tom (evita "leitura cadenciada" robótica).
    //   - Sub-temp (acústica) mantida em 0.6: voz natural, sem eletrismo.
    QWEN_TEMP: env.QWEN_TEMP || '0.5',
    QWEN_SUB_TEMP: env.QWEN_SUB_TEMP || '0.6',
    QWEN_TOP_P: env.QWEN_TOP_P || '0.9',
    QWEN_TOP_K: env.QWEN_TOP_K || '30',
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

/** Narração de abertura do questionário — sempre gerada na criação do quiz e incluída no vídeo. */
export const TEXTO_INTRO_QUESTIONARIO = 'Agora vamos ao nosso questionário sobre o que aprendemos!';
export const PREFIX_INTRO_QUESTIONARIO = '00-intro-questionario';

/** Caminho da música de fundo (env `MUSICA_FUNDO` ou `<repo>/musica/fundo.mp3`). */
export function musicaFundo(env = process.env) {
  return env.MUSICA_FUNDO || join(dirname(fileURLToPath(import.meta.url)), '..', 'musica', 'fundo.mp3');
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

/** Ordinal por extenso dos livros bíblicos numerados (1 Coríntios → Primeira Coríntios). */
const ORDINAIS_LIVROS = { '1': 'Primeira', '2': 'Segunda', '3': 'Terceira' };
const LIVROS_COM_NUMERAL = [
  'Samuel', 'Reis', 'Crônicas', 'Coríntios', 'Tessalonicenses', 'Timóteo', 'Pedro', 'João',
];
const LIVROS_SEM_NUMERAL = [
  'Gênesis', 'Êxodo', 'Levítico', 'Números', 'Deuteronômio', 'Josué', 'Juízes', 'Rute', 'Esdras',
  'Neemias', 'Ester', 'Jó', 'Salmo', 'Salmos', 'Provérbios', 'Eclesiastes', 'Cantares', 'Cânticos', 'Isaías',
  'Jeremias', 'Lamentações', 'Ezequiel', 'Daniel', 'Oséias', 'Joel', 'Amós', 'Obadias', 'Jonas',
  'Miquéias', 'Naum', 'Habacuque', 'Sofonias', 'Ageu', 'Zacarias', 'Malaquias', 'Mateus', 'Marcos',
  'Lucas', 'João', 'Atos', 'Romanos', 'Gálatas', 'Efésios', 'Filipenses', 'Colossenses', 'Tito',
  'Filemom', 'Hebreus', 'Tiago', 'Judas', 'Apocalipse',
];

/** Converte número cardinal (1–999) para texto por extenso em pt-BR. */
function numeroPorExtenso(n) {
  const u = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  if (n < 20) return u[n];
  if (n < 100) {
    const dez = Math.floor(n / 10);
    const um = n % 10;
    return d[dez] + (um ? ` e ${u[um]}` : '');
  }
  if (n === 100) return 'cem';
  const cen = Math.floor(n / 100);
  const resto = n % 100;
  return c[cen] + (resto ? ` e ${numeroPorExtenso(resto)}` : '');
}

/**
 * Monta a referência por extenso para leitura (TTS):
 *  - versículo único: "Livro capítulo N e versículo M" (ex.: "João capítulo três e versículo dezesseis")
 *  - intervalo: "Livro capítulo N, versículos do M a Z" (ex.: "Primeira Pedro capítulo um, versículos do um a seis")
 */
function montarRefPorExtenso(prefixoLivro, cap, ver, ver2) {
  const capT = numeroPorExtenso(Number(cap));
  const verT = numeroPorExtenso(Number(ver));
  if (ver2) {
    return `${prefixoLivro} capítulo ${capT}, versículos do ${verT} a ${numeroPorExtenso(Number(ver2))}`;
  }
  return `${prefixoLivro} capítulo ${capT} e versículo ${verT}`;
}

/**
 * Reescreve referências bíblicas em texto NARRADO (lido pelo TTS) para a forma
 * totalmente falada: livro numerado vira ordinal por extenso ("1 Coríntios" →
 * "Primeira Coríntios") e capítulo/versículo ficam por extenso
 * ("João 3:16" → "João capítulo três e versículo dezesseis";
 * "1 Pedro 1:1-6" → "Primeira Pedro capítulo um, versículos do um a seis").
 * Aceita como entrada tanto "Livro cap:vers" quanto o já normalizado "Livro cap, vers".
 * Só deve ser aplicada nos campos narrados (introducao/narracao/conclusao),
 * NUNCA no campo "referencia_biblica", que mantém o formato padrão.
 */
export function referenciasPorExtenso(texto) {
  let t = String(texto ?? '');
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numRe = LIVROS_COM_NUMERAL.map(escRe).join('|');
  const semRe = LIVROS_SEM_NUMERAL.map(escRe).join('|');
  const versEIntervalo = '(\\d+)\\s*[,:]\\s*(\\d+)(?:\\s*[-–—]\\s*(\\d+))?';

  // Livro com numeral arábico: "1 Timóteo 3:16" ou "1Coríntios 15:3" (também aceita vírgula).
  t = t.replace(
    new RegExp(`\\b([123])\\s*(${numRe})\\s+${versEIntervalo}`, 'gi'),
    (m, num, livro, cap, ver, ver2) => montarRefPorExtenso(`${ORDINAIS_LIVROS[num]} ${livro}`, cap, ver, ver2),
  );
  // Livro com ordinal já por extenso (formato antigo): "Primeira Timóteo 3, 16".
  t = t.replace(
    new RegExp(`\\b(Primeira|Segunda|Terceira)\\s+(${numRe})\\s+${versEIntervalo}`, 'gi'),
    (m, ord, livro, cap, ver, ver2) => montarRefPorExtenso(`${ord} ${livro}`, cap, ver, ver2),
  );
  // Livros sem numeral: "João 3:16" ou "Gênesis 17, 1".
  t = t.replace(
    new RegExp(`\\b(${semRe})\\s+${versEIntervalo}`, 'gi'),
    (m, livro, cap, ver, ver2) => montarRefPorExtenso(livro, cap, ver, ver2),
  );
  return t;
}

/** Hash SHA-1 do texto/prompt — usado no manifesto para detectar itens desatualizados. */
export const hashDe = (t) => createHash('sha1').update(t ?? '').digest('hex');

/**
 * Remove menções a texto legível/letras/acentos de um prompt de imagem de slide.
 * O modelo de imagem erra acentos e palavras curtas ("Fé" vira "Fee"), então o
 * prompt é pós-processado para que a cena valha por si só, sem texto na imagem.
 *
 * Estratégia: remove o prefixo "Prompt:", remove qualquer trecho entre aspas e
 * remove SENTENÇAS INTEIRAS que mencionem texto (escrito, palavras, título,
 * frase, citação, versículo, lousa, placa, legenda, etc.) — em vez de picotar
 * trechos com regex, o que deixava fragmentos quebrados no prompt.
 */
const MARCAS_TEXTO_IMAGEM = [
  'written', 'inscribed', 'printed', 'typed', 'lettering', 'lettered',
  'phrase', 'quote', 'quotation', 'caption', 'label', 'heading', 'headline',
  'chalkboard', 'blackboard', 'whiteboard', 'signboard', 'billboard',
  'speech bubble', 'speech-bubble', 'thought bubble', 'says', 'saying',
  'the text', 'with text', 'text on', 'text reads', 'text in',
  'the word', 'the words', 'with the word', 'with the words', 'word in',
  'scroll reading', 'scroll titled', 'scroll with', 'a scroll that',
  'book titled', 'book with', 'titled',
  'scripture', 'biblical verse', 'verse ', 'bible quote', 'biblical quote',
  'reads', 'displaying', 'proclaiming', 'engraved', 'embossed', 'etched',
];

const RE_ASPAS = /["“”'‘’][^"“”'‘’]*["“”'‘’]/g;

export function limparTextoDePromptImagem(prompt) {
  let p = String(prompt ?? '').replace(/^Prompt:\s*/i, '').trim();

  // 1. Remove trechos entre aspas (deixando eventuais conectivos simples).
  p = p.replace(RE_ASPAS, '');

  // 2. Remove sentenças inteiras que citem marcadores de texto.
  const temMarca = (sent) => {
    const s = sent.toLowerCase();
    return MARCAS_TEXTO_IMAGEM.some((m) => s.includes(m));
  };
  const sentencas = p.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  p = sentencas.filter((s) => !temMarca(s)).join(' ');

  // 3. Limpeza de fragmentos órfãos deixados pelos passos anteriores.
  p = p
    .replace(/\s*,\s*\./g, '.')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s+\./g, '.')
    .trim();
  // Remove pontuação dupla ".," etc. e vírgulas/pontos soltos no fim.
  p = p.replace(/([,.]\s*){2,}/g, '. ').replace(/[,.]+$/g, '').trim();
  // Remove espaços órfãos antes de "and"/"the"/conectivos no fim de trechos cortados.
  p = p.replace(/\b(and|with|of|in|on|a|the)\s+$/gi, '').replace(/\s{2,}/g, ' ').trim();
  return p;
}

/**
 * Regras fixas de descrição de personagem anexadas a TODO prompt de imagem
 * (em inglês, pois o modelo de imagem recebe prompts em inglês):
 *  - declara sempre o gênero de cada figura humana (homem ou mulher);
 *  - homem comum sem nome e da época atual: cabelo curto, camisa, calça e sapatos;
 *  - personagem bíblico/histórico masculino: roupas da época (túnica/manto, sandálias);
 *  - mulher comum sem nome e da época atual: modesta e recatada, sem pernas de fora,
 *    sem decote nem alças finas;
 *  - nenhum homem de cabelos longos, a menos que seja um personagem masculino
 *    especificamente conhecido por isso (ex.: Sansão).
 */
export const REGRAS_PERSONAGENS_IMAGEM =
  'character guidelines: every human figure must be clearly a man or a woman; ' +
  'ordinary man (no proper name, present day) with short hair, shirt, pants and shoes; ' +
  'biblical or historical male character wearing era-appropriate clothing (robe, tunic, sandals); ' +
  'ordinary woman (no proper name, present day) in a modest fully covered outfit, no bare legs, ' +
  'no cleavage, no sleeveless top; no man with long hair unless he is a specific male character ' +
  'famous for long hair';

/** Anexa as regras de personagem a um prompt de imagem (idempotente — não duplica se já presentes). */
export function anexarRegrasPersonagens(prompt) {
  const p = String(prompt ?? '').trim();
  if (!p) return p;
  if (/character guidelines/i.test(p)) return p;
  return `${p}, ${REGRAS_PERSONAGENS_IMAGEM}`;
}

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

/**
 * Concatena arquivos de áudio com intervalos de silêncio entre eles (ffmpeg).
 * `gaps[i]` é o silêncio (s) inserido APÓS `audios[i]`; o último é ignorado.
 * Usado pelo questionário (pergunta + 10 s de timer + resposta) e pela
 * geração segmentada de narração (cada opção vira um MP3, concat com pausa).
 */
export function concatenarAudiosComGaps(audios, gaps, outPath) {
  const args = ['-y'];
  const n = audios.length;
  const filters = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    args.push('-i', audios[i].path);
    filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    labels.push(`[a${i}]`);

    if (i < n - 1 && gaps[i] > 0) {
      filters.push(`anullsrc=r=44100:cl=stereo:d=${gaps[i]}[pad${i}]`);
      labels.push(`[pad${i}]`);
    }
  }
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', outPath);

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg concat audio exit ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

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
