/**
 * gerar_imagens_testemunho.mjs — Gera as imagens minimalistas das cenas do testemunho
 * utilizando o workflow ComfyUI do projeto.
 *
 * Cada cena é ilustrada por VÁRIAS imagens (os prompts de `cena.imagens`),
 * salvas como `cena-XX-img-NN.png` — elas se revezam no vídeo durante a
 * narração da cena. Projetos antigos (uma imagem por cena) continuam
 * funcionando: `imagensDaCenaTestemunho` cai no nome legado `cena-XX.png`.
 *
 * Suporta:
 *   - Formato 16:9 (1152x640) ou 9:16 (640x1152) conforme definido no roteiro.
 *   - Regeneração de uma cena inteira (--apenas cena-01) ou de uma imagem só
 *     (--apenas cena-01-img-02).
 *   - Pula imagens existentes a menos que --recriarTodos seja passado.
 *
 * Uso:
 *   node gerar_imagens_testemunho.mjs output/testemunhos/<slug>/roteiro.json [--apenas <cenaId|cenaId-img-NN>] [--recriarTodos]
 */

import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { limparTextoDePromptImagem, imagensDaCenaTestemunho } from './util.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS_DIR, '..');

let doArquivo = {};
try {
  doArquivo = JSON.parse(readFileSync(join(ROOT, '.config.json'), 'utf8'));
} catch { /* sem .config.json */ }
for (const [k, v] of Object.entries(doArquivo)) if (!(k in process.env)) process.env[k] = v;

const COMFY_URL = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_OUTPUT_DIR = process.env.COMFY_OUTPUT_DIR || 'D:\\ComfyUI_windows_portable\\ComfyUI\\output';

const ANIMA_UNET = process.env.ANIMA_UNET || 'Krea2\\krea2_turbo_fp8_scaled.safetensors';
const ANIMA_CLIP = process.env.ANIMA_CLIP || 'qwen\\qwen3vl_4b_fp8_scaled.safetensors';
const ANIMA_VAE = process.env.ANIMA_VAE || 'qwen_image_vae.safetensors';
const ANIMA_LORA = process.env.ANIMA_LORA || 'Krea2\\MinimalisticVectorArtKrea2.safetensors';
const ANIMA_STEPS = Number(process.env.ANIMA_STEPS || 6);
const SEED_BASE = process.env.KREA2_SEED_BASE !== undefined && process.env.KREA2_SEED_BASE !== '' ? Number(process.env.KREA2_SEED_BASE) : 2000;
const COMFY_TIMEOUT_MS = Number(process.env.COMFY_TIMEOUT_MS || 900000);

const WORKFLOW_TEMPLATE = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "__UNET__", weight_dtype: "default" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "__CLIP__", type: "krea2" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "__VAE__" } },
  "4": { class_type: "LoraLoader", inputs: { model: ["1", 0], clip: ["2", 0], lora_name: "__LORA__", strength_model: 1.0, strength_clip: 1.0 } },
  "5": { class_type: "CLIPTextEncode", inputs: { clip: ["8", 1], text: "__POSITIVE__" } },
  "6": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
  "7": { class_type: "EmptyLatentImage", inputs: { width: 1152, height: 640, batch_size: 1 } },
  "8": { class_type: "ApplyKrea2NegPiP", inputs: { model: ["4", 0], clip: ["4", 1], value_strength: 1, patch_txtfusion_refiners: false, block_start: 0, block_end: 27, block_stride: 1 } },
  "9": { class_type: "KSampler", inputs: { model: ["8", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0], seed: "__SEED__", steps: "__STEPS__", cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } },
  "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["3", 0] } },
  "11": { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: "testemunho_cena" } },
};

async function submeterPrompt(workflow) {
  const resp = await fetch(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`ComfyUI erro ${resp.status}: ${err.slice(0, 500)}`);
  }
  return (await resp.json()).prompt_id;
}

async function aguardarExecucao(promptId, timeoutMs = COMFY_TIMEOUT_MS) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const resp = await fetch(`${COMFY_URL}/history/${promptId}`);
    const hist = await resp.json();
    const entry = hist[promptId];
    if (!entry) continue;
    const status = entry.status?.status_str;
    if (status === 'error') {
      const msgs = entry.status?.messages || [];
      const err = msgs.find((m) => m[0] === 'execution_error');
      throw new Error('ComfyUI execução falhou: ' + JSON.stringify(err?.[1]?.exception_message || msgs).slice(0, 500));
    }
    if (status === 'success') {
      const outputs = entry.outputs || {};
      const files = [];
      for (const node of Object.values(outputs)) {
        for (const out of node.images || []) files.push(out.filename);
        for (const out of node.gifs || []) files.push(out.filename);
      }
      return files;
    }
  }
  throw new Error('Timeout aguardando ComfyUI');
}

export async function gerarImagemCena(prompt, { seed = 42, vertical = false } = {}) {
  const workflow = structuredClone(WORKFLOW_TEMPLATE);
  workflow['1'].inputs.unet_name = ANIMA_UNET;
  workflow['2'].inputs.clip_name = ANIMA_CLIP;
  workflow['3'].inputs.vae_name = ANIMA_VAE;
  workflow['4'].inputs.lora_name = ANIMA_LORA;
  workflow['5'].inputs.text = limparTextoDePromptImagem(prompt);
  workflow['7'].inputs.width = vertical ? 640 : 1152;
  workflow['7'].inputs.height = vertical ? 1152 : 640;
  workflow['9'].inputs.seed = seed;
  workflow['9'].inputs.steps = ANIMA_STEPS;

  console.error(`  [prompt] ${workflow['5'].inputs.text.slice(0, 120)}...`);
  const promptId = await submeterPrompt(workflow);
  const files = await aguardarExecucao(promptId);
  const file = files[0];
  if (!file) throw new Error('ComfyUI não retornou arquivos');
  return join(COMFY_OUTPUT_DIR, file);
}

export async function gerarImagensTestemunho(roteiro, outDir, { apenas = null, recriarTodos = false } = {}) {
  await mkdir(outDir, { recursive: true });
  const vertical = roteiro.formato === '9:16';
  const cenas = roteiro.cenas || [];

  // Uma entrada por imagem: a cena é ilustrada por vários quadros que se
  // revezam no vídeo, então o total da etapa conta imagens, não cenas.
  const fila = [];
  for (const cena of cenas) {
    for (const img of imagensDaCenaTestemunho(cena, outDir)) {
      fila.push({
        cenaId: cena.id,
        titulo: cena.titulo_cena || cena.id,
        idx: img.idx,
        arquivo: img.arquivo,
        destino: img.caminho,
        existe: img.existe,
        prompt: img.prompt,
      });
    }
  }
  // --apenas aceita a cena inteira (cena-01) ou uma imagem só (cena-01-img-02).
  const alvo = apenas ? String(apenas).toLowerCase() : null;
  const selecionados = alvo
    ? fila.filter((f) => f.cenaId === alvo || f.arquivo.replace(/\.png$/i, '') === alvo)
    : fila;
  if (alvo && selecionados.length === 0) {
    throw new Error(`Nenhuma imagem encontrada para "${apenas}". Use o id da cena (ex.: cena-01) ou o arquivo (ex.: cena-01-img-02).`);
  }

  const total = selecionados.length;
  const resultados = [];

  for (let i = 0; i < total; i++) {
    const item = selecionados[i];

    if (item.existe && !recriarTodos && !alvo) {
      console.error(`  [imagem ${i + 1}/${total}] ${item.titulo} · imagem ${item.idx} (já existe, pulando)`);
      resultados.push({ id: item.cenaId, imagem: item.arquivo, path: item.destino });
      continue;
    }

    console.error(`  [imagem ${i + 1}/${total}] ${item.titulo} · imagem ${item.idx} ... ::${item.arquivo}`);
    const inicioImg = Date.now();
    const hb = setInterval(() => {
      console.error(`  [imagem ${i + 1}/${total}] ${item.titulo} · imagem ${item.idx} ... aguardando ComfyUI (${Math.round((Date.now() - inicioImg) / 1000)}s)`);
    }, 15000);

    try {
      const seed = SEED_BASE + (i * 179) + (item.idx * 37) + Math.floor(Math.random() * 50);
      const tempPath = await gerarImagemCena(item.prompt, { seed, vertical });
      clearInterval(hb);
      await copyFile(tempPath, item.destino);
      console.error(`  [imagem ${i + 1}/${total}] ${item.titulo} · imagem ${item.idx} concluída!`);
      console.error(`  OK: ${item.destino}`);
      resultados.push({ id: item.cenaId, imagem: item.arquivo, path: item.destino });
    } catch (e) {
      clearInterval(hb);
      throw e;
    }
  }

  return resultados;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Uso: node gerar_imagens_testemunho.mjs output/testemunhos/<slug>/roteiro.json [--apenas <cenaId|cenaId-img-NN>] [--recriarTodos]');
    process.exit(1);
  }

  const roteiroPath = args[0];
  const outDir = dirname(roteiroPath);
  const apenasIdx = args.indexOf('--apenas');
  const apenas = apenasIdx !== -1 && args[apenasIdx + 1] ? args[apenasIdx + 1] : null;
  const recriarTodos = args.includes('--recriarTodos');

  const roteiro = JSON.parse(await readFileSync(roteiroPath, 'utf8'));
  const resultados = await gerarImagensTestemunho(roteiro, outDir, { apenas, recriarTodos });
  console.log(JSON.stringify(resultados, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[erro] ${err.message}`);
    process.exit(1);
  });
}
