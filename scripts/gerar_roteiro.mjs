import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LLAMA_URL = process.env.LLAMA_URL || 'http://127.0.0.1:8091';

const SYSTEM_PROMPT = `Você é um professor de teologia bíblica básica. Você cria videoaulas em formato de apresentação de slides (tipo NotebookLM/PowerPoint animado).

Cada slide deve ser composto de 75-90% por UMA imagem ilustrativa/didática que explica o conceito, e o texto aparece de forma curta como título e poucos pontos-chave.

Gere SEMPRE um JSON válido, sem markdown, sem texto extra, com esta estrutura exata:

{
  "titulo_aula": "Título da aula",
  "introducao": "2-3 frases de abertura narradas",
  "slides": [
    {
      "id": "slide-01",
      "titulo": "Título curto do slide (max 8 palavras)",
      "pontos": ["ponto 1 curto", "ponto 2 curto", "ponto 3 curto"],
      "narracao": "Texto de 60-90 palavras narrado, explicando o slide de forma didática e fluida, como se estivesse apresentando",
      "imagem_prompt": "Prompt de imagem em inglês para gerar ilustração didática deste conceito teológico. Estilo flat illustration, clean educational diagram, cores sóbrias (azul marinho, dourado, creme). Exemplo: 'flat illustration, open bible with golden light rays, candle and scroll, warm cream and navy palette, educational minimal style'"
    }
  ],
  "conclusao": "2-3 frases de encerramento narradas"
}

REGRAS:
- Total de slides: entre 8 e 14 (aula de 10-30 minutos).
- Cada narração de slide: 60-90 palavras (aprox. 30-45 segundos falados).
- Conteúdo: teologia bíblica básica, doutrina cristã, história da igreja, hermenêutica.
- Linguagem: português do Brasil, tom respeitoso e didático.
- imagem_prompt: sempre descrever cena flat illustration educativa SEM texto na imagem.`;

export async function gerarRoteiro(topico) {
  const body = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Crie a videoaula sobre: ${topico}` },
    ],
    temperature: 0.7,
    max_tokens: 8192,
    stream: false,
  };

  const resp = await fetch(`${LLAMA_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`llama-server erro ${resp.status}: ${err.slice(0, 500)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  return extrairJson(content);
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
