import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { slugDe, modeloLLama } from './util.mjs';

const LLAMA_URL = process.env.LLAMA_URL || 'http://127.0.0.1:8091';

function postJson(url, body, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error(`llama-server não respondeu em ${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function postJsonComRetry(url, body, { timeoutMs = 15 * 60 * 1000, retries = 3 } = {}) {
  for (let i = 1; i <= retries; i++) {
    const resp = await postJson(url, body, { timeoutMs });
    if (resp.status !== 503) return resp;
    if (i === retries) throw new Error(`llama-server 503 após ${retries} tentativas`);
    const espera = 5000 * i;
    console.error(`  [retry] llama-server carregando modelo; aguardando ${espera / 1000}s (${i}/${retries})`);
    await new Promise((r) => setTimeout(r, espera));
  }
}

function extrairJson(content) {
  try {
    return JSON.parse(content.trim());
  } catch {
    const semFence = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const inicio = semFence.indexOf('{');
    if (inicio === -1) {
      throw new Error('Resposta do modelo não contém JSON válido.');
    }
    const fim = semFence.lastIndexOf('}');
    if (fim === -1 || fim < inicio) {
        throw new Error('JSON truncado retornado pelo modelo.');
    }
    return JSON.parse(semFence.slice(inicio, fim + 1));
  }
}

const SYSTEM_PROMPT = `Você é um doutor em teologia bíblica elaborando um questionário em formato de videoaula para avaliar o aprendizado dos alunos.

Você vai receber o texto de um "roteiro" e deve gerar 5 perguntas de múltipla escolha (3 opções cada) baseadas no conteúdo apresentado.

Gere SEMPRE um JSON válido, sem markdown, sem texto extra, com esta estrutura exata:

{
  "perguntas": [
    {
      "id": "q1",
      "tema": "Tema curto da pergunta (ex: Definição de Teologia)",
      "numero": 1,
      "pergunta": "Qual é a pergunta?",
      "opcoes": [
        "A) Opção incorreta ou correta",
        "B) Opção incorreta ou correta",
        "C) Opção incorreta ou correta"
      ],
      "resposta_correta": 1, 
      "narracao_pergunta": "Texto a ser narrado para apresentar a pergunta e as opções. Exemplo: 'Pergunta número 1: Qual é a definição de Teologia? Opção A: ... Opção B: ... Opção C: ... Você tem 10 segundos para responder.'",
      "narracao_resposta": "Texto a ser narrado para revelar a resposta e explicar rapidamente. Exemplo: 'A resposta correta é a letra B. Teologia significa o estudo sobre Deus.'"
    }
  ]
}

REGRAS:
- "resposta_correta" deve ser um número inteiro de 0 a 2, indicando o índice da opção certa na lista "opcoes" (0 = A, 1 = B, 2 = C).
- Embaralhe as posições das respostas corretas para não ficarem todas na mesma letra.
- As perguntas não devem ser difíceis demais; o foco é retenção básica.
- A "narracao_resposta" deve ser clara, começar indicando qual é a letra certa e dar uma breve explicação do motivo (1-2 frases). O campo "narracao_pergunta" será gerado a partir das opções reais para garantir consistência entre o áudio e o que aparece na tela.
- A "narracao_resposta" deve ser clara, começar indicando qual é a letra certa e dar uma breve explicação do motivo (1-2 frases).`;

async function gerarQuestionario(roteiroTexto) {
  const body = {
    model: modeloLLama(),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Crie 5 perguntas baseadas no seguinte roteiro:\n\n${roteiroTexto}` },
    ],
    temperature: 0.7,
    max_tokens: 4096,
    stream: false,
  };

  const resp = await postJsonComRetry(`${LLAMA_URL}/v1/chat/completions`, body);

  if (resp.status !== 200) {
    throw new Error(`llama-server erro ${resp.status}: ${resp.text.slice(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(resp.text);
  } catch {
    throw new Error(`llama-server retornou JSON inválido: ${resp.text.slice(0, 500)}`);
  }
  
  const content = data.choices?.[0]?.message?.content ?? '';
  const questionario = extrairJson(content);
  
  if (!questionario.perguntas || !Array.isArray(questionario.perguntas) || questionario.perguntas.length === 0) {
      throw new Error('O JSON gerado não contém a lista "perguntas" válida.');
  }

  return questionario;
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_questionario.mjs <caminho/roteiro.json>');
    process.exit(1);
  }

  const roteiro = JSON.parse(readFileSync(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);
  const slug = roteiro.slug || basename(outDir);
  
  // Compactar o roteiro para enviar ao modelo
  const roteiroTexto = [
      `Título: ${roteiro.titulo_aula}`,
      `Introdução: ${roteiro.introducao}`,
      ...(roteiro.slides || []).map(s => `Slide (${s.titulo}): ${s.narracao}`),
      `Conclusão: ${roteiro.conclusao}`
  ].join('\n\n');

  console.error(`[1/3] Gerando questionário para: ${roteiro.titulo_aula} ...`);
  const questionario = await gerarQuestionario(roteiroTexto);

  const outputPath = join(outDir, 'questionario.json');
  await writeFile(outputPath, JSON.stringify(questionario, null, 2), 'utf8');
  console.error(`Questionário salvo: ${outputPath}`);
  console.log(JSON.stringify({ slug, perguntas: questionario.perguntas.length, arquivo: outputPath }));
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
