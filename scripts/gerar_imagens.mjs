import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { imagemPromptIntro, imagemPromptConclusao, limparTextoDePromptImagem } from './util.mjs';

const COMFY_URL = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_OUTPUT_DIR = process.env.COMFY_OUTPUT_DIR || 'D:\\ComfyUI_windows_portable\\ComfyUI\\output';

const ANIMA_UNET = process.env.ANIMA_UNET || 'anima\\anima-base-v1.0.safetensors';
const ANIMA_CLIP = process.env.ANIMA_CLIP || 'qwen\\qwen_3_06b_base.safetensors';
const ANIMA_VAE = process.env.ANIMA_VAE || 'qwen_image_vae.safetensors';
const ANIMA_LORA = process.env.ANIMA_LORA || 'Anima\\anima_style_slay_the_spire_v2-000018.safetensors';
const ANIMA_STEPS = Number(process.env.ANIMA_STEPS || 10);
const SEED_BASE = process.env.KREA2_SEED_BASE !== undefined && process.env.KREA2_SEED_BASE !== '' ? Number(process.env.KREA2_SEED_BASE) : 1000;

// Replica o workflow "Anima-simples.json" do usuário:
// UNETLoader (minijma_1) + CLIPLoader type "qwen_image" (Qwen3-0.6B)
// + LoraLoader (Anima\minimalistflat-000006) + 8 passos er_sde cfg 5
// + ControlOrderFreeMemory.
// Gera imagens mais rápido que o Z-Image Turbo mantendo estilo flat clean.
const NEGATIVE_PROMPT = 'worst quality, low quality, lowres, score_1, score_2, score_3, score_4, blurry, snfw, cropped, long fingers, bad anatomy, missing fingers, random objects, distorted body, deformed hands, extra arms, extra legs, extra fingers, low resolution, bad anatomy, bad proportions, gore';

const WORKFLOW_TEMPLATE = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "__UNET__", weight_dtype: "default" } },
  "2": { class_type: "CLIPLoader", inputs: { clip_name: "__CLIP__", type: "qwen_image" } },
  "3": { class_type: "VAELoader", inputs: { vae_name: "__VAE__" } },
  "4": { class_type: "LoraLoader", inputs: { model: ["1", 0], clip: ["2", 0], lora_name: "__LORA__", strength_model: 1.0, strength_clip: 1.0 } },
  "5": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "__POSITIVE__" } },
  "6": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: NEGATIVE_PROMPT } },
  "7": { class_type: "EmptyLatentImage", inputs: { width: 1152, height: 640, batch_size: 1 } },
  "8": { class_type: "KSampler", inputs: { model: ["4", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0], seed: "__SEED__", steps: "__STEPS__", cfg: 5, sampler_name: "er_sde", scheduler: "simple", denoise: 1.0 } },
  "9": { class_type: "ControlOrderFreeMemory", inputs: { persist_any_1: ["8", 0], free_memory: true } },
  "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["3", 0] } },
  "11": { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: "teologia_slide" } },
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

const COMFY_TIMEOUT_MS = Number(process.env.COMFY_TIMEOUT_MS || 900000);

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

export async function gerarImagemSlide(prompt, seed = 42) {
  const workflow = structuredClone(WORKFLOW_TEMPLATE);
  workflow['1'].inputs.unet_name = ANIMA_UNET;
  workflow['2'].inputs.clip_name = ANIMA_CLIP;
  workflow['3'].inputs.vae_name = ANIMA_VAE;
  workflow['4'].inputs.lora_name = ANIMA_LORA;
  workflow['5'].inputs.text = limparTextoDePromptImagem(prompt);
  workflow['8'].inputs.seed = seed;
  workflow['8'].inputs.steps = ANIMA_STEPS;
  const promptId = await submeterPrompt(workflow);
  const files = await aguardarExecucao(promptId);
  const file = files[0];
  if (!file) throw new Error('ComfyUI não retornou arquivos');
  return join(COMFY_OUTPUT_DIR, file);
}

export async function gerarImagensRoteiro(roteiro, outDir) {
  // Lista unificada de imagens: capa (intro) + slides + capa (conclusão).
  // Seeds preservados dos slides (SEED_BASE + i*137); capas usam seeds próprios.
  const pad = (n) => String(n).padStart(2, '0');
  const itens = [
    { id: 'intro', rotulo: 'Introdução', prompt: imagemPromptIntro(roteiro), arquivo: 'slide-00.png', seed: SEED_BASE - 137 },
    ...roteiro.slides.map((s, i) => ({
      id: s.id,
      rotulo: s.titulo,
      prompt: s.imagem_prompt,
      arquivo: `slide-${pad(i + 1)}.png`,
      seed: SEED_BASE + i * 137,
    })),
    {
      id: 'conclusao',
      rotulo: 'Conclusão',
      prompt: imagemPromptConclusao(roteiro),
      arquivo: `slide-${pad(roteiro.slides.length + 1)}.png`,
      seed: SEED_BASE + (roteiro.slides.length + 1) * 137,
    },
  ];
  const total = itens.length;
  const imagens = [];
  for (let i = 0; i < total; i++) {
    const item = itens[i];
    const dest = join(outDir, item.arquivo);
    if (existsSync(dest)) {
      console.error(`  [imagem ${i + 1}/${total}] ${item.rotulo} (já existe, pulando)`);
      imagens.push({ id: item.id, path: dest });
      continue;
    }
    console.error(`  [imagem ${i + 1}/${total}] ${item.rotulo} ...`);
    const inicioImg = Date.now();
    const hb = setInterval(() => {
      console.error(`  [imagem ${i + 1}/${total}] ${item.rotulo} ... aguardando ComfyUI (${Math.round((Date.now() - inicioImg) / 1000)}s)`);
    }, 15000);
    let src;
    try {
      src = await gerarImagemSlide(item.prompt, item.seed);
    } finally {
      clearInterval(hb);
    }
    await copyFile(src, dest);
    imagens.push({ id: item.id, path: dest });
    console.error(`  OK: ${dest}`);
  }
  return imagens;
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_imagens.mjs <caminho/roteiro.json>');
    process.exit(1);
  }
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);
  console.error(`[2/4] Gerando ${roteiro.slides.length + 2} imagens (capa + slides + encerramento) ...`);
  const imagens = await gerarImagensRoteiro(roteiro, outDir);
  console.log(JSON.stringify(imagens));
}

if (process.argv[1]) {
  const scriptPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  const argPath = process.argv[1].replace(/\\/g, '/');
  if (scriptPath === argPath) {
    main().catch((e) => {
      console.error('ERRO:', e.message);
      process.exit(1);
    });
  }
}
