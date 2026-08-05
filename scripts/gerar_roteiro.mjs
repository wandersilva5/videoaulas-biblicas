import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';

const LLAMA_URL = process.env.LLAMA_URL || 'http://127.0.0.1:8091';

function postJson(url, body, { timeoutMs = 30 * 60 * 1000 } = {}) {
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

const SYSTEM_PROMPT = `Você é um professor de teologia bíblica básica. Você cria videoaulas em formato de apresentação de slides (tipo NotebookLM/PowerPoint animado).

Cada slide deve ser composto de 75-90% por UMA imagem ilustrativa/didática que explica o conceito, e o texto aparece de forma curta como título e poucos pontos-chave.

Gere SEMPRE um JSON válido, sem markdown, sem texto extra, com esta estrutura exata:

{
  "titulo_aula": "Título da aula",
  "introducao": "2-3 frases de abertura narradas, incluindo pelo menos uma referência bíblica",
  "slides": [
    {
      "id": "slide-01",
      "titulo": "Título curto do slide (max 8 palavras)",
      "pontos": ["ponto 1 curto", "ponto 2 curto", "ponto 3 curto"],
      "narracao": "Texto de 60-90 palavras narrado, explicando o slide de forma didática e fluida, como se estivesse apresentando, citando a referência bíblica",
      "referencia_biblica": "Livro capítulo:versículo (ex.: João 3:16)",
      "imagem_prompt": "Prompt de imagem em inglês para gerar ilustração didática deste conceito teológico. Estilo flat illustration, clean educational diagram, cores sóbrias (azul marinho, dourado, creme). Exemplo: 'flat illustration, open bible with golden light rays, candle and scroll, warm cream and navy palette, educational minimal style'"
    }
  ],
  "conclusao": "2-3 frases de encerramento narradas, fechando com uma aplicação prática e outra referência bíblica"
}

REGRAS:
- Total de slides: no mínimo 15 (aula de 20-40 minutos); não há limite máximo.
- Cada narração de slide: 60-90 palavras (aprox. 30-45 segundos falados).
- Conteúdo: teologia bíblica básica, doutrina cristã, história da igreja, hermenêutica.
- Linguagem: português do Brasil, tom respeitoso e didático.
- Referências bíblicas: TODOS os slides, a introdução e a conclusão devem citar ao menos uma referência bíblica (livro capítulo:versículo) no campo "referencia_biblica" e mencioná-la na narração. Use a versão Almeida Revista e Corrigida (ARC) como base para o texto das citações.
- As referências devem estar corretas e fiéis ao ensino bíblico, com o estudo permanecendo educacional, cristão e edificante (fé, doutrina e prática).
- Explicação de termos: sempre que um termo técnico ou importante aparecer (ex.: teologia, hermenêutica, exegese, escatologia, soteriologia, graça, santificação, expiação, justificação, etc.), dedique um ponto do slide para explicá-lo de forma simples, com origem etimológica quando ajudar (ex.: "Teologia vem do grego: Teo = Deus + logia = estudo, ou seja, estudo sobre Deus"). Linguagem acessível, como quem conversa com um iniciante, sem jargão acadêmico.
- imagem_prompt: sempre descrever cena flat illustration educativa SEM texto na imagem.`;

export async function gerarRoteiro(topico) {
  const MIN_SLIDES = 15;
  const maxTentativas = 3;
  let ultimaRota = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    if (tentativa > 1) console.error(`  Roteiro com menos de ${MIN_SLIDES} slides; regerando (tentativa ${tentativa}/${maxTentativas}) ...`);
    const body = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content:
            tentativa > 1
              ? `Crie a videoaula sobre: ${topico}\n\nATENÇÃO: é obrigatório gerar no mínimo ${MIN_SLIDES} slides. A tentativa anterior foi rejeitada por ter menos slides que o mínimo.`
              : `Crie a videoaula sobre: ${topico}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 16384,
      stream: false,
    };

    const resp = await postJson(`${LLAMA_URL}/v1/chat/completions`, body);

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
    const roteiro = extrairJson(content);

    if (Array.isArray(roteiro.slides) && roteiro.slides.length >= MIN_SLIDES) {
      return roteiro;
    }
    ultimaRota = roteiro;
  }

  throw new Error(
    `Modelo não gerou o mínimo de ${MIN_SLIDES} slides após ${maxTentativas} tentativas (recebidos: ${ultimaRota?.slides?.length ?? 0}).`,
  );
}

export function extrairJson(content) {
  // Tentar parse direto primeiro (resposta limpa)
  try {
    return JSON.parse(content.trim());
  } catch {
    // Fallback: remover code fences e extrair primeiro objeto JSON
    const semFence = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const inicio = semFence.indexOf('{');
    const fim = semFence.lastIndexOf('}');
    if (inicio === -1 || fim === -1) {
      throw new Error('Resposta do modelo não contém JSON válido. Resposta: ' + content.slice(0, 400));
    }
    return JSON.parse(semFence.slice(inicio, fim + 1));
  }
}

async function main() {
  const topico = process.argv[2];
  if (!topico) {
    console.error('Uso: node gerar_roteiro.mjs "Tópico da aula"');
    process.exit(1);
  }

  const slug = topico
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'output', slug);
  await mkdir(outDir, { recursive: true });

  console.error(`[1/4] Gerando roteiro para: ${topico} ...`);
  const roteiro = await gerarRoteiro(topico);
  roteiro.slug = slug;
  roteiro.topico = topico;

  const roteiroPath = join(outDir, 'roteiro.json');
  await writeFile(roteiroPath, JSON.stringify(roteiro, null, 2), 'utf8');
  console.error(`Roteiro salvo: ${roteiroPath}`);
  console.log(JSON.stringify({ slug, slides: roteiro.slides.length, roteiroPath }));
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
