import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { gerarNarracaoItem } from './gerar_narracao.mjs';

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_narracao_questionario.mjs <caminho/roteiro.json>');
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
  
  if (!questionario.perguntas || questionario.perguntas.length === 0) {
      console.error('Nenhuma pergunta encontrada no questionário.');
      process.exit(1);
  }

  console.error(`[2/3] Gerando narração do questionário (${questionario.perguntas.length} perguntas) ...`);

  const resultados = [];
  
  for (let i = 0; i < questionario.perguntas.length; i++) {
      const p = questionario.perguntas[i];
      const prefixBase = `q${String(i + 1).padStart(2, '0')}`;
      
      // 1. Narração da Pergunta e Opções
      const itemPergunta = {
          id: `${p.id}-pergunta`,
          titulo: `Pergunta ${i + 1}`,
          texto: p.narracao_pergunta,
          prefix: `${prefixBase}-pergunta`
      };
      
      // 2. Narração da Resposta
      const itemResposta = {
          id: `${p.id}-resposta`,
          titulo: `Resposta ${i + 1}`,
          texto: p.narracao_resposta,
          prefix: `${prefixBase}-resposta`
      };
      
      // Pular se já existe? O script original de narração delega o pulo ao script principal,
      // mas podemos fazer aqui ou só deixar sobrescrever. Vamos checar se existe para poupar tempo.
      const pPath = join(outDir, `${itemPergunta.prefix}-narracao.mp3`);
      if (!existsSync(pPath)) {
          await gerarNarracaoItem(itemPergunta, outDir);
      } else {
          console.error(`  [narração] ${itemPergunta.titulo} (pergunta) já existe, pulando.`);
      }
      resultados.push(pPath);

      const rPath = join(outDir, `${itemResposta.prefix}-narracao.mp3`);
      if (!existsSync(rPath)) {
          await gerarNarracaoItem(itemResposta, outDir);
      } else {
          console.error(`  [narração] ${itemResposta.titulo} (resposta) já existe, pulando.`);
      }
      resultados.push(rPath);
  }

  console.log(JSON.stringify(resultados));
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
