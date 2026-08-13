import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

async function rodarNode(script, args) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [join(SCRIPTS_DIR, script), ...args], {
    maxBuffer: 1024 * 1024 * 32,
  });
  return stdout.trim();
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node pipeline_questionario.mjs <caminho/roteiro.json>');
    process.exit(1);
  }

  console.log(`[1/3] Gerando questionário...`);
  await rodarNode('gerar_questionario.mjs', [roteiroPath]);

  console.log(`[2/3] Gerando narrações do questionário...`);
  await rodarNode('gerar_narracao_questionario.mjs', [roteiroPath]);

  console.log(`[3/3] Montando vídeo do questionário...`);
  const result = await rodarNode('montar_video_questionario.mjs', [roteiroPath]);

  const parsed = JSON.parse(result);
  console.log(`\n=== QUESTIONÁRIO CONCLUÍDO ===`);
  console.log(`Vídeo: ${parsed.output_path}`);
  console.log(JSON.stringify(parsed));
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
