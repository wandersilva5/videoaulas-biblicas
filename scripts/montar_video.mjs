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
const SLIDE_PADDING_SEC = process.env.VIDEO_PADDING !== undefined && process.env.VIDEO_PADDING !== '' ? Number(process.env.VIDEO_PADDING) : 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function medirDuracaoMp3(path) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return parseFloat(stdout.trim());
}

async function concatAudios(audios, outPath) {
  // Cada MP3 vira entrada separada e é concatenado com gaps de silêncio
  // (adelay + anullsrc) para alinhar com os frames (SLIDE_PADDING_SEC entre cada).
  const { spawn } = await import('node:child_process');
  const args = ['-y'];
  const n = audios.length;
  const filters = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    args.push('-i', audios[i].path);
    filters.push(`[${i}:a]adelay=${Math.round(acc * 1000)}:all=1[a${i}]`);
    acc += audios[i].durationSec;
    // Adicionar silêncio de padding após cada áudio (exceto o último)
    if (i < n - 1) {
      const padMs = Math.round(SLIDE_PADDING_SEC * 1000);
      filters.push(`anullsrc=r=44100:cl=stereo:d=${SLIDE_PADDING_SEC}[pad${i}]`);
      filters.push(`[a${i}][pad${i}]concat=n=2:v=0:a=1[a${i}_padded]`);
      acc += SLIDE_PADDING_SEC;
    } else {
      filters.push(`[a${i}]anull[a${i}_padded]`); // passa direto no último
    }
  }
  // Concatenar todos os segmentos (com padding) em um só
  const concatInputs = audios.map((_, i) => `[a${i}_padded]`).join('');
  filters.push(`${concatInputs}concat=n=${n}:v=0:a=1[out]`);
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

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gerarFrameHtml(slide, imagePath, numero, total, tituloAula) {
  const imgName = basename(imagePath);
  const pontos = (slide.pontos || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(slide.titulo)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1920px; height: 1080px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; }
  .bg { position: absolute; inset: 0; }
  .bg img { width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,27,42,0.10) 0%, rgba(13,27,42,0.35) 55%, rgba(13,27,42,0.82) 100%); }
  .content { position: absolute; inset: 0; padding: 70px 90px; display: flex; flex-direction: column; justify-content: flex-end; }
  .card { background: linear-gradient(160deg, rgba(13,27,42,0.78) 0%, rgba(13,27,42,0.62) 100%); border: 1px solid rgba(224,180,90,0.35); border-radius: 22px; padding: 40px 52px; max-width: 1560px; box-shadow: 0 8px 40px rgba(0,0,0,0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  .kicker { font-size: 26px; letter-spacing: 5px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: 14px; opacity: 0; animation: fadeUp 0.6s ease-out 0.2s forwards; }
  h1 { font-size: 74px; color: #ffffff; font-weight: 700; line-height: 1.08; max-width: 1420px; margin-bottom: 26px; text-shadow: 0 3px 18px rgba(0,0,0,0.55); opacity: 0; animation: fadeUp 0.7s ease-out 0.5s forwards; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 14px; }
  li { font-size: 34px; color: #eef3f9; padding-left: 34px; position: relative; max-width: 1420px; line-height: 1.25; opacity: 0; animation: fadeUp 0.6s ease-out forwards; }
  li::before { content: '▸'; position: absolute; left: 0; color: #e0b45a; }
  li:nth-child(1) { animation-delay: 0.9s; }
  li:nth-child(2) { animation-delay: 1.2s; }
  li:nth-child(3) { animation-delay: 1.5s; }
  li:nth-child(4) { animation-delay: 1.8s; }
  .foot { position: absolute; top: 0; left: 0; right: 0; padding: 40px 90px; display: flex; justify-content: space-between; align-items: center; color: rgba(255,255,255,0.75); font-size: 22px; letter-spacing: 2px; }
  .foot .brand { color: #e0b45a; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; }
  .foot .counter { font-weight: 600; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="bg"><img src="${escapeHtml(imgName)}" /></div>
  <div class="veil"></div>
  <div class="foot">
    <span class="brand">${escapeHtml(tituloAula)}</span>
    <span class="counter">${numero} / ${total}</span>
  </div>
  <div class="content">
    <div class="card">
      <div class="kicker">Teologia Básica</div>
      <h1>${escapeHtml(slide.titulo)}</h1>
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
  body { width: 1920px; height: 1080px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; }
  .halo { position: absolute; width: 900px; height: 900px; border-radius: 50%; left: 50%; top: 42%; transform: translate(-50%, -50%); background: radial-gradient(circle, rgba(224,180,90,0.28) 0%, rgba(224,180,90,0.05) 55%, transparent 70%); animation: pulse 4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.7; } 50% { transform: translate(-50%,-50%) scale(1.12); opacity: 1; } }
  .inner { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 200px; }
  .kicker { font-size: 30px; letter-spacing: 8px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: 30px; opacity: 0; animation: fadeUp 0.7s ease-out 0.3s forwards; }
  h1 { font-size: 96px; color: #ffffff; font-weight: 700; line-height: 1.1; margin-bottom: 24px; opacity: 0; animation: fadeUp 0.8s ease-out 0.8s forwards; }
  .sub { font-size: 34px; color: #c9d4e0; opacity: 0; animation: fadeUp 0.8s ease-out 1.4s forwards; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="halo"></div>
  <div class="inner">
    <div class="kicker">Teologia Básica</div>
    <h1>${escapeHtml(roteiro.titulo_aula)}</h1>
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
  body { width: 1920px; height: 1080px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; display: flex; align-items: center; justify-content: center; }
  .card { text-align: center; }
  .kicker { font-size: 30px; letter-spacing: 8px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: 30px; opacity: 0; animation: fadeUp 0.7s ease-out 0.3s forwards; }
  h1 { font-size: 88px; color: #ffffff; font-weight: 700; margin-bottom: 20px; opacity: 0; animation: fadeUp 0.8s ease-out 0.8s forwards; }
  .thanks { font-size: 32px; color: #c9d4e0; opacity: 0; animation: fadeUp 0.8s ease-out 1.4s forwards; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
  <div class="card">
    <div class="kicker">Conclusão</div>
    <h1>Obrigado por estudar</h1>
    <div class="thanks">Continue sua jornada de fé e conhecimento</div>
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
    const totalSlides = roteiro.slides.length;
    const prefix = i === 0
      ? '00-intro'
      : i === totalSlides + 1
        ? `${String(totalSlides).padStart(2, '0')}-conclusao`
        : String(i).padStart(2, '0');
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
    preferences: { aspect: '16:9', resolution: { width: WIDTH, height: HEIGHT }, fps: FPS, language: 'pt-BR' },
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
    // Registrar imagem no AssetStore e usar URL servida pelo core
    const asset = await orchestrator.addFileAsset(project.id, imgPath, `Slide ${i + 1} background`);
    const assetUrl = `/assets/${asset.id}`;
    await orchestrator.writeFrameHtml(
      project.id,
      slide.id,
      gerarFrameHtml(slide, assetUrl, i + 1, roteiro.slides.length, roteiro.titulo_aula),
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
  const outputPath = join(outDir, `${slug}.mp4`);
  await orchestrator.exportMp4({
    projectId: project.id,
    outputPath,
    onProgress: (pct, stage) => console.error(`  ${pct.toFixed(0)}% ${stage}`),
  });

  console.error(`Vídeo concluído: ${outputPath}`);
  console.log(JSON.stringify({ output_path: outputPath, project_id: project.id }));
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
});
