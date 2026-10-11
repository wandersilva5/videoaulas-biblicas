/**
 * gerar_legendas.mjs — Gera arquivo .ass com legendas sincronizadas para o
 * vídeo de testemunho a partir do roteiro.json + durações de cada cena.
 *
 * Em vez de distribuir o tempo proporcionalmente ao número de palavras (o que
 * assumia velocidade constante de fala e nunca casava com a narração), cada
 * narração é quebrada em blocos por pontuação e cada bloco é ancorado nas
 * pausas REAIS detectadas no áudio (via ffmpeg silencedetect). Blocos sem
 * pausa correspondente caem na interpolação proporcional ao tamanho do texto,
 * e âncoras que gerariam blocos com duração implausível são descartadas.
 *
 * Uso (standalone):
 *   node scripts/gerar_legendas.mjs output/testemunhos/<slug>/roteiro.json
 *
 * Uso (importado):
 *   import { gerarLegendas } from './gerar_legendas.mjs';
 *   const assPath = await gerarLegendas(roteiro, itens, outDir, { width, height });
 */

import { writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Número máximo de palavras por linha de legenda
const PALAVRAS_POR_LINHA = Number(process.env.LEGENDA_PALAVRAS_POR_LINHA) || 6;

// Sensibilidade da detecção de pausas (quanto mais baixo o dB, mais sensível)
const SILENCIO_DB = Number(process.env.LEGENDA_SILENCIO_DB) || -32;
const SILENCIO_MIN = Number(process.env.LEGENDA_SILENCIO_MIN) || 0.14;
const PONTUACAO_FRASE = /[.!?…]/;
const PONTUACAO_PAUSA = ';:,';
const LEAD_IN = 0.05;

// Abreviações cujo ponto final NÃO indica fim de frase
const ABREVIACOES = new Set([
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'st', 'sto', 'sta',
  'av', 'etc', 'ex', 'jr', 'vs', 'ms', 'vol', 'cap', 'fl',
]);

// Travas de sanidade do alinhamento
const MIN_INTERVALO_FALA = 0.35; // s — abaixo disso, funde com o trecho vizinho
const MIN_LINHA = 0.3;           // s — linha mais curta que isso é fundida à anterior
const SEG_POR_PALAVRA = 0.11;    // s — ritmo mínimo implausível (só bloqueia blocos absurdos)
const MIN_BLOCO = 0.15;          // s — piso absoluto de duração por bloco
const LINHA_MAX_PALAVRAS_FUSAO = 8; // fusão de linha de palavra única até este total

// Fonte e estilo das legendas
const FONTE_TAMANHO_HD = 58;   // px para 1920x1080
const FONTE_TAMANHO_VERT = 52; // px para 1080x1920

/**
 * Converte segundos para o formato de timestamp ASS: h:mm:ss.cs
 */
function toAssTime(segundos) {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  const cs = Math.round((segundos % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// No formato ASS, o texto da Dialogue é o último campo: vírgulas passam
// sem escape; apenas as chaves precisam ser neutralizadas para não serem
// lidas como override de estilo.
function escaparAss(texto) {
  return texto.replace(/[{}]/g, (m) => (m === '{' ? '{\\{}' : '{\\}}'));
}

/**
 * Divide um texto em chunks de N palavras.
 */
function dividirEmLinhas(texto, n) {
  const palavras = texto.trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < palavras.length; i += n) {
    chunks.push(palavras.slice(i, i + n).join(' '));
  }
  return chunks;
}

/**
 * Quebra a narração em blocos nos limites de pausa prováveis: fim de frase
 * (. ! ? …), ponto e vírgula, dois pontos e vírgula. Não quebra em
 * abreviações ("Sr.", "Dr."), nem em vírgula decimal ("3,5"), nem no meio de
 * reticências.
 */
export function dividirEmBlocos(texto) {
  const blocos = [];
  const chars = texto.trim();
  let atual = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    atual += ch;

    let quebra = false;
    if (PONTUACAO_FRASE.test(ch)) {
      // reticências ("...") e abreviações não fecham bloco
      const reticencias = ch === '.' && chars[i + 1] === '.';
      if (!reticencias) {
        const palavraAnterior = atual.slice(0, -1).trim().split(/\s+/).pop()?.toLowerCase() || '';
        if (!ABREVIACOES.has(palavraAnterior)) quebra = true;
      }
    } else if (PONTUACAO_PAUSA.includes(ch)) {
      const anterior = chars[i - 1] || '';
      const proximo = chars[i + 1] || '';
      const decimal = ch === ',' && /\d/.test(anterior) && /\d/.test(proximo);
      if (!decimal) quebra = true;
    }

    if (quebra) {
      const t = atual.trim();
      if (t) blocos.push(t);
      atual = '';
    }
  }

  const fim = atual.trim();
  if (fim) blocos.push(fim);
  return blocos;
}

/**
 * Detecta pausas reais (silêncio) no áudio via ffmpeg silencedetect.
 * @returns {Promise<Array<{inicio:number, fim:number}>>}
 */
export async function detectarPausas(audioPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-nostats',
      '-i', audioPath,
      '-af', `silencedetect=noise=${SILENCIO_DB}dB:d=${SILENCIO_MIN}`,
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', () => resolve([]));
    proc.on('exit', () => resolve(parsearPausas(stderr)));
  });
}

function parsearPausas(stderr) {
  const inicios = [...stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]));
  const fins = [...stderr.matchAll(/silence_end:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]));
  const pausas = [];
  for (let i = 0; i < inicios.length && i < fins.length; i++) {
    if (fins[i] > inicios[i]) pausas.push({ inicio: inicios[i], fim: fins[i] });
  }
  return pausas.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Casa cada fronteira entre blocos com a pausa mais próxima da posição
 * esperada (proporção linear por caracteres), sem reutilizar pausa e
 * preservando a ordem. Fronteiras sem pausa plausível ficam sem âncora.
 * @returns {Array<number|null>} índice da pausa escolhida por fronteira
 */
function casarFronteiras(blocos, pausas, dur) {
  const ancoras = new Array(Math.max(0, blocos.length - 1)).fill(null);
  if (pausas.length === 0 || blocos.length < 2) return ancoras;

  const charsTotal = blocos.reduce((s, b) => s + b.length, 0) || 1;
  const esperado = [];
  let acc = 0;
  for (const b of blocos) {
    acc += b.length;
    esperado.push((dur * acc) / charsTotal);
  }

  const usadas = new Array(pausas.length).fill(false);
  const limiar = Math.max(0.8, dur * 0.18);
  let ultimoIndice = -1;

  for (let i = 0; i < ancoras.length; i++) {
    const alvo = esperado[i];
    let melhor = -1;
    let melhorDist = Infinity;
    for (let j = 0; j < pausas.length; j++) {
      if (usadas[j] || j <= ultimoIndice) continue;
      const centro = (pausas[j].inicio + pausas[j].fim) / 2;
      const dist = Math.abs(centro - alvo);
      if (dist < melhorDist) { melhorDist = dist; melhor = j; }
    }
    if (melhor >= 0 && melhorDist <= limiar) {
      usadas[melhor] = true;
      ancoras[i] = melhor;
      ultimoIndice = melhor;
    }
  }
  return ancoras;
}

/**
 * Preenche posições nulas de um array interpolando proporcionalmente aos
 * pesos, entre as âncoras conhecidas (e as bordas 0/total).
 */
function interpolarEntreAncoras(arr, pesos, total) {
  const n = arr.length;
  let i = 0;
  while (i < n) {
    if (arr[i] == null) {
      let j = i;
      while (j < n && arr[j] == null) j++;
      const esq = i > 0 ? arr[i - 1] : 0;
      const dir = j < n ? arr[j] : total;
      const somaPesos = pesos.slice(i, j).reduce((s, p) => s + p, 0) || 1;
      let acc = esq;
      for (let k = i; k < j; k++) {
        acc += ((dir - esq) * pesos[k]) / somaPesos;
        arr[k] = acc;
      }
      i = j;
    } else {
      i++;
    }
  }
  return arr;
}

/**
 * Calcula o início e o fim de cada bloco a partir das âncoras. Blocos sem
 * âncora são interpolados proporcionalmente ao tamanho do texto.
 */
function calcularLimitesBlocos(blocos, ancoras, uteis, inicioReal, fimReal) {
  const n = blocos.length;
  const inicio = new Array(n).fill(null);
  const fim = new Array(n).fill(null);
  const pesos = blocos.map((b) => b.length);

  inicio[0] = inicioReal + LEAD_IN;
  fim[n - 1] = fimReal;
  for (let i = 0; i < n - 1; i++) {
    if (ancoras[i] != null) {
      const p = uteis[ancoras[i]];
      fim[i] = p.inicio;
      inicio[i + 1] = p.fim;
    }
  }

  interpolarEntreAncoras(fim, pesos, fimReal);
  for (let i = 1; i < n; i++) {
    if (inicio[i] == null) inicio[i] = fim[i - 1];
  }
  return { inicio, fim };
}

/**
 * Funde intervalos de fala muito curtos com o vizinho, para não sobrar uma
 * palavra isolada com duração irrisória.
 */
function fundirIntervalosCurtos(intervalos) {
  const out = [];
  for (const iv of intervalos) {
    if (!out.length) { out.push({ ...iv }); continue; }
    const anterior = out[out.length - 1];
    if (iv.fim - iv.inicio < MIN_INTERVALO_FALA || anterior.fim - anterior.inicio < MIN_INTERVALO_FALA) {
      anterior.fim = iv.fim;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/**
 * Funde linhas de legenda muito curtas à linha anterior, e junta linhas de
 * palavra única (ex.: "A" / "um quilômetro de distância,") à linha seguinte
 * enquanto o total couber em uma linha.
 */
function fundirLinhasCurtas(linhas) {
  const contaPalavras = (t) => t.split(/\s+/).filter(Boolean).length;
  const out = [];

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const anterior = out[out.length - 1];
    const proxima = linhas[i + 1];

    if (anterior && (l.fim - l.inicio) < MIN_LINHA) {
      anterior.texto = `${anterior.texto} ${l.texto}`.trim();
      anterior.fim = Math.max(anterior.fim, l.fim);
      continue;
    }

    if (contaPalavras(l.texto) <= 1 && proxima && contaPalavras(proxima.texto) + 1 <= LINHA_MAX_PALAVRAS_FUSAO) {
      out.push({ inicio: l.inicio, fim: proxima.fim, texto: `${l.texto} ${proxima.texto}`.trim() });
      i++;
      continue;
    }

    if (contaPalavras(l.texto) <= 1 && anterior) {
      anterior.texto = `${anterior.texto} ${l.texto}`.trim();
      anterior.fim = Math.max(anterior.fim, l.fim);
      continue;
    }

    out.push({ ...l });
  }
  return out;
}

/**
 * Gera as linhas de legenda de um bloco ancorado em [start, end], usando
 * eventuais pausas internas como sub-âncoras para fatiar as palavras.
 */
function linhasDoBloco(bloco, start, end, pausasInternas) {
  const palavras = bloco.split(/\s+/).filter(Boolean);
  if (!palavras.length || end <= start) return [];

  const subs = pausasInternas.filter((p) => p.inicio > start + 0.05 && p.fim < end - 0.05);

  // Monta os intervalos de fala dentro do bloco
  const intervalos = [];
  let cursor = start;
  for (const p of subs) {
    if (p.inicio > cursor) intervalos.push({ inicio: cursor, fim: p.inicio });
    cursor = Math.max(cursor, p.fim);
  }
  if (end > cursor) intervalos.push({ inicio: cursor, fim: end });
  if (intervalos.length === 0) intervalos.push({ inicio: start, fim: end });

  const falas = fundirIntervalosCurtos(intervalos);

  // Distribui as palavras entre os intervalos proporcionalmente à duração
  const durTotal = falas.reduce((s, iv) => s + (iv.fim - iv.inicio), 0) || 1;
  let idx = 0;
  for (let i = 0; i < falas.length; i++) {
    if (i === falas.length - 1) {
      falas[i].palavras = palavras.slice(idx);
      break;
    }
    const alvo = Math.round((palavras.length * (falas[i].fim - falas[i].inicio)) / durTotal);
    const restantes = falas.length - 1 - i;
    const qtd = Math.max(1, Math.min(alvo, palavras.length - idx - restantes));
    falas[i].palavras = palavras.slice(idx, idx + qtd);
    idx += qtd;
  }

  // Dentro de cada intervalo, divide em linhas e distribui por caracteres
  const linhas = [];
  for (const iv of falas) {
    const texto = iv.palavras.join(' ');
    if (!texto) continue;
    const linhasIv = dividirEmLinhas(texto, PALAVRAS_POR_LINHA);
    const charsTotalIv = linhasIv.reduce((s, l) => s + l.length, 0) || 1;
    let t = iv.inicio;
    for (const txt of linhasIv) {
      const dur = ((iv.fim - iv.inicio) * txt.length) / charsTotalIv;
      linhas.push({ inicio: t, fim: t + dur, texto: txt });
      t += dur;
    }
  }
  return fundirLinhasCurtas(linhas);
}

/**
 * Calcula as linhas de legenda (com tempos absolutos) de todas as cenas.
 * @param {Array} itens — [{id, audio, dur, narracao}]
 * @returns {Promise<Array<{id, dur, linhas: Array<{inicio, fim, texto}>}>>}
 */
export async function calcularLinhasLegenda(itens) {
  const resultado = [];
  let base = 0;

  for (const it of itens) {
    const dur = it.dur || 0;
    const narracao = (it.narracao || '').trim();
    if (!narracao || dur <= 0) {
      resultado.push({ id: it.id, dur, linhas: [] });
      base += dur;
      continue;
    }

    const pausas = await detectarPausas(it.audio);
    const blocos = dividirEmBlocos(narracao);
    const palavrasPorBloco = blocos.map((b) => b.split(/\s+/).filter(Boolean).length);

    // Silêncio inicial/final não servem de âncora para fronteiras internas
    const uteis = pausas.filter((p) => p.inicio > 0.08);
    const inicioReal = pausas.length && pausas[0].inicio <= 0.08 ? pausas[0].fim : 0;
    let fimReal = dur;
    if (uteis.length && uteis[uteis.length - 1].fim >= dur - 0.15) {
      fimReal = uteis.pop().inicio;
    }

    let ancoras = casarFronteiras(blocos, uteis, fimReal);
    let limites = calcularLimitesBlocos(blocos, ancoras, uteis, inicioReal, fimReal);

    // Descarta âncoras que deixariam algum bloco num ritmo implausível
    // (só o absurdo: uma frase inteira comprimida em frações de segundo).
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const ruins = [];
      for (let i = 0; i < blocos.length; i++) {
        const minDur = Math.max(MIN_BLOCO, SEG_POR_PALAVRA * palavrasPorBloco[i]);
        if (limites.fim[i] - limites.inicio[i] < minDur) ruins.push(i);
      }
      if (ruins.length === 0) break;

      let removeu = false;
      for (const i of ruins) {
        if (i - 1 >= 0 && ancoras[i - 1] != null) { ancoras[i - 1] = null; removeu = true; }
        if (i < blocos.length - 1 && ancoras[i] != null) { ancoras[i] = null; removeu = true; }
      }
      if (!removeu) break;
      limites = calcularLimitesBlocos(blocos, ancoras, uteis, inicioReal, fimReal);
    }

    // Piso final: garante duração mínima e monotonicidade, empurrando o fim
    // do bloco (sem ultrapassar o fim da fala) quando a interpolação sobrar colada.
    for (let i = 0; i < blocos.length; i++) {
      const minDur = Math.max(MIN_BLOCO, 0.05 * palavrasPorBloco[i]);
      if (limites.fim[i] - limites.inicio[i] >= minDur) continue;
      limites.fim[i] = Math.min(fimReal, limites.inicio[i] + minDur);
      for (let j = i + 1; j < blocos.length; j++) {
        if (limites.inicio[j] < limites.fim[j - 1]) limites.inicio[j] = limites.fim[j - 1];
        if (limites.fim[j] < limites.inicio[j] + 0.05) {
          limites.fim[j] = Math.min(fimReal, limites.inicio[j] + 0.05);
        }
      }
    }

    const { inicio, fim } = limites;
    const linhas = [];
    for (let i = 0; i < blocos.length; i++) {
      const s = inicio[i];
      const e = Math.max(fim[i], s + 0.01);
      const internas = uteis.filter((p) => p.inicio >= s && p.fim <= e);
      for (const l of linhasDoBloco(blocos[i], s, e, internas)) {
        linhas.push({ inicio: base + l.inicio, fim: base + l.fim, texto: l.texto });
      }
    }

    resultado.push({ id: it.id, dur, linhas });
    base += dur;
  }

  return resultado;
}

/**
 * Escreve o arquivo .ass a partir das linhas já calculadas.
 * @returns {Promise<string>} caminho do arquivo
 */
export async function gerarAssLegendas(linhas, outDir, slug, { width = 1920, height = 1080 } = {}) {
  const vertical = height > width;
  const fontSize = vertical ? FONTE_TAMANHO_VERT : FONTE_TAMANHO_HD;

  const cabecalho = `[Script Info]
Title: Legenda ${slug}
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&HAA000000,-1,0,0,0,100,100,0,0,1,3,2,2,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogo = [];
  for (const cena of linhas) {
    for (const l of cena.linhas) {
      dialogo.push(`Dialogue: 0,${toAssTime(l.inicio)},${toAssTime(l.fim)},Default,,0,0,0,,${escaparAss(l.texto)}`);
    }
  }

  const assPath = join(outDir, 'legendas.ass');
  await writeFile(assPath, cabecalho + dialogo.join('\n') + '\n', 'utf8');
  return assPath;
}

/**
 * Gera o arquivo .ass com legendas sincronizadas para todas as cenas.
 *
 * @param {Object} roteiro     — roteiro.json do testemunho
 * @param {Array}  itens       — [{id, audio, dur, narracao}]
 * @param {string} outDir      — diretório de saída do testemunho
 * @param {Object} opts        — {width, height}
 * @returns {string}           — caminho absoluto do arquivo .ass gerado
 */
export async function gerarLegendas(roteiro, itens, outDir, { width = 1920, height = 1080 } = {}) {
  const linhas = await calcularLinhasLegenda(itens);
  return gerarAssLegendas(linhas, outDir, roteiro.slug, { width, height });
}

// ---- Standalone ----
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Uso: node gerar_legendas.mjs output/testemunhos/<slug>/roteiro.json');
    process.exit(1);
  }

  const roteiroPath = args[0];
  const outDir = dirname(roteiroPath);
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));

  // Mede duração dos áudios
  const itens = [];
  for (const c of roteiro.cenas || []) {
    const audioPath = join(outDir, `${c.id}-narracao.mp3`);
    if (!existsSync(audioPath)) {
      console.error(`[aviso] Áudio não encontrado: ${audioPath}, ignorando cena ${c.id}`);
      continue;
    }
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      audioPath,
    ]);
    const dur = parseFloat(stdout.trim());
    itens.push({ id: c.id, audio: audioPath, dur, narracao: c.narracao || '' });
  }

  const vertical = roteiro.formato === '9:16';
  const width = vertical ? 1080 : 1920;
  const height = vertical ? 1920 : 1080;

  const assPath = await gerarLegendas(roteiro, itens, outDir, { width, height });
  console.log(JSON.stringify({ ass: assPath }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[erro] ${err.message}`);
    process.exit(1);
  });
}
