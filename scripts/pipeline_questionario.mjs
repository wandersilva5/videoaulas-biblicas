import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

function rodarNodeStream(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(SCRIPTS_DIR, script), ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const txt = chunk.toString();
      stdout += txt;
      process.stdout.write(txt);
    });

    child.stderr.on('data', (chunk) => {
      const txt = chunk.toString();
      stderr += txt;
      process.stderr.write(txt);
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const err = new Error(`Script ${script} encerrou com código ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node pipeline_questionario.mjs <caminho/roteiro.json>');
    process.exit(1);
  }

  console.error(`[1/3] Gerando questionário...`);
  await rodarNodeStream('gerar_questionario.mjs', [roteiroPath]);

  console.error(`[2/3] Gerando narrações do questionário...`);
  await rodarNodeStream('gerar_narracao_questionario.mjs', [roteiroPath]);

  console.error(`[3/3] Montando vídeo do questionário...`);
  const result = await rodarNodeStream('montar_video_questionario.mjs', [roteiroPath]);

  try {
    const parsed = JSON.parse(result);
    console.error(`\n=== QUESTIONÁRIO CONCLUÍDO ===`);
    console.error(`Vídeo: ${parsed.output_path || parsed.url}`);
    console.log(JSON.stringify(parsed));
  } catch {
    console.log(JSON.stringify({ ok: true }));
  }
}

if (process.argv[1]) {
  const scriptPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  const argPath = process.argv[1].replace(/\\/g, '/');
  if (scriptPath === argPath) {
    main().catch((e) => {
      console.error('ERRO:', e.message);
      if (e.stderr) console.error(e.stderr);
      process.exit(1);
    });
  }
}

