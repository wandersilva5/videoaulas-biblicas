/**
 * gerar_narracao_testemunho.mjs — Sintetiza a narração das cenas do testemunho
 * via Qwen3-TTS (com fallback para Edge-TTS).
 *
 * Suporta:
 *   - Regeneração de cena única (--apenas cena-01).
 *   - Forçar todos (--todos).
 *   - Idempotência baseada em hash de texto via manifesto.json.
 *
 * Uso:
 *   node gerar_narracao_testemunho.mjs output/testemunhos/<slug>/roteiro.json [--apenas <cenaId>] [--todos]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashDe } from './util.mjs';
import { gerarNarracaoItem } from './gerar_narracao.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Uso: node gerar_narracao_testemunho.mjs output/testemunhos/<slug>/roteiro.json [--apenas <cenaId>] [--todos]');
    process.exit(1);
  }

  const roteiroPath = args[0];
  const outDir = dirname(roteiroPath);
  await mkdir(outDir, { recursive: true });

  const apenasIdx = args.indexOf('--apenas');
  const apenas = apenasIdx !== -1 && args[apenasIdx + 1] ? args[apenasIdx + 1] : null;
  const todos = args.includes('--todos');

  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const cenas = roteiro.cenas || [];

  const manifestoPath = join(outDir, 'manifesto.json');
  const manifesto = await (async () => {
    try {
      return JSON.parse(await readFile(manifestoPath, 'utf8'));
    } catch {
      return { audio: {} };
    }
  })();
  if (!manifesto.audio) manifesto.audio = {};

  const itens = cenas.map((c) => ({
    id: c.id,
    titulo: c.titulo_cena || c.id,
    texto: c.narracao,
    prefix: c.id,
  }));

  let itensParaProcessar = itens;
  if (apenas) {
    itensParaProcessar = itens.filter((it) => it.id === apenas);
    if (!itensParaProcessar.length) {
      console.error(`Cena "${apenas}" não encontrada.`);
      process.exit(1);
    }
  } else if (!todos) {
    itensParaProcessar = itens.filter((it) => {
      const audioPath = join(outDir, `${it.id}-narracao.mp3`);
      const atualizado = existsSync(audioPath) && manifesto.audio[it.id] === hashDe(it.texto);
      if (atualizado) {
        console.error(`  OK: ${it.id}-narracao.mp3 já atualizado — pulando`);
        return false;
      }
      return true;
    });
  }

  if (itensParaProcessar.length === 0) {
    console.error('[narração] Todos os áudios das cenas já estão atualizados.');
    console.log(JSON.stringify([]));
    return;
  }

  const total = itensParaProcessar.length;
  console.error(`[narração] Gerando ${total} áudio(s) de narração de cenas...`);
  const resultados = [];

  for (let i = 0; i < total; i++) {
    const it = itensParaProcessar[i];
    console.error(`  [narração ${i + 1}/${total}] ${it.titulo} ...`);
    const res = await gerarNarracaoItem(it, outDir);
    manifesto.audio[it.id] = hashDe(it.texto);
    await writeFile(manifestoPath, JSON.stringify(manifesto, null, 2), 'utf8');
    resultados.push(res);
  }

  console.log(JSON.stringify(resultados, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[erro] ${err.message}`);
    process.exit(1);
  });
}
