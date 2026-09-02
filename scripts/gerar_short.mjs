/**
 * gerar_short.mjs — Gera um YouTube Short (vertical 9:16, <60s) a partir
 * de um roteiro promocional próprio (roteiro-short.json) com narração otimizada para Shorts.
 *
 * O roteiro do short contém:
 *  - introducao: narração completa do short (hook → problema → valor → autoridade → CTA)
 *  - slides: vazio (o short é uma peça única, não slide a slide)
 *  - imagens: usa capa de abertura (slide-00.png) + imagens dos primeiros slides do curso + capa de encerramento
 *
 * Uso: node gerar_short.mjs <caminho/roteiro-short.json>
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prefixoNarracao, esc, musicaFundo, dirsEstudo, garantirDirsEstudo, exportarMp4ComRetry } from './util.mjs';
import {
  AssetStore,
  EngineRegistry,
  ProjectOrchestrator,
  ProjectStore,
  TemplateRegistry,
} from '@html-video/core';
import hfAdapter from '@html-video/adapter-hyperframes';

const execFileAsync = promisify(execFile);
const HTML_VIDEO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const FPS = Number(process.env.VIDEO_FPS) || 24;
const WIDTH = Number(process.env.VIDEO_WIDTH) || 1080;
const HEIGHT = Number(process.env.VIDEO_HEIGHT) || 1920;
const SLIDE_PADDING_SEC = process.env.VIDEO_PADDING !== undefined && process.env.VIDEO_PADDING !== '' ? Number(process.env.VIDEO_PADDING) : 0.2;

const MUSICA_FUNDO = process.env.MUSICA_FUNDO ?? musicaFundo();
const MUSICA_VOLUME_DB = Number(process.env.MUSICA_VOLUME_DB || -20);
const MUSICA_FADE_IN_SEC = Number(process.env.MUSICA_FADE_IN_SEC || 1);

const MAX_DURACAO_SHORT = 58;

const s = (v) => (v * (WIDTH / 1080)).toFixed(1);

async function medirDuracaoMp3(path) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return parseFloat(stdout.trim());
}

async function concatAudios(audios, outPath) {
  const { spawn } = await import('node:child_process');
  const args = ['-y'];
  const n = audios.length;
  const filters = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    args.push('-i', audios[i].path);
    filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    labels.push(`[a${i}]`);
    if (i < n - 1) {
      filters.push(`anullsrc=r=44100:cl=stereo:d=${SLIDE_PADDING_SEC}[pad${i}]`);
      labels.push(`[pad${i}]`);
    }
  }
  filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '192k', outPath);

  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat audio exit ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

function gerarFrameShortIntro(roteiro, imagePath) {
  const imgName = basename(imagePath);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Short Intro</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; }
  .bg img { width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 70% at 50% 40%, rgba(13,27,42,0.75) 0%, rgba(13,27,42,0.4) 50%, rgba(13,27,42,0) 75%), linear-gradient(180deg, rgba(13,27,42,0.6) 0%, rgba(13,27,42,0.85) 100%); }
  .halo { position: absolute; width: ${s(700)}px; height: ${s(700)}px; border-radius: 50%; left: 50%; top: 35%; transform: translate(-50%, -50%); background: radial-gradient(circle, rgba(224,180,90,0.3) 0%, rgba(224,180,90,0.05) 50%, transparent 70%); animation: pulse 3s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.7; } 50% { transform: translate(-50%,-50%) scale(1.1); opacity: 1; } }
  .inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 ${s(80)}px; }
  .brand { position: absolute; top: ${s(60)}px; left: 0; right: 0; text-align: center; font-size: ${s(36)}px; letter-spacing: ${s(8)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; text-shadow: 0 2px 8px rgba(0,0,0,0.95), 0 0 24px rgba(0,0,0,0.6); opacity: 0; animation: fadeUp 0.5s ease-out 0.1s forwards; }
  .kicker { font-size: ${s(28)}px; letter-spacing: ${s(6)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: ${s(20)}px; text-shadow: 0 2px 8px rgba(0,0,0,0.95), 0 0 24px rgba(0,0,0,0.6); opacity: 0; animation: fadeUp 0.5s ease-out 0.2s forwards; }
  h1 { font-size: ${s(78)}px; color: #ffffff; font-weight: 700; line-height: 1.1; max-width: ${s(900)}px; margin-bottom: ${s(20)}px; text-shadow: 0 2px 6px rgba(0,0,0,0.95), 0 4px 22px rgba(0,0,0,0.75), 0 0 40px rgba(0,0,0,0.45); opacity: 0; animation: fadeUp 0.6s ease-out 0.5s forwards; }
  .sub { font-size: ${s(30)}px; color: #dce5ef; text-shadow: 0 2px 6px rgba(0,0,0,0.95), 0 3px 16px rgba(0,0,0,0.75); opacity: 0; animation: fadeUp 0.6s ease-out 0.9s forwards; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(${s(30)}px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="bg"><img src="${esc(imgName)}" /></div>
  <div class="veil"></div>
  <div class="halo"></div>
  <div class="brand">Teologia Pra Todos</div>
  <div class="inner">
    <div class="kicker">Teologia Básica</div>
    <h1>${esc(roteiro.titulo_aula)}</h1>
    <div class="sub">O que você precisa saber em 60 segundos</div>
  </div>
</body>
</html>`;
}

function gerarFrameShortConteudo(roteiro, imagePath, textoVisivel) {
  const imgName = basename(imagePath);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Short Conteúdo</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; }
  .bg { position: absolute; inset: 0; }
  .bg img { width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,27,42,0.15) 0%, rgba(13,27,42,0.4) 45%, rgba(13,27,42,0.85) 100%); }
  .content { position: absolute; inset: 0; padding: ${s(60)}px ${s(60)}px; display: flex; flex-direction: column; justify-content: center; }
  .card { background: linear-gradient(160deg, rgba(13,27,42,0.82) 0%, rgba(13,27,42,0.65) 100%); border: 1px solid rgba(224,180,90,0.35); border-radius: ${s(24)}px; padding: ${s(36)}px ${s(48)}px; max-width: ${s(940)}px; box-shadow: 0 8px 40px rgba(0,0,0,0.5); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  .kicker { font-size: ${s(24)}px; letter-spacing: ${s(4)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: ${s(12)}px; opacity: 0; animation: fadeUp 0.4s ease-out 0.1s forwards; }
  .texto { font-size: ${s(42)}px; color: #ffffff; font-weight: 500; line-height: 1.2; text-shadow: 0 3px 18px rgba(0,0,0,0.55); opacity: 0; animation: fadeUp 0.5s ease-out 0.2s forwards; }
  .foot { position: absolute; top: 0; left: 0; right: 0; padding: ${s(30)}px ${s(60)}px; display: flex; justify-content: space-between; align-items: center; color: rgba(255,255,255,0.75); font-size: ${s(20)}px; letter-spacing: ${s(2)}px; }
  .foot .brand { color: #e0b45a; font-weight: 700; text-transform: uppercase; letter-spacing: ${s(4)}px; background: linear-gradient(90deg, rgba(13,27,42,0.85) 0%, rgba(13,27,42,0.55) 60%, rgba(13,27,42,0) 100%); border-left: ${s(4)}px solid #e0b45a; padding: ${s(10)}px ${s(20)}px; border-radius: ${s(8)}px; text-shadow: 0 2px 8px rgba(0,0,0,0.8); }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(${s(20)}px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="bg"><img src="${esc(imgName)}" /></div>
  <div class="veil"></div>
  <div class="foot">
    <span class="brand">${esc(roteiro.titulo_aula)}</span>
  </div>
  <div class="content">
    <div class="card">
      <div class="kicker">Teologia Básica</div>
      <div class="texto">${esc(textoVisivel)}</div>
    </div>
  </div>
</body>
</html>`;
}

function gerarFrameShortOutro(imagePath) {
  const imgName = basename(imagePath);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Short Conclusão</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; display: flex; align-items: center; justify-content: center; }
  .bg { position: absolute; inset: 0; }
  .bg img { width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 70% at 50% 50%, rgba(13,27,42,0.8) 0%, rgba(13,27,42,0.45) 50%, rgba(13,27,42,0) 75%), linear-gradient(180deg, rgba(13,27,42,0.6) 0%, rgba(13,27,42,0.85) 100%); }
  .card { position: relative; text-align: center; padding: 0 ${s(40)}px; max-width: ${s(940)}px; }
  .kicker { font-size: ${s(28)}px; letter-spacing: ${s(6)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: ${s(24)}px; text-shadow: 0 2px 8px rgba(0,0,0,0.95), 0 0 24px rgba(0,0,0,0.6); opacity: 0; animation: fadeUp 0.5s ease-out 0.2s forwards; }
  h1 { font-size: ${s(72)}px; color: #ffffff; font-weight: 700; margin-bottom: ${s(18)}px; text-shadow: 0 2px 6px rgba(0,0,0,0.95), 0 4px 22px rgba(0,0,0,0.75), 0 0 40px rgba(0,0,0,0.45); opacity: 0; animation: fadeUp 0.6s ease-out 0.5s forwards; }
  .thanks { font-size: ${s(28)}px; color: #dce5ef; text-shadow: 0 2px 6px rgba(0,0,0,0.95), 0 3px 16px rgba(0,0,0,0.75); opacity: 0; animation: fadeUp 0.6s ease-out 0.9s forwards; }
  .brand { font-size: ${s(36)}px; letter-spacing: ${s(8)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-top: ${s(40)}px; text-shadow: 0 2px 8px rgba(0,0,0,0.95), 0 0 24px rgba(0,0,0,0.6); opacity: 0; animation: fadeUp 0.6s ease-out 1.2s forwards; }
  .cta { margin-top: ${s(30)}px; font-size: ${s(24)}px; color: #e0b45a; opacity: 0; animation: fadeUp 0.6s ease-out 1.5s forwards; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(${s(20)}px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="bg"><img src="${esc(imgName)}" /></div>
  <div class="veil"></div>
  <div class="card">
    <div class="kicker">Conclusão</div>
    <h1>Quer aprofundar?</h1>
    <div class="thanks">Assista a aula completa no canal</div>
    <div class="brand">Teologia Pra Todos</div>
    <div class="cta">👆 Toque no link na bio</div>
  </div>
</body>
</html>`;
}

function dividirNarracaoEmSegmentos(narracao, numSegmentos) {
  const palavras = narracao.trim().split(/\s+/);
  const porSegmento = Math.ceil(palavras.length / numSegmentos);
  const segmentos = [];
  for (let i = 0; i < numSegmentos; i++) {
    const ini = i * porSegmento;
    const fim = Math.min(ini + porSegmento, palavras.length);
    if (ini >= fim) break;
    segmentos.push(palavras.slice(ini, fim).join(' '));
  }
  return segmentos;
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_short.mjs <caminho/roteiro-short.json>');
    process.exit(1);
  }
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);
  const slug = roteiro.slug || basename(outDir);
  await garantirDirsEstudo(outDir);
  const { imagens: imagensDir, videos: videosDir } = dirsEstudo(outDir);

  console.error('[Short] Gerando YouTube Short promocional ...');

  const narracaoCompleta = roteiro._short_narracao || roteiro.introducao;
  if (!narracaoCompleta || !narracaoCompleta.trim()) {
    throw new Error('Roteiro do short não contém narração (_short_narracao ou introducao)');
  }

  const roteiroOriginalPath = join(outDir, 'roteiro.json');
  const roteiroOriginal = existsSync(roteiroOriginalPath) ? JSON.parse(await readFile(roteiroOriginalPath, 'utf8')) : null;

  const numSegmentosVisuais = 3;
  const segmentosTexto = dividirNarracaoEmSegmentos(narracaoCompleta, numSegmentosVisuais);

  const tempNarracaoDir = join(outDir, '.short-narracao');
  await mkdir(tempNarracaoDir, { recursive: true });

  const { gerarNarracaoItem } = await import('./gerar_narracao.mjs');
  const audios = [];

console.error('  Gerando narração do short via TTS...');
  const narracaoItem = {
    id: 'short-full',
    titulo: 'Narração completa do Short',
    texto: narracaoCompleta,
    prefix: 'short-full',
  };
  const narracaoPath = join(tempNarracaoDir, `${narracaoItem.prefix}-narracao.mp3`);
  await gerarNarracaoItem(narracaoItem, tempNarracaoDir);

  if (!existsSync(narracaoPath)) {
    throw new Error('Falha ao gerar narração do short');
  }

  const duracaoTotal = await medirDuracaoMp3(narracaoPath);
  console.error(`  Narração gerada: ${duracaoTotal.toFixed(1)}s`);

  if (duracaoTotal > MAX_DURACAO_SHORT) {
    console.error(`  Aviso: duração (${duracaoTotal.toFixed(1)}s) excede ${MAX_DURACAO_SHORT}s do Short.`);
  }

  const projectRoot = HTML_VIDEO_ROOT;
  const engines = new EngineRegistry();
  engines.register(hfAdapter);
  const templates = new TemplateRegistry();
  const templatesDir = join(projectRoot, 'templates');
  await templates.scan(templatesDir);
  const projects = new ProjectStore(projectRoot);
  const assets = new AssetStore({ projectRoot });
  const orchestrator = new ProjectOrchestrator({ projectRoot, engines, templates, projects, assets });

  const project = await orchestrator.create({
    name: `Short: ${roteiro.titulo_aula}`,
    preferences: {
      aspect: '9:16',
      resolution: { width: WIDTH, height: HEIGHT },
      fps: FPS,
      language: 'pt-BR',
    },
  });

  const nodes = [];
  const edges = [];

  const durIntro = Math.max(3, duracaoTotal * 0.15);
  const durConteudo = Math.max(3, (duracaoTotal - durIntro - 3) / numSegmentosVisuais);
  const durOutro = Math.max(3, duracaoTotal * 0.15);

  nodes.push({ id: 'intro', kind: 'text', label: 'Intro', durationSec: durIntro + SLIDE_PADDING_SEC });
  for (let i = 0; i < numSegmentosVisuais; i++) {
    nodes.push({ id: `conteudo-${i}`, kind: 'text', label: `Conteúdo ${i + 1}`, durationSec: durConteudo + SLIDE_PADDING_SEC });
    edges.push({ from: i === 0 ? 'intro' : `conteudo-${i - 1}`, to: `conteudo-${i}`, kind: 'sequence' });
  }
  nodes.push({ id: 'outro', kind: 'text', label: 'Outro', durationSec: durOutro + SLIDE_PADDING_SEC });
  edges.push({ from: `conteudo-${numSegmentosVisuais - 1}`, to: 'outro', kind: 'sequence' });

  const graph = { schemaVersion: 1, intent: 'short', synopsis: `Short: ${roteiro.titulo_aula}`, nodes, edges };
  await orchestrator.writeContentGraph(project.id, graph);

  const projectDir = await projects.ensureDir(project.id);
  const framesDir = join(projectDir, 'frames');
  const padFrame = (n) => `slide-${String(n).padStart(2, '0')}.png`;

  const capaIntro = join(imagensDir, padFrame(0));
  if (!existsSync(capaIntro)) throw new Error(`Imagem da introdução não encontrada: ${capaIntro}`);
  const capaIntroDest = join(framesDir, padFrame(0));
  await copyFile(capaIntro, capaIntroDest);
  await orchestrator.writeFrameHtml(project.id, 'intro', gerarFrameShortIntro(roteiro, capaIntroDest));

  const slidesParaUsar = roteiroOriginal?.slides?.slice(0, numSegmentosVisuais) || [];
  for (let i = 0; i < numSegmentosVisuais; i++) {
    const imgIdx = i + 1;
    const imgPath = join(imagensDir, padFrame(imgIdx));
    if (!existsSync(imgPath)) {
      console.error(`  Aviso: imagem ${imgPath} não encontrada, usando capa de intro`);
      await copyFile(capaIntro, join(framesDir, padFrame(imgIdx)));
    } else {
      await copyFile(imgPath, join(framesDir, padFrame(imgIdx)));
    }
    const textoSegmento = segmentosTexto[i] || '';
    await orchestrator.writeFrameHtml(
      project.id,
      `conteudo-${i}`,
      gerarFrameShortConteudo(roteiro, join(framesDir, padFrame(imgIdx)), textoSegmento),
    );
  }

  const capaConclIdx = roteiroOriginal?.slides?.length ? roteiroOriginal.slides.length + 1 : numSegmentosVisuais + 1;
  const capaConcl = join(imagensDir, padFrame(capaConclIdx));
  if (!existsSync(capaConcl)) {
    console.error(`  Aviso: imagem de conclusão não encontrada (${capaConcl}), usando slide-00`);
    await copyFile(capaIntro, join(framesDir, padFrame(numSegmentosVisuais + 1)));
  } else {
    await copyFile(capaConcl, join(framesDir, padFrame(numSegmentosVisuais + 1)));
  }
  await orchestrator.writeFrameHtml(project.id, 'outro', gerarFrameShortOutro(join(framesDir, padFrame(numSegmentosVisuais + 1))));

  const assetsProjeto = [];
  let proj = await orchestrator.addFileAsset(project.id, narracaoPath, 'Narração Short');
  assetsProjeto.push(proj.assets[proj.assets.length - 1]);
  if (MUSICA_FUNDO && existsSync(MUSICA_FUNDO)) {
    console.error(`  música de fundo: ${MUSICA_FUNDO} (${MUSICA_VOLUME_DB} dB, fade in ${MUSICA_FADE_IN_SEC}s)`);
    proj = await orchestrator.addFileAsset(project.id, MUSICA_FUNDO, 'Música de fundo');
    assetsProjeto.push(proj.assets[proj.assets.length - 1]);
  }
  proj.soundtrack = {
    narrationAssetId: assetsProjeto[0].id,
    narrationVolumeDb: 0,
  };
  if (assetsProjeto.length > 1) {
    proj.soundtrack.musicAssetId = assetsProjeto[1].id;
    proj.soundtrack.musicVolumeDb = MUSICA_VOLUME_DB;
    proj.soundtrack.fadeInSec = MUSICA_FADE_IN_SEC;
  }
  await projects.save(proj);

  console.error('  renderizando frames (Chromium + ffmpeg) ...');
  const outputPath = join(videosDir, `${slug}-short-${WIDTH}x${HEIGHT}.mp4`);
  await exportarMp4ComRetry(orchestrator, {
    projectId: project.id,
    outputPath,
    onProgress: (pct, stage) => console.error(`  ${pct.toFixed(0)}% ${stage}`),
  });

  console.error(`Short concluído: ${outputPath}`);
  console.log(JSON.stringify({ output_path: outputPath, project_id: project.id }));
}

if (process.argv[1]) {
  const scriptPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  const argPath = process.argv[1].replace(/\\/g, '/');
  if (scriptPath === argPath) {
    main().catch((e) => {
      console.error('ERRO:', e.message);
      if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
      process.exit(1);
    });
  }
}