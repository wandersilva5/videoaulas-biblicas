import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prefixoNarracao, hashDe } from './util.mjs';

const VOZ = process.env.VOZ || 'pt-BR-AntonioNeural';

const ORDINAIS_LIVROS = { '1': 'Primeira', '2': 'Segunda', '3': 'Terceira' };

/**
 * Normaliza o texto para o leitor de voz (edge-tts) pronunciar referências
 * bíblicas corretamente:
 *   - "1 Timóteo 3:1"  -> "Primeira Timóteo 3, 1"
 *   - "João 3:16"      -> "João 3, 16"
 *   - "1 Cor 13:4-7"   -> "Primeira Coríntios 13, 4 a 7"
 * Sem isso o TTS lê "1 Timóteo 3 horas e 1 minuto".
 */
export function normalizarReferenciasParaTts(texto) {
  return String(texto ?? '')
    // Numeral do livro -> ordinal (somente antes de nome de livro bíblico)
    .replace(
      /\b([123])\s+(Timóteo|Coríntios|Tessalonicenses|Pedro|João|Joao|Reis|Crônicas|Cronicas|Samuel|Esdras|Macabeus)\b/gi,
      (_, n, livro) => `${ORDINAIS_LIVROS[n]} ${livro}`,
    )
    // capítulo:versículo (com faixa opcional) -> capítulo, versículo
    .replace(/\b(\d{1,3}):(\d{1,3})(?:\s*-\s*(\d{1,3}))?\b/g, (_, c, v, f) =>
      f ? `${c}, ${v} a ${f}` : `${c}, ${v}`,
    );
}

function tts(texto, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('edge-tts', ['--voice', VOZ, '--text', texto, '--write-media', outPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`edge-tts exit ${code}: ${err.slice(0, 300)}`));
    });
  });
}

/** Gera o MP3 de um único item (intro, slide ou conclusão). */
export async function gerarNarracaoItem(item, outDir) {
  const outPath = join(outDir, `${item.prefix}-narracao.mp3`);
  console.error(`  [narração] ${item.titulo} ...`);
  await tts(normalizarReferenciasParaTts(item.texto), outPath);
  console.error(`  OK: ${outPath}`);
  return { id: item.id, titulo: item.titulo, path: outPath };
}

export async function gerarNarracao(roteiro, outDir) {
  const narracao = [];
  const textos = [
    { id: 'intro', titulo: 'Introdução', texto: roteiro.introducao },
    ...roteiro.slides.map((s) => ({ id: s.id, titulo: s.titulo, texto: s.narracao })),
    { id: 'conclusao', titulo: 'Conclusão', texto: roteiro.conclusao },
  ];
  const total = textos.length;
  for (let i = 0; i < textos.length; i++) {
    const item = { ...textos[i], prefix: prefixoNarracao(i, total) };
    console.error(`  [narração ${i + 1}/${total}] ${item.titulo} ...`);
    narracao.push(await gerarNarracaoItem(item, outDir));
  }
  return narracao;
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_narracao.mjs <caminho/roteiro.json> [--apenas <id>] [--todos]');
    console.error('  --apenas <id>  regenera só um item: intro, slide-01..., conclusao');
    console.error('  --todos         regenera todos (ignora o manifesto — por padrão pula itens já atualizados)');
    process.exit(1);
  }
  const apenasIdx = process.argv.indexOf('--apenas');
  const apenas = apenasIdx !== -1 ? process.argv[apenasIdx + 1] : null;
  const todos = process.argv.includes('--todos');
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);
  const textos = [
    { id: 'intro', titulo: 'Introdução', texto: roteiro.introducao },
    ...roteiro.slides.map((s) => ({ id: s.id, titulo: s.titulo, texto: s.narracao })),
    { id: 'conclusao', titulo: 'Conclusão', texto: roteiro.conclusao },
  ];
  const total = textos.length;
  let items = textos.map((t, i) => ({ ...t, prefix: prefixoNarracao(i, total) }));
  if (apenas) {
    items = items.filter((t) => t.id === apenas);
    if (items.length === 0) {
      console.error(`ERRO: item "${apenas}" não encontrado (use: intro, slide-XX ou conclusao)`);
      process.exit(1);
    }
  } else if (!todos) {
    const manifest = await (async () => {
      try {
        return JSON.parse(await readFile(join(outDir, 'manifesto.json'), 'utf8'));
      } catch {
        return { audio: {} };
      }
    })();
    const filtrados = [];
    for (const item of items) {
      const mp3 = join(outDir, `${item.prefix}-narracao.mp3`);
      const atualizado = existsSync(mp3) && manifest.audio?.[item.id] === hashDe(item.texto);
      if (atualizado) {
        console.error(`  OK: ${item.prefix}-narracao.mp3 já atualizado — pulando (${item.titulo})`);
      } else {
        filtrados.push(item);
      }
    }
    items = filtrados;
  }
  if (items.length === 0) {
    console.error('[3/4] Nenhuma narração precisa ser gerada — tudo atualizado no manifesto.');
    console.log(JSON.stringify([]));
    return;
  }
  console.error(`[3/4] Gerando ${items.length} arquivo(s) de narração ...`);
  const narracao = [];
  for (const item of items) narracao.push(await gerarNarracaoItem(item, outDir));
  console.log(JSON.stringify(narracao));
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
