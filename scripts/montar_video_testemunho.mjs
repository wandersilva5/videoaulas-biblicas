/**
 * montar_video_testemunho.mjs — Renderiza o vídeo final do testemunho
 * a partir de roteiro.json, com cenas minimalistas, imagem em destaque,
 * narração sincronizada e música reflexiva em loop.
 *
 * Suporta formatos 16:9 (1920x1080) e 9:16 (1080x1920).
 *
 * Uso:
 *   node montar_video_testemunho.mjs output/testemunhos/<slug>/roteiro.json
 */

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { esc, musicaFundo, prepararMusicaEmLoop } from './util.mjs';
import { calcularLinhasLegenda, gerarAssLegendas } from './gerar_legendas.mjs';

// Desativa legendas queimadas com LEGENDA_TESTEMUNHO=0
const LEGENDA_ATIVA = process.env.LEGENDA_TESTEMUNHO !== '0';

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

  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', videoIn,
      '-vf', filtroStr || 'null',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'copy',
      '-pix_fmt', 'yuv420p',
      videoOut,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Fallback drawtext falhou (exit ${code}): ${stderr.slice(-600)}`));
    });
  });
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
    const imgPath = join(outDir, `${c.id}.png`);
    const audioPath = join(outDir, `${c.id}-narracao.mp3`);
    if (!existsSync(imgPath)) faltantes.push(`Imagem ausente: ${c.id}.png`);
    if (!existsSync(audioPath)) faltantes.push(`Áudio ausente: ${c.id}-narracao.mp3`);

    if (existsSync(imgPath) && existsSync(audioPath)) {
      const dur = await medirDuracaoMp3(audioPath);
      itens.push({ id: c.id, img: imgPath, audio: audioPath, dur, narracao: c.narracao || '' });
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

  for (let i = 0; i < total; i++) {
    const it = itens[i];
    const pct = Math.round(((i + 1) / total) * 70);
    console.error(`${pct}% Renderizando cena ${i + 1}/${total} (${it.id})...`);

    const clipOut = join(tempClipsDir, `${it.id}.mp4`);
    clipPaths.push(clipOut);

    // Gera o clipe MP4 com imagem estática dimensionada e áudio sincronizado
    // Usa scale e pad para manter o aspect ratio original sem distorcer
    // As legendas são queimadas no passo final (não por clipe) para que o
    // timestamp do .ass seja relativo ao vídeo completo.
    const ffmpegArgs = [
      '-y',
      '-loop', '1',
      '-i', it.img,
      '-i', it.audio,
      '-c:v', 'libx264',
      '-tune', 'stillimage',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      '-t', String(it.dur + 0.1),
      clipOut
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Falha ao gerar clipe da ${it.id} (exit ${code}): ${stderr.slice(-600)}`));
      });
    });
  }

  console.error('75% Concatenando cenas do testemunho...');
  const concatListFile = join(tempClipsDir, 'clips.txt');
  const concatContent = clipPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
  await writeFile(concatListFile, concatContent, 'utf8');

  const videoSemMusica = join(tempClipsDir, 'uniao_cenas.mp4');
  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListFile,
      '-c', 'copy',
      videoSemMusica
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Falha na concatenação das cenas (exit ${code}): ${stderr.slice(-600)}`));
    });
  });

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
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-i', videoSemMusica,
        '-vf', `subtitles='${assEscaped}'`,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-c:a', 'copy',
        '-pix_fmt', 'yuv420p',
        videoParaMusica,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else {
          // Se o subtitles= falhar (libass não compilado), tenta drawtext como fallback
          console.error(`[montar_video][aviso] subtitles= falhou (exit ${code}), tentando drawtext...`);
          resolve('fallback');
        }
      });
    }).then(async (res) => {
      if (res === 'fallback') {
        // Fallback: drawtext direto com as linhas já alinhadas
        await queimardrawtextFallback(linhasLegenda || [], videoSemMusica, videoParaMusica, width, height);
      }
    });
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

    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', mixArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Falha na mixagem da música (exit ${code}): ${stderr.slice(-600)}`));
      });
    });
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
