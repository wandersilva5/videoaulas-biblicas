/**
 * montar_video_testemunho.mjs — Renderiza o vídeo final do testemunho
 * a partir de roteiro.json, com cenas minimalistas, narração sincronizada,
 * música reflexiva em loop e legendas.
 *
 * Cada cena é ilustrada por VÁRIAS imagens (`cena-XX-img-NN.png`): dentro da
 * duração da narração elas se revezam com movimento de câmera (zoom in/out e
 * panorâmica — efeito Ken Burns) e crossfade entre elas, para a história não
 * ficar presa a um quadro parado.
 *
 * Suporta formatos 16:9 (1920x1080) e 9:16 (1080x1920).
 *
 * Uso:
 *   node montar_video_testemunho.mjs output/testemunhos/<slug>/roteiro.json
 */

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { esc, musicaFundo, prepararMusicaEmLoop, imagensDaCenaTestemunho } from './util.mjs';
import { calcularLinhasLegenda, gerarAssLegendas } from './gerar_legendas.mjs';

// Desativa legendas queimadas com LEGENDA_TESTEMUNHO=0
const LEGENDA_ATIVA = process.env.LEGENDA_TESTEMUNHO !== '0';
// Desativa o movimento de câmera (zoom/pan) com TESTEMUNHO_MOVIMENTO=0
const MOVIMENTO_ATIVO = process.env.TESTEMUNHO_MOVIMENTO !== '0';
// Crossfade entre imagens da mesma cena (0 = corte seco)
const TRANSICAO_SEG = Math.max(0, Number(process.env.TESTEMUNHO_TRANSICAO_SEG || 0.5));
// Intensidade do zoom/pan (fração do quadro)
const ZOOM_AMP = Math.max(0.02, Number(process.env.TESTEMUNHO_ZOOM || 0.1));
// Tempo mínimo de tela para cada imagem da cena (evita flashes em cenas curtas)
const MIN_SEG_IMAGEM = Math.max(0.8, Number(process.env.TESTEMUNHO_MIN_SEG_IMAGEM || 2.5));

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS_DIR, '..');

const FPS = Number(process.env.VIDEO_FPS) || 24;
const MUSICA_FUNDO = process.env.MUSICA_FUNDO ?? musicaFundo();
const MUSICA_VOLUME_DB = Number(process.env.MUSICA_VOLUME_DB || -30);
const MUSICA_FADE_IN_SEC = Number(process.env.MUSICA_FADE_IN_SEC || 2);
const MUSICA_FADE_OUT_SEC = Number(process.env.MUSICA_FADE_OUT_SEC || 3);

async function medirDuracaoMp3(path) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    path
  ]);
  return parseFloat(stdout.trim());
}

function rodarFfmpeg(args, rotulo) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${rotulo} (exit ${code}): ${stderr.slice(-600)}`));
    });
  });
}

/**
 * Movimento de câmera de cada imagem (efeito Ken Burns). Os presets se
 * alternam pela posição da imagem na cena, então dois quadros seguidos nunca
 * têm o mesmo movimento. Retorna o filtro `zoompan` já dimensionado.
 */
function filtroMovimento(idx, frames, width, height) {
  const s = `${width}x${height}`;
  const centro = "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
  const variacoes = MOVIMENTO_ATIVO
    ? [
        // zoom in contínuo
        `z='1+${ZOOM_AMP}*on/${frames}':${centro}`,
        // zoom out contínuo
        `z='${(1 + ZOOM_AMP).toFixed(4)}-${ZOOM_AMP}*on/${frames}':${centro}`,
        // panorâmica da esquerda para a direita
        `z='${(1 + ZOOM_AMP * 1.2).toFixed(4)}':x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`,
        // panorâmica da direita para a esquerda
        `z='${(1 + ZOOM_AMP * 1.2).toFixed(4)}':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`,
        // panorâmica de cima para baixo
        `z='${(1 + ZOOM_AMP * 1.2).toFixed(4)}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*on/${frames}'`,
        // zoom in com deriva lateral suave
        `z='1+${ZOOM_AMP}*on/${frames}':x='iw/2-(iw/zoom/2)+(iw-iw/zoom)*0.25*(on/${frames}-0.5)':y='ih/2-(ih/zoom/2)'`,
      ]
    : [`z='1':${centro}`];
  const mov = variacoes[idx % variacoes.length];
  return `zoompan=${mov}:d=${frames}:s=${s}:fps=${FPS}`;
}

/** Escolhe quantas imagens da cena cabem na duração da narração (sem flashes). */
function limitarImagens(imagens, dur) {
  const max = Math.max(1, Math.floor(dur / MIN_SEG_IMAGEM));
  if (imagens.length <= max) return imagens;
  const escolhidas = [];
  for (let i = 0; i < max; i++) {
    escolhidas.push(imagens[Math.round((i * (imagens.length - 1)) / (max - 1 || 1))]);
  }
  return escolhidas;
}

/**
 * Fallback: queima legendas diretamente via drawtext quando libass não está
 * disponível. Usa as linhas já alinhadas com as pausas reais do áudio.
 */
async function queimardrawtextFallback(linhasPorCena, videoIn, videoOut, width, height) {
  const marginV = Math.round(height * 0.06); // 6% da altura
  const fontSize = width >= 1920 ? 52 : 44;

  const eventos = linhasPorCena.flatMap((c) => c.linhas || []);
  const filtros = eventos.map((l) => {
    // Escapa caracteres especiais para drawtext
    const textoEsc = (l.texto || '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/:/g, '\\:')
      .replace(/%/g, '\\%');

    return (
      `drawtext=text='${textoEsc}':fontsize=${fontSize}:fontcolor=white:` +
      `borderw=3:bordercolor=black:shadowx=2:shadowy=2:` +
      `x=(w-text_w)/2:y=h-${marginV + fontSize}:` +
      `enable='between(t,${l.inicio.toFixed(3)},${l.fim.toFixed(3)})'`
    );
  });

  const filtroStr = filtros.join(',');

  await rodarFfmpeg([
    '-y',
    '-i', videoIn,
    '-vf', filtroStr || 'null',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-c:a', 'copy',
    '-pix_fmt', 'yuv420p',
    videoOut,
  ], 'Fallback drawtext falhou');
}

/**
 * Monta o vídeo final utilizando ffmpeg diretamente para garantir transições
 * perfeitas entre cada imagem de cena e seu respectivo áudio.
 */
export async function renderizarVideoTestemunho(roteiro, outDir) {
  const vertical = roteiro.formato === '9:16';
  const width = vertical ? 1080 : 1920;
  const height = vertical ? 1920 : 1080;
  const cenas = roteiro.cenas || [];

  if (!cenas.length) throw new Error('Roteiro sem cenas para renderizar.');

  console.error(`[montar_video] Verificando artefatos das ${cenas.length} cenas...`);
  const itens = [];
  const faltantes = [];

  for (const c of cenas) {
    const audioPath = join(outDir, `${c.id}-narracao.mp3`);
    const audioExiste = existsSync(audioPath);
    const dur = audioExiste ? await medirDuracaoMp3(audioPath) : 0;
    // Usa só as imagens já geradas e, se a cena for curta, menos imagens
    // (cada uma precisa de um tempo mínimo de tela para não virar flash).
    const imagens = limitarImagens(
      imagensDaCenaTestemunho(c, outDir).filter((i) => i.existe),
      dur,
    );
    if (!imagens.length) faltantes.push(`Imagem ausente: ${c.id}.png`);
    if (!audioExiste) faltantes.push(`Áudio ausente: ${c.id}-narracao.mp3`);

    if (imagens.length && audioExiste) {
      itens.push({
        id: c.id,
        audio: audioPath,
        dur,
        narracao: c.narracao || '',
        imagens: imagens.map((i) => i.atual),
      });
    }
  }

  if (faltantes.length > 0) {
    throw new Error(`Não é possível montar o vídeo. Faltam artefatos:\n${faltantes.join('\n')}`);
  }

  // Gera o arquivo de legendas ASS antes de renderizar os clipes
  let assPath = null;
  let linhasLegenda = null;
  if (LEGENDA_ATIVA) {
    try {
      console.error('[montar_video] Gerando legendas sincronizadas (.ass)...');
      // As linhas são ancoradas nas pausas reais de cada áudio, então a legenda
      // acompanha o ritmo da narração em vez de uma estimativa linear.
      linhasLegenda = await calcularLinhasLegenda(itens);
      assPath = await gerarAssLegendas(linhasLegenda, outDir, roteiro.slug, { width, height });
      console.error(`[montar_video] Legendas geradas: ${assPath}`);
    } catch (e) {
      console.error(`[montar_video][aviso] Falha ao gerar legendas: ${e.message}. Continuando sem legendas.`);
      assPath = null;
      linhasLegenda = null;
    }
  }

  const tempClipsDir = join(outDir, '.temp_clips');
  await mkdir(tempClipsDir, { recursive: true });

  const clipPaths = [];
  const total = itens.length;
  const escala = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;

  for (let i = 0; i < total; i++) {
    const it = itens[i];
    const n = it.imagens.length;

    // Duração de cada imagem: os crossfades "comem" (n-1) * transição, então
    // cada tela é ligeiramente mais longa para o total fechar na duração do
    // áudio (evita dessincronia acumulada entre as cenas).
    const transicao = n > 1 ? Math.min(TRANSICAO_SEG, (it.dur / n) * 0.35) : 0;
    const fatia = (it.dur + transicao * (n - 1)) / n;

    const pct = Math.round(((i + 1) / total) * 70);
    console.error(`${pct}% Renderizando cena ${i + 1}/${total} (${it.id}) com ${n} imagem(ns)...`);

    const slicePaths = [];
    for (let j = 0; j < n; j++) {
      const sliceOut = join(tempClipsDir, `${it.id}-img-${String(j + 1).padStart(2, '0')}.mp4`);
      slicePaths.push(sliceOut);
      const frames = Math.max(1, Math.round(fatia * FPS));
      const vf = MOVIMENTO_ATIVO
        ? `${escala},${filtroMovimento(j, frames, width, height)}`
        : escala;

      await rodarFfmpeg([
        '-y',
        '-loop', '1',
        '-i', it.imagens[j],
        '-vf', vf,
        '-r', String(FPS),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        // -t aqui é opção de SAÍda (limita o clipe à Fatia); antes de -i ela
        // limitaria a entrada e o zoompan geraria d frames por frame lido.
        '-t', fatia.toFixed(3),
        sliceOut,
      ], `Falha ao gerar clipe da ${it.id} (imagem ${j + 1})`);
    }

    // Junta as imagens da cena: crossfade quando há mais de uma.
    const cenaOut = join(tempClipsDir, `${it.id}.mp4`);
    clipPaths.push(cenaOut);

    if (n > 1 && transicao > 0) {
      const entradas = slicePaths.flatMap((p) => ['-i', p]);
      const cadeia = [];
      let anterior = '[0:v]';
      for (let j = 1; j < n; j++) {
        const saida = j === n - 1 ? '[vout]' : `[x${j}]`;
        const offset = (fatia * j - transicao * j).toFixed(3);
        cadeia.push(`${anterior}[${j}:v]xfade=transition=fade:duration=${transicao.toFixed(3)}:offset=${offset}${saida}`);
        anterior = saida;
      }
      await rodarFfmpeg([
        '-y',
        ...entradas,
        '-filter_complex', cadeia.join(';'),
        '-map', '[vout]',
        '-r', String(FPS),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        cenaOut,
      ], `Falha ao cruzar imagens da ${it.id}`);
    } else {
      const concatList = join(tempClipsDir, `${it.id}-slices.txt`);
      await writeFile(concatList, slicePaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf8');
      await rodarFfmpeg([
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatList,
        '-c', 'copy',
        cenaOut,
      ], `Falha ao unir imagens da ${it.id}`);
    }

    // Anexa a narração da cena (o vídeo já tem a duração certa por construção).
    const cenaComAudio = join(tempClipsDir, `${it.id}-audio.mp4`);
    await rodarFfmpeg([
      '-y',
      '-i', cenaOut,
      '-i', it.audio,
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', it.dur.toFixed(3),
      cenaComAudio,
    ], `Falha ao sincronizar áudio da ${it.id}`);
    clipPaths[clipPaths.length - 1] = cenaComAudio;
  }

  console.error('75% Concatenando cenas do testemunho...');
  const concatListFile = join(tempClipsDir, 'clips.txt');
  const concatContent = clipPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  await writeFile(concatListFile, concatContent, 'utf8');

  const videoSemMusica = join(tempClipsDir, 'uniao_cenas.mp4');
  await rodarFfmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListFile,
    '-c', 'copy',
    videoSemMusica,
  ], 'Falha na concatenação das cenas');

  const duracaoTotal = await medirDuracaoMp3(videoSemMusica);
  const outMp4Nome = `${roteiro.slug}-${width}x${height}.mp4`;
  const outMp4Path = join(outDir, outMp4Nome);

  // Arquivo intermediário: se tiver legenda, o passo de legendas vem antes da música
  const videoParaMusica = assPath ? join(tempClipsDir, 'com_legendas.mp4') : videoSemMusica;

  if (assPath) {
    console.error('77% Queimando legendas no vídeo...');
    // No Windows, o caminho no filtro subtitles= precisa usar / e o ':' do drive
    // precisa ser escapado como '\:' para o parser de filtros do ffmpeg.
    const assEscaped = assPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
    try {
      await rodarFfmpeg([
        '-y',
        '-i', videoSemMusica,
        '-vf', `subtitles='${assEscaped}'`,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-c:a', 'copy',
        '-pix_fmt', 'yuv420p',
        videoParaMusica,
      ], 'subtitles= falhou');
    } catch (e) {
      // Se o subtitles= falhar (libass não compilado), tenta drawtext como fallback
      console.error(`[montar_video][aviso] ${e.message} — tentando drawtext...`);
      await queimardrawtextFallback(linhasLegenda || [], videoSemMusica, videoParaMusica, width, height);
    }
  }

  // Mixagem de trilha sonora sutil se existir
  if (MUSICA_FUNDO && existsSync(MUSICA_FUNDO)) {
    console.error('85% Mixando música de fundo reflexiva...');
    const bgMusicLoop = join(tempClipsDir, 'musica_loop.mp3');
    await prepararMusicaEmLoop(MUSICA_FUNDO, duracaoTotal, bgMusicLoop);

    const mixArgs = [
      '-y',
      '-i', videoParaMusica,
      '-i', bgMusicLoop,
      '-filter_complex',
      `[1:a]volume=${MUSICA_VOLUME_DB}dB,afade=t=in:st=0:d=${MUSICA_FADE_IN_SEC},afade=t=out:st=${Math.max(0, duracaoTotal - MUSICA_FADE_OUT_SEC)}:d=${MUSICA_FADE_OUT_SEC}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      outMp4Path
    ];

    await rodarFfmpeg(mixArgs, 'Falha na mixagem da música');
  } else {
    console.error('90% Finalizando vídeo...');
    await copyFile(videoParaMusica, outMp4Path);
  }

  console.error(`100% Vídeo concluído com sucesso: ${outMp4Nome}`);
  return { path: outMp4Path, arquivo: outMp4Nome, duracao: duracaoTotal };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Uso: node montar_video_testemunho.mjs output/testemunhos/<slug>/roteiro.json');
    process.exit(1);
  }

  const roteiroPath = args[0];
  const outDir = dirname(roteiroPath);
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));

  const res = await renderizarVideoTestemunho(roteiro, outDir);
  console.log(JSON.stringify(res, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[erro] ${err.message}`);
    process.exit(1);
  });
}
