import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { limparProjetosAntigosHtmlVideo } from './util.mjs';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const MONTA_VIDEO = join(SCRIPTS_DIR, 'montar_video.mjs');
const GERAR_ROTEIRO_SHORT = join(SCRIPTS_DIR, 'gerar_roteiro_short.mjs');
const GERAR_SHORT = join(SCRIPTS_DIR, 'gerar_short.mjs');

async function rodarNode(script, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [join(SCRIPTS_DIR, script), ...args], {
    maxBuffer: 1024 * 1024 * 32,
  });
  return stdout.trim();
}

async function rodarNodeAbs(script, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
    maxBuffer: 1024 * 1024 * 32,
    cwd: SCRIPTS_DIR,
  });
  return stdout.trim();
}

// Retry com backoff linear (4s, 8s, ...) para etapas idempotentes (imagens,
// narração e vídeo). As etapas pulam artefatos já existentes, então reexecutar
// após uma falha transitória é seguro. PIPELINE_RETRIES controla o número de
// tentativas (default 3); PIPELINE_RETRY_BASE_MS o intervalo base (default 4000).
const RETRIES = Math.max(1, Number(process.env.PIPELINE_RETRIES) || 3);
const RETRY_BASE_MS = Math.max(0, Number(process.env.PIPELINE_RETRY_BASE_MS) || 4000);

async function rodarComRetry(fn, descricao) {
  for (let tentativa = 1; tentativa <= RETRIES; tentativa++) {
    try {
      return await fn();
    } catch (e) {
      if (tentativa === RETRIES) throw e;
      const esperaMs = RETRY_BASE_MS * tentativa;
      const msg = String(e.message ?? '').split('\n')[0].slice(0, 200);
      console.error(`  [retry] ${descricao} falhou (${msg}); nova tentativa em ${esperaMs / 1000}s (${tentativa}/${RETRIES - 1})`);
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
}

async function main() {
  const topico = process.argv[2];
  if (!topico) {
    console.error('Uso: node pipeline.mjs "Tópico da aula de teologia"');
    console.error('');
console.error('Variáveis opcionais:');
  console.error('  LLAMA_URL  - URL do llama-server (default http://127.0.0.1:8091)');
  console.error('  TTS        - qwen (padrão, clone de voz) | edge-tts (fallback)');
  console.error('  VOZ        - voz do edge-tts quando TTS=edge-tts (default pt-BR-AntonioNeural)');
  console.error('  PULAR_ROTEIRO=1  - pula a geração do roteiro (usa roteiro.json existente)');
  console.error('  PULAR_ROTEIRO_SHORT=1  - pula a geração do roteiro do Short (usa roteiro-short.json existente)');
  console.error('  PIPELINE_RETRIES  - tentativas por etapa (default 3)');
  console.error('  PIPELINE_RETRY_BASE_MS  - backoff base em ms (default 4000)');
    process.exit(1);
  }

  const slug = topico
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const outDir = join(SCRIPTS_DIR, '..', 'output', slug);
  const roteiroPath = join(outDir, 'roteiro.json');
  const roteiroShortPath = join(outDir, 'roteiro-short.json');

  // Etapa 1: Roteiro
  if (process.env.PULAR_ROTEIRO === '1' && existsSync(roteiroPath)) {
    console.log('[1/6] Roteiro já existe, pulando.');
  } else {
    console.log(`[1/6] Gerando roteiro para: ${topico}`);
    await rodarNode('gerar_roteiro.mjs', [topico]);
  }

  // Etapa 2: Imagens (ComfyUI)
  const imagensOk = await rodarComRetry(() => rodarNode('gerar_imagens.mjs', [roteiroPath]), 'Etapa 2 (imagens)');
  console.log(`[2/6] ${JSON.parse(imagensOk).length} imagens geradas.`);

  // Etapa 3: Narração (qwen)
  const narracaoOk = await rodarComRetry(() => rodarNode('gerar_narracao.mjs', [roteiroPath]), 'Etapa 3 (narração)');
  console.log(`[3/6] ${JSON.parse(narracaoOk).length} arquivos de narração gerados.`);

  // Etapa 4: Vídeo (html-video)
  console.log('[4/6] Montando vídeo ...');
  const result = await rodarComRetry(() => rodarNodeAbs(MONTA_VIDEO, [roteiroPath]), 'Etapa 4 (vídeo)');
  const parsed = JSON.parse(result);
  console.log(`\n=== VÍDEO CONCLUÍDO ===`);
  console.log(`Aula: ${topico}`);
  console.log(`Vídeo: ${parsed.output_path}`);

  // Etapa 5: Roteiro do Short (via LLM - promocional com hook/valor/CTA)
  if (process.env.PULAR_ROTEIRO_SHORT === '1' && existsSync(roteiroShortPath)) {
    console.log('[5/6] Roteiro do Short já existe, pulando.');
  } else {
    console.log('[5/6] Gerando roteiro promocional do Short via LLM ...');
    const materialPath = join(outDir, 'material.txt');
    const args = [roteiroPath];
    if (existsSync(materialPath)) args.push('--material', materialPath);
    await rodarComRetry(() => rodarNode('gerar_roteiro_short.mjs', args), 'Etapa 5 (roteiro short)');
  }

  // Etapa 6: YouTube Short (vertical 9:16) - usa roteiro-short.json
  console.log('[6/6] Gerando YouTube Short ...');
  const shortResult = await rodarComRetry(() => rodarNodeAbs(GERAR_SHORT, [roteiroShortPath]), 'Etapa 6 (Short)');
  const shortParsed = JSON.parse(shortResult);
  console.log(`\n=== SHORT CONCLUÍDO ===`);
  console.log(`Short: ${shortParsed.output_path}`);

  try {
    const removidos = await limparProjetosAntigosHtmlVideo(join(SCRIPTS_DIR, '..'));
    if (removidos > 0) console.log(`Cache: ${removidos} projeto(s) antigo(s) removido(s) de .html-video/projects.`);
  } catch (e) {
    console.error(`[cache] limpeza de projetos antigos falhou: ${e.message}`);
  }
}

main().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
