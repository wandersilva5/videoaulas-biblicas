import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMFY_URL = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_OUTPUT_DIR = process.env.COMFY_OUTPUT_DIR || 'D:\\ComfyUI_windows_portable\\ComfyUI\\output';

const ZIMAGE_UNET = process.env.ZIMAGE_UNET || 'z-image\\z_image_turbo-Q4_K_M.gguf';
const ZIMAGE_CLIP = process.env.ZIMAGE_CLIP || 'qwen\\qwen3_4b_fp8_scaled.safetensors';
const ZIMAGE_VAE = process.env.ZIMAGE_VAE || 'FLUX-Anime-VAE-B2.safetensors';
const LORA_NAME = process.env.ZIMAGE_LORA || 'z-image\\z-image-anime-01.safetensors';
const SEED_BASE = process.env.KREA2_SEED_BASE !== undefined && process.env.KREA2_SEED_BASE !== '' ? Number(process.env.KREA2_SEED_BASE) : 1000;

// Replica o workflow "Z-Image Turbo.json" do usuário:
// UnetLoaderGGUFAdvanced (z_image_turbo-Q4_K_M) + CLIPLoader lumina2 (Qwen3-4B)
// + LoRA z-image-anime + ModelSamplingAuraFlow + VAE FLUX-Anime + 9 passos.
// Obs.: usa UnetLoaderGGUFAdvanced/CLIPLoader (safetensors) porque o custom node
// ComfyUI-GGUF-FantasyTalking sobrescreve UnetLoaderGGUF/CLIPLoaderGGUF com
// retornos quebrados (WANVIDEOMODEL e lista de arquiteturas antiga).
const NEGATIVE_PROMPT = 'low resolution, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, artist name, cropped, out of frame, long neck, deformed, watermark, text, logo, lowres, jpeg artifacts, blurry';

const WORKFLOW_TEMPLATE = {
  "1": { class_type: "UnetLoaderGGUFAdvanced", inputs: { unet_name: "__UNET__", dequant_dtype: "default", patch_dtype: "default", patch_on_device: false } },
  "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "__LORA__", strength_model: 0.8 } },
  "3": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["2", 0], shift: 7 } },
  "4": { class_type: "CLIPLoader", inputs: { clip_name: "__CLIP__", type: "lumina2" } },
  "5": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 0], text: "__POSITIVE__" } },
  "6": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 0], text: NEGATIVE_PROMPT } },
  "7": { class_type: "EmptySD3LatentImage", inputs: { width: 1152, height: 640, batch_size: 1 } },
  "8": { class_type: "KSampler", inputs: { model: ["3", 0], positive: ["5", 0], negative: ["6", 0], latent_image: ["7", 0], seed: "__SEED__", steps: 9, cfg: 1.0, sampler_name: "euler", scheduler: "normal", denoise: 1.0 } },
  "9": { class_type: "VAELoader", inputs: { vae_name: "__VAE__" } },
  "10": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["9", 0] } },
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
  workflow['1'].inputs.unet_name = ZIMAGE_UNET;
  workflow['2'].inputs.lora_name = LORA_NAME;
  workflow['4'].inputs.clip_name = ZIMAGE_CLIP;
  workflow['9'].inputs.vae_name = ZIMAGE_VAE;
  workflow['5'].inputs.text = `${prompt}, any text must be written in Brazilian Portuguese`;
  workflow['8'].inputs.seed = seed;
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
    const inicioImg = Date.now();
    const hb = setInterval(() => {
      console.error(`  [imagem ${i + 1}/${slides.length}] ${slide.titulo} ... aguardando ComfyUI (${Math.round((Date.now() - inicioImg) / 1000)}s)`);
    }, 15000);
    let src;
    try {
      src = await gerarImagemSlide(slide.imagem_prompt, seed);
    } finally {
      clearInterval(hb);
    }
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
