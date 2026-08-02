import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMFY_URL = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_OUTPUT_DIR = process.env.COMFY_OUTPUT_DIR || 'D:\\ComfyUI_windows_portable\\ComfyUI\\output';

const LORA_NAME = process.env.KREA2_LORA || 'Krea2\\k2-illustria3_000000400.safetensors';
const SEED_BASE = process.env.KREA2_SEED_BASE !== undefined && process.env.KREA2_SEED_BASE !== '' ? Number(process.env.KREA2_SEED_BASE) : 1000;

// Replica o workflow "Krea2 - Simples.json" do usuário:
// VAE qwen_image_vae + LoRA + ApplyKrea2NegPiP + ConditioningZeroOut (negativo zerado).
const WORKFLOW_TEMPLATE = {
  "2": { class_type: "UNETLoader", inputs: { unet_name: "Krea2\\krea2_turbo_fp8_scaled.safetensors", weight_dtype: "default" } },
  "3": { class_type: "CLIPLoader", inputs: { clip_name: "qwen\\qwen3vl_4b_fp8_scaled.safetensors", type: "krea2" } },
  "17": { class_type: "VAELoader", inputs: { vae_name: "qwen_image_vae.safetensors" } },
  "18": { class_type: "LoraLoader", inputs: { model: ["2", 0], clip: ["3", 0], lora_name: "__LORA__", strength_model: 1.0, strength_clip: 1.0 } },
  "4": { class_type: "ApplyKrea2NegPiP", inputs: { model: ["18", 0], clip: ["18", 1], value_strength: 1.0, patch_txtfusion_refiners: false, block_start: 0, block_end: 27, block_stride: 1 } },
  "5": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "__POSITIVE__" } },
  "7": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
  "8": { class_type: "EmptyLatentImage", inputs: { width: 1152, height: 640, batch_size: 1 } },
  "6": { class_type: "KSampler", inputs: { model: ["4", 0], positive: ["5", 0], negative: ["7", 0], latent_image: ["8", 0], seed: "__SEED__", steps: 8, cfg: 1.0, sampler_name: "euler", scheduler: "simple", denoise: 1.0 } },
  "9": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["17", 0] } },
  "10": { class_type: "SaveImage", inputs: { images: ["9", 0], filename_prefix: "teologia_slide" } },
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

async function aguardarExecucao(promptId, timeoutMs = 300000) {
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
  workflow['5'].inputs.text = prompt;
  workflow['18'].inputs.lora_name = LORA_NAME;
  workflow['6'].inputs.seed = seed;
  const promptId = await submeterPrompt(workflow);
  const files = await aguardarExecucao(promptId);
  const file = files[0];
  if (!file) throw new Error('ComfyUI não retornou arquivos');
  return join(COMFY_OUTPUT_DIR, file);
}

export async function gerarImagensSlides(slides, outDir) {
  const imagens = [];
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const dest = join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
    if (existsSync(dest)) {
      console.error(`  [imagem ${i + 1}/${slides.length}] ${slide.titulo} (já existe, pulando)`);
      imagens.push({ id: slide.id, path: dest });
      continue;
    }
    const seed = SEED_BASE + i * 137;
    console.error(`  [imagem ${i + 1}/${slides.length}] ${slide.titulo} ...`);
    const src = await gerarImagemSlide(slide.imagem_prompt, seed);
    await copyFile(src, dest);
    imagens.push({ id: slide.id, path: dest });
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
  console.error(`[2/4] Gerando ${roteiro.slides.length} imagens ...`);
  const imagens = await gerarImagensSlides(roteiro.slides, outDir);
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
