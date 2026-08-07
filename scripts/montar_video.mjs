/**
 * montar_video.mjs — Renderiza uma videoaula a partir de um roteiro.json
 * usando o pipeline html-video (core API):
 *   - cada slide vira um frame HTML (imagem de fundo + título + pontos)
 *   - gera a narração concatenada em um MP3
 *   - renderiza frames via Chromium + ffmpeg e concatena
 *   - mixa a narração no MP4 final
 *
 * Uso: node montar_video.mjs <caminho/roteiro.json>
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { prefixoNarracao, esc } from './util.mjs';
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

const FPS = Number(process.env.VIDEO_FPS) || 30;
const WIDTH = Number(process.env.VIDEO_WIDTH) || 1920;
const HEIGHT = Number(process.env.VIDEO_HEIGHT) || 1080;
const SLIDE_PADDING_SEC = process.env.VIDEO_PADDING !== undefined && process.env.VIDEO_PADDING !== '' ? Number(process.env.VIDEO_PADDING) : 0.3;

// Escala tipográfica proporcional à largura (referência 16:9 = 1920px de largura).
// Assim o layout adapta a proporção escolhida (9:16, 4:5, etc.) sem quebrar.
const s = (v) => (v * (WIDTH / 1920)).toFixed(1);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function medirDuracaoMp3(path) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return parseFloat(stdout.trim());
}

async function concatAudios(audios, outPath) {
  // Cada MP3 vira entrada separada e é concatenado com gaps de silêncio
  // (aresample + anullsrc) para alinhar com os frames (SLIDE_PADDING_SEC entre cada).
  // Observação: TTS=qwen produz WAV 24kHz mono (convertido a MP3); TTS=edge-tts produz MP3 24kHz mono.
  // Normalizamos tudo para 44.1kHz stereo antes do concat.
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

// ---------------------------------------------------------------------------
// Geração dos frames HTML (slides)
// ---------------------------------------------------------------------------

function gerarFrameHtml(slide, imagePath, numero, total, tituloAula) {
  const imgName = basename(imagePath);
  const pontos = (slide.pontos || []).map((p) => `<li>${esc(p)}</li>`).join('');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${esc(slide.titulo)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; }
  .bg { position: absolute; inset: 0; }
  .bg img { width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,27,42,0.10) 0%, rgba(13,27,42,0.35) 55%, rgba(13,27,42,0.82) 100%); }
  .content { position: absolute; inset: 0; padding: ${s(70)}px ${s(90)}px; display: flex; flex-direction: column; justify-content: flex-end; }
  .card { background: linear-gradient(160deg, rgba(13,27,42,0.78) 0%, rgba(13,27,42,0.62) 100%); border: 1px solid rgba(224,180,90,0.35); border-radius: ${s(22)}px; padding: ${s(40)}px ${s(52)}px; max-width: ${s(1560)}px; box-shadow: 0 8px 40px rgba(0,0,0,0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  .kicker { font-size: ${s(26)}px; letter-spacing: ${s(5)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: ${s(14)}px; opacity: 0; animation: fadeUp 0.6s ease-out 0.2s forwards; }
  h1 { font-size: ${s(74)}px; color: #ffffff; font-weight: 700; line-height: 1.08; max-width: ${s(1420)}px; margin-bottom: ${s(26)}px; text-shadow: 0 3px 18px rgba(0,0,0,0.55); opacity: 0; animation: fadeUp 0.7s ease-out 0.5s forwards; }
  ul { list-style: none; display: flex; flex-direction: column; gap: ${s(14)}px; }
  li { font-size: ${s(34)}px; color: #eef3f9; padding-left: ${s(34)}px; position: relative; max-width: ${s(1420)}px; line-height: 1.25; opacity: 0; animation: fadeUp 0.6s ease-out forwards; }
  li::before { content: '▸'; position: absolute; left: 0; color: #e0b45a; }
  li:nth-child(1) { animation-delay: 0.9s; }
  li:nth-child(2) { animation-delay: 1.2s; }
  li:nth-child(3) { animation-delay: 1.5s; }
  li:nth-child(4) { animation-delay: 1.8s; }
  .foot { position: absolute; top: 0; left: 0; right: 0; padding: ${s(40)}px ${s(90)}px; display: flex; justify-content: space-between; align-items: center; color: rgba(255,255,255,0.75); font-size: ${s(22)}px; letter-spacing: ${s(2)}px; }
  .foot .brand { color: #e0b45a; font-weight: 700; text-transform: uppercase; letter-spacing: ${s(4)}px; background: linear-gradient(90deg, rgba(13,27,42,0.85) 0%, rgba(13,27,42,0.55) 60%, rgba(13,27,42,0) 100%); border-left: ${s(4)}px solid #e0b45a; padding: ${s(12)}px ${s(22)}px; border-radius: ${s(8)}px; text-shadow: 0 2px 8px rgba(0,0,0,0.8); }
  .foot .counter { font-weight: 600; background: rgba(13,27,42,0.75); padding: ${s(8)}px ${s(16)}px; border-radius: ${s(8)}px; text-shadow: 0 1px 6px rgba(0,0,0,0.7); }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(${s(26)}px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="bg"><img src="${esc(imgName)}" /></div>
  <div class="veil"></div>
  <div class="foot">
    <span class="brand">${esc(tituloAula)}</span>
    <span class="counter">${numero} / ${total}</span>
  </div>
  <div class="content">
    <div class="card">
      <div class="kicker">Teologia Básica</div>
      <h1>${esc(slide.titulo)}</h1>
      <ul>${pontos}</ul>
    </div>
  </div>
</body>
</html>`;
}

function gerarFrameIntro(roteiro) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Intro</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; }
  .halo { position: absolute; width: ${s(900)}px; height: ${s(900)}px; border-radius: 50%; left: 50%; top: 42%; transform: translate(-50%, -50%); background: radial-gradient(circle, rgba(224,180,90,0.28) 0%, rgba(224,180,90,0.05) 55%, transparent 70%); animation: pulse 4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.7; } 50% { transform: translate(-50%,-50%) scale(1.12); opacity: 1; } }
  .inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 ${s(200)}px; }
  .brand { position: absolute; top: ${s(70)}px; left: 0; right: 0; text-align: center; font-size: ${s(40)}px; letter-spacing: ${s(10)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; opacity: 0; animation: fadeUp 0.7s ease-out 0.2s forwards; }
  .kicker { font-size: ${s(30)}px; letter-spacing: ${s(8)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: ${s(30)}px; opacity: 0; animation: fadeUp 0.7s ease-out 0.3s forwards; }
  h1 { font-size: ${s(96)}px; color: #ffffff; font-weight: 700; line-height: 1.1; margin-bottom: ${s(24)}px; opacity: 0; animation: fadeUp 0.8s ease-out 0.8s forwards; }
  .sub { font-size: ${s(34)}px; color: #c9d4e0; opacity: 0; animation: fadeUp 0.8s ease-out 1.4s forwards; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(${s(30)}px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="halo"></div>
  <div class="brand">Teologia Pra Todos</div>
  <div class="inner">
    <div class="kicker">Teologia Básica</div>
    <h1>${esc(roteiro.titulo_aula)}</h1>
    <div class="sub">Uma introdução didática ao estudo da fé cristã</div>
  </div>
</body>
</html>`;
}

function gerarFrameOutro() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Conclusão</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; display: flex; align-items: center; justify-content: center; }
  .card { text-align: center; padding: 0 ${s(40)}px; }
  .kicker { font-size: ${s(30)}px; letter-spacing: ${s(8)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: ${s(30)}px; opacity: 0; animation: fadeUp 0.7s ease-out 0.3s forwards; }
  h1 { font-size: ${s(88)}px; color: #ffffff; font-weight: 700; margin-bottom: ${s(20)}px; opacity: 0; animation: fadeUp 0.8s ease-out 0.8s forwards; }
  .thanks { font-size: ${s(32)}px; color: #c9d4e0; opacity: 0; animation: fadeUp 0.8s ease-out 1.4s forwards; }
  .brand { font-size: ${s(40)}px; letter-spacing: ${s(10)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-top: ${s(48)}px; opacity: 0; animation: fadeUp 0.8s ease-out 1.8s forwards; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(${s(30)}px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="card">
    <div class="kicker">Conclusão</div>
    <h1>Obrigado por estudar</h1>
    <div class="thanks">Continue sua jornada de fé e conhecimento</div>
    <div class="brand">Teologia Pra Todos</div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Fluxo principal
// ---------------------------------------------------------------------------

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node montar_video.mjs <caminho/roteiro.json>');
    process.exit(1);
  }
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);
  const slug = roteiro.slug || basename(outDir);

  console.error('[4/4] Montando vídeo ...');

  // 1. Medir durações dos áudios de narração (por slide)
  const audios = [];
  const textos = [
    { id: 'intro', texto: roteiro.introducao },
    ...roteiro.slides.map((s) => ({ id: s.id, titulo: s.titulo, texto: s.narracao })),
    { id: 'conclusao', texto: roteiro.conclusao },
  ];
  for (let i = 0; i < textos.length; i++) {
    const prefix = prefixoNarracao(i, textos.length);
    const path = join(outDir, `${prefix}-narracao.mp3`);
    if (!existsSync(path)) throw new Error(`Narração não encontrada: ${path}`);
    const durationSec = await medirDuracaoMp3(path);
    audios.push({ id: textos[i].id, path, durationSec });
    console.error(`  narração ${i + 1}/${textos.length}: ${durationSec.toFixed(1)}s`);
  }

  // 2. Concatenar narração em um único MP3 (com gaps para os frames)
  const narracaoFull = join(outDir, 'narracao-full.mp3');
  await concatAudios(audios, narracaoFull);

  // 3. Preparar projeto html-video
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
    name: `Aula: ${roteiro.titulo_aula}`,
    preferences: {
      aspect: WIDTH >= HEIGHT ? '16:9' : '9:16',
      resolution: { width: WIDTH, height: HEIGHT },
      fps: FPS,
      language: 'pt-BR',
    },
  });

  // 4. Content graph: intro + slides + conclusão
  const nodes = [
    { id: 'intro', kind: 'text', label: 'Introdução', durationSec: audios[0].durationSec + SLIDE_PADDING_SEC },
  ];
  const edges = [];
  for (let i = 0; i < roteiro.slides.length; i++) {
    nodes.push({ id: roteiro.slides[i].id, kind: 'text', label: roteiro.slides[i].titulo, durationSec: audios[i + 1].durationSec + SLIDE_PADDING_SEC });
    edges.push({ from: i === 0 ? 'intro' : roteiro.slides[i - 1].id, to: roteiro.slides[i].id, kind: 'sequence' });
  }
  const conclIdx = roteiro.slides.length + 1;
  nodes.push({ id: 'conclusao', kind: 'text', label: 'Conclusão', durationSec: audios[conclIdx].durationSec + SLIDE_PADDING_SEC });
  edges.push({ from: roteiro.slides[roteiro.slides.length - 1].id, to: 'conclusao', kind: 'sequence' });

  const graph = { schemaVersion: 1, intent: 'explainer', synopsis: roteiro.titulo_aula, nodes, edges };
  await orchestrator.writeContentGraph(project.id, graph);

  // 5. Escrever frames HTML
  const total = roteiro.slides.length + 2;
  await orchestrator.writeFrameHtml(project.id, 'intro', gerarFrameIntro(roteiro));
  for (let i = 0; i < roteiro.slides.length; i++) {
    const slide = roteiro.slides[i];
    const imgPath = join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
    if (!existsSync(imgPath)) throw new Error(`Imagem do slide não encontrada: ${imgPath}`);
    // Copiar imagem para o diretório do frame para referência relativa funcionar
    // (writeFrameHtml grava em <projectDir>/frames/, mesma pasta do HTML)
    const projectDir = await projects.ensureDir(project.id);
    const imgDest = join(projectDir, 'frames', `slide-${String(i + 1).padStart(2, '0')}.png`);
    await copyFile(imgPath, imgDest);
    await orchestrator.writeFrameHtml(
      project.id,
      slide.id,
      gerarFrameHtml(slide, imgDest, i + 1, roteiro.slides.length, roteiro.titulo_aula),
    );
  }
  await orchestrator.writeFrameHtml(project.id, 'conclusao', gerarFrameOutro());

  // 6. Narração como soundtrack do projeto
  const proj = await orchestrator.addFileAsset(project.id, narracaoFull, 'Narração completa');
  const asset = proj.assets[proj.assets.length - 1];
  proj.soundtrack = { narrationAssetId: asset.id, narrationVolumeDb: 0 };
  await projects.save(proj);

  // 7. Renderizar
  console.error('  renderizando frames (Chromium + ffmpeg) ...');
  const outputPath = join(outDir, `${slug}-${WIDTH}x${HEIGHT}.mp4`);
  await orchestrator.exportMp4({
    projectId: project.id,
    outputPath,
    onProgress: (pct, stage) => console.error(`  ${pct.toFixed(0)}% ${stage}`),
  });

  console.error(`Vídeo concluído: ${outputPath}`);
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
