/**
 * gerar_legendas.mjs — Gera arquivo .ass com legendas sincronizadas para o
 * vídeo de testemunho a partir do roteiro.json + durações de cada cena.
 *
 * Cada cena tem sua narração dividida em chunks de PALAVRAS_POR_LINHA palavras.
 * O tempo de cada chunk é proporcional ao número de palavras (leitura linear).
 *
 * Uso (standalone):
 *   node scripts/gerar_legendas.mjs output/testemunhos/<slug>/roteiro.json
 *
 * Uso (importado):
 *   import { gerarLegendas } from './gerar_legendas.mjs';
 *   const assPath = await gerarLegendas(roteiro, itens, outDir, { width, height });
 */

import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Número máximo de palavras por linha de legenda
const PALAVRAS_POR_LINHA = Number(process.env.LEGENDA_PALAVRAS_POR_LINHA) || 6;

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

/**
 * Divide um texto em chunks de N palavras.
 * Retorna array de strings.
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
 * Gera o arquivo .ass com legendas sincronizadas para todas as cenas.
 *
 * @param {Object} roteiro     — roteiro.json do testemunho
 * @param {Array}  itens       — [{id, dur}] — duração em segundos de cada cena
 * @param {string} outDir      — diretório de saída do testemunho
 * @param {Object} opts        — {width, height}
 * @returns {string}           — caminho absoluto do arquivo .ass gerado
 */
export async function gerarLegendas(roteiro, itens, outDir, { width = 1920, height = 1080 } = {}) {
  const vertical = height > width;
  const fontSize = vertical ? FONTE_TAMANHO_VERT : FONTE_TAMANHO_HD;

  // Cabeçalho do arquivo ASS
  const cabecalho = `[Script Info]
Title: Legenda ${roteiro.slug}
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

  const linhas = [cabecalho];

  // Mapa id→cena para pegar a narração
  const cenaMap = Object.fromEntries((roteiro.cenas || []).map((c) => [c.id, c]));

  let tempoAcumulado = 0;

  for (const item of itens) {
    const cena = cenaMap[item.id];
    if (!cena) { tempoAcumulado += item.dur; continue; }

    const narracao = (cena.narracao || '').trim();
    if (!narracao) { tempoAcumulado += item.dur; continue; }

    const chunks = dividirEmLinhas(narracao, PALAVRAS_POR_LINHA);
    const totalPalavras = narracao.split(/\s+/).filter(Boolean).length;

    // Distribui o tempo proporcionalmente ao número de palavras por chunk
    let t = tempoAcumulado;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const palavrasChunk = chunk.split(/\s+/).filter(Boolean).length;
      const proporcao = palavrasChunk / totalPalavras;
      // Duração bruta proporcional, com pequena folga (0.05s) no início para não
      // mostrar a legenda antes do narrador começar a falar.
      const inicio = i === 0 ? t + 0.05 : t;
      const durChunk = item.dur * proporcao;
      const fim = t + durChunk;

      const texto = chunk.replace(/,/g, '{\\,}'); // escapa vírgula no ASS
      linhas.push(`Dialogue: 0,${toAssTime(inicio)},${toAssTime(fim)},Default,,0,0,0,,${texto}`);
      t = fim;
    }

    tempoAcumulado += item.dur;
  }

  const assPath = join(outDir, 'legendas.ass');
  await writeFile(assPath, linhas.join('\n'), 'utf8');
  return assPath;
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

  const { readFile } = await import('node:fs/promises');
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
    itens.push({ id: c.id, dur });
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
