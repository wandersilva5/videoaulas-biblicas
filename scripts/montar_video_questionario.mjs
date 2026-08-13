import { readFile, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { esc } from './util.mjs';
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
const WIDTH = Number(process.env.VIDEO_WIDTH) || 1920;
const HEIGHT = Number(process.env.VIDEO_HEIGHT) || 1080;

const s = (v) => (v * (WIDTH / 1920)).toFixed(1);

const TIMER_GAP_SEC = 10.0;
const TRANSITION_GAP_SEC = 1.0;

async function medirDuracaoMp3(path) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return parseFloat(stdout.trim());
}

async function concatAudiosComGaps(audios, gaps, outPath) {
  const { spawn } = await import('node:child_process');
  const args = ['-y'];
  const n = audios.length;
  const filters = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    args.push('-i', audios[i].path);
    filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    labels.push(`[a${i}]`);
    
    // Add gap after this audio if specified and > 0
    if (i < n - 1 && gaps[i] > 0) {
      filters.push(`anullsrc=r=44100:cl=stereo:d=${gaps[i]}[pad${i}]`);
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

function gerarFrameQuestao(q, imgName, mostrarResposta, delayContagem = 0) {
  const opcoesHtml = q.opcoes.map((op, idx) => {
    const ehCorreta = mostrarResposta && idx === q.resposta_correta;
    const opacity = mostrarResposta && !ehCorreta ? '0.4' : '1';
    const border = ehCorreta ? '#e0b45a' : 'rgba(255,255,255,0.2)';
    const color = ehCorreta ? '#e0b45a' : '#ffffff';
    const bg = ehCorreta ? 'rgba(224,180,90,0.1)' : 'transparent';
    return `<div class="opcao" style="opacity: ${opacity}; border-color: ${border}; color: ${color}; background: ${bg}">
      ${esc(op)}
    </div>`;
  }).join('');

  const raio = 52;
  const circ = (2 * Math.PI * raio).toFixed(1);
  const qtd = 11; // 10 → 0
  const passo = 100 / qtd;
  let countdownCss = '';
  let countdownHtml = '';
  if (!mostrarResposta) {
    const segs = TIMER_GAP_SEC;
    for (let i = 0; i < qtd; i++) {
      const v = 10 - i;
      const ini = (i * passo).toFixed(2);
      const fim = ((i + 1) * passo).toFixed(2);
      const iniF = (Number(ini) + 0.02).toFixed(2);
      const fimF = Math.min(Number(fim) + 0.02, 100).toFixed(2);
      countdownCss += `@keyframes num${v} { 0%, ${ini}% { opacity: 0; } ${iniF}%, ${fim}% { opacity: 1; } ${fimF}%, 100% { opacity: 0; } }\n`;
      countdownHtml += `<div class="cd-num" style="animation: num${v} ${segs}s linear ${delayContagem}s forwards;">${v}</div>`;
    }
    countdownCss += `@keyframes cdDeplete { to { stroke-dashoffset: ${circ}; } }`;
    countdownHtml = `<div class="countdown">
      <svg viewBox="0 0 120 120">
        <circle class="ring" cx="60" cy="60" r="${raio}" />
      </svg>
      ${countdownHtml}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${esc(q.tema)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: 'Segoe UI', system-ui, sans-serif; position: relative; background: #0d1b2a; }
  .bg { position: absolute; inset: 0; }
  .bg img { width: 100%; height: 100%; object-fit: cover; }
  .veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,27,42,0.60) 0%, rgba(13,27,42,0.85) 55%, rgba(13,27,42,0.95) 100%); }
  .content { position: absolute; inset: 0; padding: ${s(80)}px ${s(100)}px; display: flex; flex-direction: column; justify-content: center; }
  .card { background: rgba(13,27,42,0.5); border: 1px solid rgba(224,180,90,0.35); border-radius: ${s(22)}px; padding: ${s(50)}px; box-shadow: 0 8px 40px rgba(0,0,0,0.45); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); }
  .kicker { font-size: ${s(26)}px; letter-spacing: ${s(5)}px; text-transform: uppercase; color: #e0b45a; font-weight: 700; margin-bottom: ${s(20)}px; }
  h1 { font-size: ${s(56)}px; color: #ffffff; font-weight: 700; line-height: 1.15; margin-bottom: ${s(40)}px; text-shadow: 0 3px 18px rgba(0,0,0,0.55); }
  .opcoes { display: flex; flex-direction: column; gap: ${s(20)}px; }
  .opcao { font-size: ${s(36)}px; padding: ${s(24)}px ${s(30)}px; border: 2px solid; border-radius: ${s(12)}px; transition: all 0.3s ease; }
  
  .foot { position: absolute; top: 0; left: 0; right: 0; padding: ${s(40)}px ${s(90)}px; display: flex; justify-content: space-between; align-items: center; color: rgba(255,255,255,0.75); font-size: ${s(22)}px; letter-spacing: ${s(2)}px; }
  .foot .brand { color: #e0b45a; font-weight: 700; text-transform: uppercase; letter-spacing: ${s(4)}px; }
  
  /* Contagem regressiva no canto superior direito (10 → 0) */
  .countdown { position: absolute; top: ${s(24)}px; right: ${s(24)}px; width: ${s(120)}px; height: ${s(120)}px; z-index: 10; }
  .countdown svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .countdown .ring { fill: none; stroke: #e0b45a; stroke-width: ${s(8)}; stroke-linecap: round; stroke-dasharray: ${circ}; stroke-dashoffset: 0; animation: cdDeplete ${TIMER_GAP_SEC}s linear ${delayContagem}s forwards; }
  .countdown .cd-num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: ${s(44)}px; font-weight: 800; color: #e0b45a; text-shadow: 0 2px 10px rgba(0,0,0,0.5); opacity: 0; }
  ${countdownCss}
  
  /* Animações de entrada */
  ${!mostrarResposta ? `
  .card { animation: fadeUp 0.6s ease-out forwards; }
  .opcao:nth-child(1) { opacity: 0; animation: fadeUp 0.6s ease-out 0.5s forwards; }
  .opcao:nth-child(2) { opacity: 0; animation: fadeUp 0.6s ease-out 0.7s forwards; }
  .opcao:nth-child(3) { opacity: 0; animation: fadeUp 0.6s ease-out 0.9s forwards; }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(${s(26)}px); } to { opacity: 1; transform: translateY(0); } }
  ` : ''}
</style>
</head>
<body>
  <div class="bg"><img src="${esc(imgName)}" /></div>
  <div class="veil"></div>
  <div class="foot">
    <span class="brand">Questionário</span>
  </div>
  <div class="content">
    <div class="card">
      <div class="kicker">Pergunta ${q.numero} &middot; ${esc(q.tema)}</div>
      <h1>${esc(q.pergunta)}</h1>
      <div class="opcoes">
        ${opcoesHtml}
      </div>
    </div>
  </div>
  ${countdownHtml}
</body>
</html>`;
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node montar_video_questionario.mjs <caminho/roteiro.json>');
    process.exit(1);
  }
  
  const outDir = dirname(roteiroPath);
  const slug = basename(outDir);
  const questionarioPath = join(outDir, 'questionario.json');
  
  if (!existsSync(questionarioPath)) {
      console.error(`Questionário não encontrado: ${questionarioPath}`);
      process.exit(1);
  }

  const questionario = JSON.parse(await readFile(questionarioPath, 'utf8'));
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));

  console.error('[3/3] Montando vídeo do questionário ...');

  const audios = [];
  const gaps = [];

  for (let i = 0; i < questionario.perguntas.length; i++) {
    const prefix = `q${String(i + 1).padStart(2, '0')}`;
    const pPath = join(outDir, `${prefix}-pergunta-narracao.mp3`);
    const rPath = join(outDir, `${prefix}-resposta-narracao.mp3`);
    
    if (!existsSync(pPath) || !existsSync(rPath)) {
        throw new Error(`Áudios da pergunta ${i+1} não encontrados.`);
    }

    const durP = await medirDuracaoMp3(pPath);
    const durR = await medirDuracaoMp3(rPath);

    audios.push({ id: `${prefix}-pergunta`, path: pPath, durationSec: durP });
    gaps.push(TIMER_GAP_SEC);

    audios.push({ id: `${prefix}-resposta`, path: rPath, durationSec: durR });
    gaps.push(i < questionario.perguntas.length - 1 ? TRANSITION_GAP_SEC : 0);
  }

  const narracaoFull = join(outDir, 'questionario-narracao-full.mp3');
  await concatAudiosComGaps(audios, gaps, narracaoFull);

  const projectRoot = HTML_VIDEO_ROOT;
  const engines = new EngineRegistry();
  engines.register(hfAdapter);
  const templates = new TemplateRegistry();
  await templates.scan(join(projectRoot, 'templates'));
  const projects = new ProjectStore(projectRoot);
  const assets = new AssetStore({ projectRoot });
  const orchestrator = new ProjectOrchestrator({ projectRoot, engines, templates, projects, assets });

  const project = await orchestrator.create({
    name: `Quiz: ${roteiro.titulo_aula}`,
    preferences: {
      aspect: WIDTH >= HEIGHT ? '16:9' : '9:16',
      resolution: { width: WIDTH, height: HEIGHT },
      fps: FPS,
      language: 'pt-BR',
    },
  });

  const nodes = [];
  const edges = [];
  
  let prevId = null;

  for (let i = 0; i < questionario.perguntas.length; i++) {
    const q = questionario.perguntas[i];
    const prefix = `q${String(i + 1).padStart(2, '0')}`;
    
    const pId = `${prefix}-pergunta`;
    const rId = `${prefix}-resposta`;

    const durP = audios[i * 2].durationSec + TIMER_GAP_SEC;
    const durR = audios[i * 2 + 1].durationSec + gaps[i * 2 + 1];

    nodes.push({ id: pId, kind: 'text', label: `P${i+1}`, durationSec: durP });
    nodes.push({ id: rId, kind: 'text', label: `R${i+1}`, durationSec: durR });

    if (prevId) edges.push({ from: prevId, to: pId, kind: 'sequence' });
    edges.push({ from: pId, to: rId, kind: 'sequence' });
    
    prevId = rId;
  }

  const graph = { schemaVersion: 1, intent: 'explainer', synopsis: `Quiz: ${roteiro.titulo_aula}`, nodes, edges };
  await orchestrator.writeContentGraph(project.id, graph);

  const projectDir = await projects.ensureDir(project.id);
  const framesDir = join(projectDir, 'frames');
  
  // Usar a capa (slide-00) como fundo padrão para o quiz
  const bgOriginal = join(outDir, 'slide-00.png');
  const bgDest = join(framesDir, 'bg-quiz.png');
  if (existsSync(bgOriginal)) {
    await copyFile(bgOriginal, bgDest);
  }

  for (let i = 0; i < questionario.perguntas.length; i++) {
    const q = questionario.perguntas[i];
    const prefix = `q${String(i + 1).padStart(2, '0')}`;
    
    const bgName = existsSync(bgOriginal) ? 'bg-quiz.png' : '';
    const durP = audios[i * 2].durationSec; // narração da pergunta — a contagem começa quando ela termina
    
    await orchestrator.writeFrameHtml(project.id, `${prefix}-pergunta`, gerarFrameQuestao(q, bgName, false, durP));
    await orchestrator.writeFrameHtml(project.id, `${prefix}-resposta`, gerarFrameQuestao(q, bgName, true));
  }

  const proj = await orchestrator.addFileAsset(project.id, narracaoFull, 'Narração Completa Quiz');
  const asset = proj.assets[proj.assets.length - 1];
  proj.soundtrack = { narrationAssetId: asset.id, narrationVolumeDb: 0 };
  await projects.save(proj);

  console.error('  renderizando quiz (Chromium + ffmpeg) ...');
  const outputPath = join(outDir, `${slug}-questionario-${WIDTH}x${HEIGHT}.mp4`);
  await orchestrator.exportMp4({
    projectId: project.id,
    outputPath,
    onProgress: (pct, stage) => console.error(`  ${pct.toFixed(0)}% ${stage}`),
  });

  console.error(`Vídeo do questionário concluído: ${outputPath}`);
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