/**
 * util.mjs — Helpers compartilhados entre os scripts (fonte única de verdade).
 */
import { createHash } from 'node:crypto';
import { readdir, stat, rm, mkdir, rename, open, copyFile } from 'node:fs/promises';
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
    QWEN_REF: env.QWEN_REF || join(ROOT, 'voz-base', 'voz-pedro.mp3'),
    QWEN_REF_START: env.QWEN_REF_START || '0',
    QWEN_REF_END: env.QWEN_REF_END || '40.972',
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

/**
 * Gera uma trilha de música em loop com a duração da narração/vídeo.
 * Repete a música (`-stream_loop`) e corta (`-t`) no tamanho alvo, para que
 * ela cubra o vídeo inteiro e termine junto com a narração — sem deixar o
 * trecho final em silêncio. Volume e fades continuam aplicados no mux
 * (`musicVolumeDb`/`fadeInSec`/`fadeOutSec` do soundtrack).
 */
export function prepararMusicaEmLoop(musicaPath, duracaoAlvoSec, outPath) {
  const dur = Math.max(1, Number(duracaoAlvoSec) || 0);
  const args = ['-y', '-stream_loop', '-1', '-i', musicaPath, '-t', dur.toFixed(2), '-c:a', 'libmp3lame', '-b:a', '192k', outPath];
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`ffmpeg musica-loop exit ${code}: ${stderr.slice(-1000)}`));
    });
  });
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
  'chalkboard', 'blackboard', 'whiteboard', 'signboard', 'billboard',
  'speech bubble', 'speech-bubble', 'thought bubble',
  'the text', 'with text', 'text on', 'text reads', 'text in',
  'text overlay', 'text saying', 'text displaying',
  'the word', 'the words', 'with the word', 'with the words', 'word in',
  'label', 'caption', 'heading', 'headline', 'lettering', 'lettered',
  'reads', 'displaying', 'proclaiming',
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
 * Regras de personagem para prompts de imagem (em inglês, pois o modelo de
 * imagem recebe prompts em inglês). Só entram quando o prompt do roteiro pede
 * alguma figura humana/divina — ver `temFiguraHumana`.
 *
 * Por que este formato: o texto antigo listava arquétipos ("ordinary man ...",
 * "biblical male character ...", "ordinary woman ...") e o modelo lia a lista
 * como ELENCO — desenhava um de cada, mesmo pedindo uma pessoa só. As regras
 * abaixo usam fraseado condicional ("any man shown ...") + quantidade exata,
 * que o modelo lê como restrição, não como elenco.
 */
export const REGRAS_PESSOA_SINGULAR =
  'exactly one person in the image, no other people, no background figures or onlookers; ' +
  'fully visible and well-lit, detailed face and clothing in natural colors, ' +
  'no silhouettes, no solid black figures, no shadow people; ' +
  'any man shown has short hair, shirt, pants and shoes, or era-appropriate robe, tunic and sandals ' +
  'if he is a biblical or historical character; any woman shown wears a modest fully covered outfit, ' +
  'no bare legs, no cleavage, no sleeveless top; no man with long hair unless he is a specific ' +
  'male character famous for long hair';

export const REGRAS_PESSOA_PLURAL =
  'exactly the people described in the scene and no others, no extra onlookers or background figures; ' +
  'everyone fully visible and well-lit, detailed faces and clothing in natural colors, ' +
  'no silhouettes, no solid black figures, no shadow people; ' +
  'any man shown has short hair, shirt, pants and shoes, or era-appropriate robe, tunic and sandals ' +
  'if he is a biblical or historical character; any woman shown wears a modest fully covered outfit, ' +
  'no bare legs, no cleavage, no sleeveless top; no man with long hair unless he is a specific ' +
  'male character famous for long hair';

/** Close-up de mão(s): mantém o enquadramento, sem corpos inteiros nem figurantes. */
export const REGRAS_CLOSE_UP_MAOS =
  'keep the close-up framing, show only the described hand or hands, no full bodies, ' +
  'no faces, no extra people, well-lit with natural skin tones, no silhouettes';

/** Compat: restrições de personagem (era o bloco único anexado a tudo). */
export const REGRAS_PERSONAGENS_IMAGEM = REGRAS_PESSOA_SINGULAR;

/**
 * Guarda anti-figuras para prompts SEM gente: impede o modelo de inventar
 * pessoas onde o roteiro pediu só objetos/cenários. Vai no prompt positivo
 * porque o workflow Krea2 usa ConditioningZeroOut (não há negative prompt).
 */
export const SEM_PESSOAS_IMAGEM = 'no people, no human figures, no silhouettes of people, empty scene';

/** Palavras que indicam figura humana/divina no prompt (EN + PT, pois o LLM às vezes mistura). */
const FIGURAS_HUMANAS = [
  'man', 'men', 'woman', 'women', 'person', 'people', 'human', 'humans',
  'figure', 'figures', 'child', 'children', 'boy', 'boys', 'girl', 'girls', 'baby', 'babies',
  'god', 'jesus', 'christ', 'deity', 'deities', 'messiah', 'savior', 'saviour',
  'angel', 'angels', 'saint', 'saints',
  'disciple', 'disciples', 'apostle', 'apostles', 'prophet', 'prophets',
  'king', 'kings', 'queen', 'queens', 'priest', 'priests',
  'crowd', 'crowds', 'multitude', 'shepherd', 'shepherds',
  'fisherman', 'fishermen', 'soldier', 'soldiers', 'servant', 'servants',
  'father', 'mother', 'son', 'sons', 'daughter', 'daughters',
  'brother', 'brothers', 'sister', 'sisters', 'family', 'families',
  'believer', 'believers', 'worshipper', 'worshippers', 'worshiper', 'worshipers',
  'student', 'students', 'martyr', 'martyrs', 'pilgrim', 'pilgrims',
  'monk', 'monks', 'nun', 'nuns', 'elder', 'elders',
  // PT (fallback)
  'deus', 'homem', 'homens', 'mulher', 'mulheres', 'pessoa', 'pessoas',
  'humano', 'humanos', 'crianca', 'criancas', 'menino', 'meninos', 'menina', 'meninas',
  'filho', 'filhos', 'filha', 'filhas', 'pai', 'mae', 'irmao', 'irmaos', 'irma', 'irmas',
  'familia', 'jesus', 'cristo', 'anjo', 'anjos', 'santo', 'santos',
  'discipulo', 'discipulos', 'apostolo', 'apostolos', 'profeta', 'profetas',
  'rei', 'reis', 'rainha', 'sacerdote', 'sacerdotes', 'multidao', 'povo', 'povos',
];
const RE_FIGURA_HUMANA = new RegExp(`\\b(${FIGURAS_HUMANAS.join('|')})\\b`, 'i');

/** Palavras com sentido plural de gente (cena em grupo — não forçar "uma pessoa só"). */
const FIGURAS_PLURAIS = [
  'men', 'women', 'people', 'children', 'crowds', 'multitudes',
  'disciples', 'apostles', 'prophets', 'angels', 'saints', 'students',
  'soldiers', 'servants', 'shepherds', 'believers', 'worshippers', 'worshipers',
  'brothers', 'sisters', 'sons', 'daughters', 'families', 'groups',
  'crowd', 'multitude', 'family', 'group',
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];
const RE_FIGURA_PLURAL = new RegExp(`\\b(${FIGURAS_PLURAIS.join('|')}|\\d+)\\b`, 'i');

/** `true` se o prompt do roteiro pede alguma figura humana/divina. */
export function temFiguraHumana(prompt) {
  const semAcento = String(prompt ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return RE_FIGURA_HUMANA.test(semAcento);
}

function semAcento(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Anexa as regras de personagem a um prompt de imagem (idempotente):
 *  - close-up de mão(s) → mantém o enquadramento, sem corpos nem figurantes;
 *  - prompt COM figura no singular → exatamente 1 pessoa, iluminada e detalhada;
 *  - prompt COM figuras no plural → exatamente as descritas, sem extras;
 *  - prompt SEM figura → SEM_PESSOAS_IMAGEM (não inventar gente).
 */
export function anexarRegrasPersonagens(prompt) {
  const p = String(prompt ?? '').trim();
  if (!p) return p;
  if (/character guidelines/i.test(p)) return p; // regra legada — não duplica
  if (/exactly one person in the image|exactly the people described|keep the close-up framing/i.test(p)) return p;
  if (/no people,\s*no human figures/i.test(p)) return p;
  const normalizado = semAcento(p);
  if (/\bclose-?up\b/i.test(normalizado) && /\bhands?\b/i.test(normalizado) && !RE_FIGURA_PLURAL.test(normalizado)) {
    return `${p}, ${REGRAS_CLOSE_UP_MAOS}`;
  }
  if (!temFiguraHumana(p)) return `${p}, ${SEM_PESSOAS_IMAGEM}`;
  return RE_FIGURA_PLURAL.test(normalizado)
    ? `${p}, ${REGRAS_PESSOA_PLURAL}`
    : `${p}, ${REGRAS_PESSOA_SINGULAR}`;
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

/** Limite padrão de caracteres do material de apoio enviado ao llama (seguro para n_ctx 8192). */
export const MATERIAL_MAX_CHARS = Number(process.env.MATERIAL_MAX_CHARS) || 8000;

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

/** Retorna os caminhos das subpastas de estudo para um diretório dado. */
export function dirsEstudo(outDir) {
  return {
    imagens: join(outDir, 'imagens'),
    audios:  join(outDir, 'audios'),
    videos:  join(outDir, 'videos'),
  };
}

/**
 * Exporta o MP4 via html-video e promove o resultado com retry para o
 * Windows: o core grava o vídeo mudo direto no destino, muxa o áudio num
 * temporário `<video>.muxed.mp4` e renomeia por cima do destino — `rename`
 * falha com EPERM se o MP4 antigo estiver aberto num player/navegador
 * (ex.: preview de vídeo aberto na UI). O render e o mux já estão COMPLETOS
 * nesse ponto; só a substituição falhou. Então:
 *   1. se sobrou um `.muxed.mp4` órfão de execução anterior, promove antes
 *      de renderizar — se não der (arquivo travado), ABORTA sem renderizar,
 *      porque o render novo gravaria por cima do destino travado e o órfão
 *      (que já é um vídeo pronto) seria desperdiçado;
 *   2. se o `exportMp4` falhar mas o `.muxed.mp4` existir (render+mux ok,
 *      rename travado), tenta promover com janela longa e instruções;
 *   3. o destino é pré-testado com `podeSubstituir()` antes de renderizar —
 *      falha rápido (em segundos) em vez de descobrir o lock só no fim do
 *      render (~9 min perdidos).
 */
export async function exportarMp4ComRetry(orchestrator, { projectId, outputPath, onProgress, tentativas = 30, esperaMs = 2000 }) {
  const muxedPath = `${outputPath}.muxed.mp4`;
  if (existsSync(muxedPath)) {
    console.error(`  [recuperação] ${basename(muxedPath)} órfão de execução anterior — promovendo antes de renderizar`);
    await promoverComRetry(muxedPath, outputPath, tentativas, esperaMs);
  }
  if (existsSync(outputPath) && !(await podeSubstituir(outputPath))) {
    throw new Error(
      `${basename(outputPath)} está aberto em outro programa (player/navegador) — feche-o antes de montar o vídeo. ` +
        `(detectado antes de renderizar, sem desperdiçar o render)`,
    );
  }
  try {
    await orchestrator.exportMp4({ projectId, outputPath, onProgress });
    return;
  } catch (e) {
    // Render + mux podem ter concluído e só o rename final ter falhado —
    // nesse caso o `.muxed.mp4` ficou no disco e o vídeo está pronto.
    if (!existsSync(muxedPath)) throw e;
    console.error(`  [aviso] render concluído, mas a substituição de ${basename(outputPath)} falhou (${e.code ?? e.message})`);
    console.error('  [aviso] feche o vídeo em qualquer player/navegador para concluir a substituição');
  }
  await promoverComRetry(muxedPath, outputPath, tentativas, esperaMs);
  console.error(`  vídeo recuperado e concluído: ${outputPath}`);
}

/**
 * Testa se um arquivo existente pode ser substituído/renomeado por cima no
 * Windows: abre com FILE_APPEND_DATA (`'a'`) — se outro processo (player,
 * preview `<video>` da UI) mantém um handle com compartilhamento
 * restritivo, o open falha com EPERM/EBUSY imediatamente, sem retry.
 * Fecha o handle em seguida (o arquivo não é alterado: `'a'` só posiciona
 * no fim, nada é escrito).
 */
export async function podeSubstituir(path) {
  let fh;
  try {
    fh = await open(path, 'a');
  } catch (e) {
    if (['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) return false;
    throw e;
  }
  await fh.close();
  return true;
}

/**
 * `rename` com retry — EPERM/EBUSY no Windows enquanto o destino está aberto
 * em outro processo. Se o `rename` travar, tenta `copyFile` por cima:
 * players/navegadores normalmente abrem o MP4 compartilhando leitura+escrita
 * (permitem escrever por cima) mas sem FILE_SHARE_DELETE — que é exatamente
 * o que o `rename` precisa. Se nem a cópia der, aí sim é preciso fechar o
 * player (as tentativas continuam até o usuário fechar).
 */
export async function promoverComRetry(de, para, tentativas = 30, esperaMs = 2000) {
  let copiaBloqueada = false;
  for (let i = 1; i <= tentativas; i++) {
    let err;
    try {
      await rename(de, para);
      return;
    } catch (e) {
      err = e;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
    }
    // rename bloqueado (arquivo aberto): tentar escrever por cima — players
    // costumam compartilhar escrita, só não compartilham exclusão/rename.
    if (!copiaBloqueada) {
      try {
        await copyFile(de, para);
        try {
          await rm(de, { force: true });
        } catch {
          console.error(`  [aviso] cópia concluída, mas ${basename(de)} não pôde ser apagado — será promovido de novo na próxima execução`);
        }
        console.error(`  [promovido] ${basename(para)} atualizado via cópia direta (rename bloqueado pelo player, escrita compartilhada)`);
        return;
      } catch {
        copiaBloqueada = true;
        console.error('  [aguardando] cópia direta também bloqueada — feche o player/navegador que tem o vídeo aberto');
      }
    }
    if (i === tentativas) {
      throw new Error(
        `${basename(para)} está aberto em outro programa (player/navegador) e não pôde ser substituído. ` +
          `O vídeo pronto está em ${basename(de)} — feche o player e rode a etapa novamente para promovê-lo. (${err.code ?? err.message})`,
      );
    }
    console.error(`  [aguardando] ${basename(para)} travado (feche o player/navegador); nova tentativa em ${esperaMs}ms (${i}/${tentativas - 1})`);
    await new Promise((r) => setTimeout(r, esperaMs));
  }
}

/** Cria as 3 subpastas (imagens/, audios/, videos/) se não existirem. */
export async function garantirDirsEstudo(outDir) {
  const dirs = dirsEstudo(outDir);
  for (const dir of Object.values(dirs)) {
    await mkdir(dir, { recursive: true });
  }
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
