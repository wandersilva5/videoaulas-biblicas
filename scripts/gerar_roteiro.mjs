import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { slugDe, modeloLLama, truncarMaterial, MATERIAL_MAX_CHARS } from './util.mjs';

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

const SYSTEM_PROMPT = `Você é um doutor em teologia bíblica, pentecostal. Você cria videoaulas simplifica conceitos teológicos em formato de apresentação de slides (tipo NotebookLM/PowerPoint animado).

Cada slide deve ser composto de 75-90% por UMA imagem ilustrativa/didática que explica o conceito, e o texto aparece de forma curta como título e poucos pontos-chave.

Gere SEMPRE um JSON válido, sem markdown, sem texto extra, com esta estrutura exata:

{
  "titulo_aula": "Título da aula",
  "introducao": "2-3 frases de abertura narradas, incluindo pelo menos uma referência bíblica",
  "introducao_imagem_prompt": "Prompt de imagem em inglês para a capa de abertura (mesmo estilo flat illustration dos slides; idealmente sem texto na imagem)",
  "slides": [
    {
      "id": "slide-01",
      "titulo": "Título curto do slide (max 8 palavras)",
      "pontos": ["ponto 1 curto", "ponto 2 curto", "ponto 3 curto"],
      "narracao": "Texto de 60-90 palavras narrado, explicando o slide de forma didática e fluida, como se estivesse apresentando, citando a referência bíblica",
      "referencia_biblica": "Livro capítulo:versículo (ex.: João 3:16)",
      "imagem_prompt": "Prompt de imagem em inglês para gerar ilustração didática deste conceito teológico. Estilo flat illustration, clean educational diagram, cores sóbrias (azul marinho, dourado, creme). Qualquer texto que aparecer na imagem deve estar em português do Brasil (pt-BR). Exemplo: 'flat illustration, open bible with golden light rays, candle and scroll, warm cream and navy palette, educational minimal style, text in Portuguese'"
    }
  ],
  "conclusao": "3-5 frases de encerramento narradas: comece agradecendo a audiência, feche com uma aplicação prática e outra referência bíblica, e termine convidando a apoiar o projeto — inscrever-se no canal, curtir e compartilhar o vídeo para que mais pessoas sejam abençoadas, e ler a descrição para saber como apoiar de outras formas",
  "conclusao_imagem_prompt": "Prompt de imagem em inglês para a capa de encerramento (mesmo estilo flat illustration dos slides; idealmente sem texto na imagem)"
}

REGRAS:
- Total de slides: no mínimo 15 (aula de 20-40 minutos); não há limite máximo.
- Cada narração de slide: 60-90 palavras (aprox. 30-45 segundos falados).
- Conteúdo: teologia bíblica básica, doutrina cristã, história da igreja, hermenêutica.
- Linguagem: português do Brasil, tom respeitoso e didático.
- Referências bíblicas: TODOS os slides, a introdução e a conclusão devem citar ao menos uma referência bíblica (livro capítulo:versículo) no campo "referencia_biblica" e mencioná-la na narração. Use a versão Almeida Revista e Corrigida (ARC) como base para o texto das citações.
- As referências devem estar corretas e fiéis ao ensino bíblico, com o estudo permanecendo educacional, cristão e edificante (fé, doutrina e prática).
- Explicação de termos: sempre que um termo técnico ou importante aparecer (ex.: teologia, hermenêutica, exegese, escatologia, soteriologia, graça, santificação, expiação, justificação, etc.), dedique um ponto do slide para explicá-lo de forma simples, com origem etimológica quando ajudar (ex.: "Teologia vem do grego: Teo = Deus + logia = estudo, ou seja, estudo sobre Deus"). Linguagem acessível, como quem conversa com um iniciante, sem jargão acadêmico.
- Narração legível por leitor de voz (TTS): nos campos de narração (introducao, slides, conclusao) escreva as referências bíblicas por extenso como seriam faladas, ex.: "Primeira Timóteo 3, 1" em vez de "1 Timóteo 3:1", "João 3, 16" em vez de "João 3:16". Já o campo "referencia_biblica" deve continuar no formato padrão (ex.: "1 Timóteo 3:1").
- imagem_prompt: sempre descrever cena flat illustration educativa. Se houver qualquer texto na imagem, ele deve estar em português do Brasil (pt-BR) e sem erros de ortografia; idealmente minimize texto na imagem.`;

/** Texto do material de apoio (extraído de PDF) embutido no prompt do usuário. */
function montarContentDoUsuario(topico, material, tentativa, MIN_SLIDES) {
  const base = `Crie a videoaula sobre: ${topico}`;
  const materialBlock = material
    ? `\n\nBASEIE o conteúdo da aula neste material extraído de um PDF de estudo (apostila). Use os conceitos, a estrutura e os exemplos dele para montar os slides, mantendo o tom didático e as regras do prompt de sistema:\n\n--- INÍCIO DO MATERIAL ---\n${material}\n--- FIM DO MATERIAL ---`
    : '';
  if (tentativa > 1) {
    return `${base}${materialBlock}\n\nATENÇÃO: a tentativa anterior foi rejeitada por não passar na validação. É obrigatório gerar no mínimo ${MIN_SLIDES} slides, cada um com id no padrão "slide-NN", narração de 60-90 palavras e campo "imagem_prompt" preenchido.`;
  }
  return `${base}${materialBlock}`;
}

export async function gerarRoteiro(topico, { material } = {}) {
  const MIN_SLIDES = 15;
  const maxTentativas = 3;
  let ultimaRota = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    if (tentativa > 1) console.error(`  Roteiro reprovado na validação; regerando (tentativa ${tentativa}/${maxTentativas}) ...`);
    const body = {
      model: modeloLLama(),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: montarContentDoUsuario(topico, material, tentativa, MIN_SLIDES),
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

    const reparos = repararRoteiro(roteiro);
    const { valido, erros, avisos } = validarRoteiro(roteiro, { minSlides: MIN_SLIDES });

    if (reparos > 0) console.error(`  Roteiro normalizado: ${reparos} campo(s) ajustado(s) automaticamente.`);
    for (const a of avisos) console.error(`  aviso: ${a}`);
    if (valido) return roteiro;

    for (const e of erros) console.error(`  erro: ${e}`);
    ultimaRota = roteiro;
  }

  const resumo = ultimaRota
    ? `${ultimaRota.slides?.length ?? 0} slides e ${validarRoteiro(ultimaRota, { minSlides: MIN_SLIDES }).erros.length} erro(s) de validação`
    : 'sem resposta do modelo';
  throw new Error(
    `Modelo não gerou um roteiro válido após ${maxTentativas} tentativas (${resumo}).`,
  );
}

/**
 * Tenta reparar um JSON truncado/malformado antes de abandonar:
 *  - remove vírgulas soltas (ex.: `[1, 2, ]`, `{"a": 1,}`)
 *  - fecha string aberta no fim (modelo cortou no meio de uma narração)
 *  - fecha colchetes/chaves desbalanceados (append do que falta)
 * Retorna o texto reparado (pode continuar inválido — o parse decide).
 */
export function repararJsonTruncado(s) {
  let t = String(s ?? '').trim();
  if (!t) return t;

  // 1) Vírgulas antes de fechamento
  t = t.replace(/,\s*([\]}])/g, '$1');

  // 2) Varredura para achar string aberta e delimitadores desbalanceados
  const pilha = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      pilha.push(ch);
    } else if (ch === '}' || ch === ']') {
      if (pilha.length) {
        const topo = pilha[pilha.length - 1];
        if ((topo === '{' && ch === '}') || (topo === '[' && ch === ']')) pilha.pop();
      }
    }
  }

  // 3) Fecha string aberta no fim (valor truncado vira string incompleta válida)
  if (inString) t += '"';

  // 4) Remove vírgula final solta (ex.: termina em `,`)
  t = t.replace(/,\s*$/, '');

  // 5) Fecha os delimitadores que sobraram na pilha
  while (pilha.length) {
    t += pilha.pop() === '{' ? '}' : ']';
  }
  return t;
}

export function extrairJson(content) {
  // Tentar parse direto primeiro (resposta limpa)
  try {
    return JSON.parse(content.trim());
  } catch {
    // Fallback: remover code fences e extrair o JSON
    const semFence = content
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();
    const inicio = semFence.indexOf('{');
    if (inicio === -1) {
      throw new Error('Resposta do modelo não contém JSON válido. Resposta: ' + content.slice(0, 400));
    }
    const fim = semFence.lastIndexOf('}');
    const candidatos = [];
    if (fim !== -1 && fim >= inicio) candidatos.push(semFence.slice(inicio, fim + 1));
    candidatos.push(semFence.slice(inicio));
    for (const c of candidatos) {
      try {
        return JSON.parse(c);
      } catch {
        /* segue para o reparo */
      }
      try {
        return JSON.parse(repararJsonTruncado(c));
      } catch {
        /* tenta o próximo candidato */
      }
    }
    throw new Error('Resposta do modelo não contém JSON válido. Resposta: ' + content.slice(0, 400));
  }
}

const contarPalavras = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
const padSlide = (i) => String(i + 1).padStart(2, '0');

/**
 * Normaliza campos triviais do roteiro que o modelo pode esquecer ou escrever
 * fora do padrão: id sequencial "slide-NN", titulo não vazio e pontos como lista.
 * Narração/imagem_prompt vazios NÃO são corrigidos aqui (viram erro → regera).
 * Retorna o número de ajustes feitos.
 */
export function repararRoteiro(roteiro) {
  let reparos = 0;
  if (!roteiro || typeof roteiro !== 'object' || !Array.isArray(roteiro.slides)) return reparos;
  roteiro.slides.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const num = padSlide(i);
    if (s.id !== `slide-${num}`) {
      s.id = `slide-${num}`;
      reparos++;
    }
    if (typeof s.titulo !== 'string' || !s.titulo.trim()) {
      s.titulo = `Slide ${num}`;
      reparos++;
    }
    if (!Array.isArray(s.pontos)) {
      s.pontos = [];
      reparos++;
    }
  });
  return reparos;
}

/**
 * Valida o roteiro gerado contra o contrato esperado pelas etapas seguintes
 * (imagens, narração, vídeo). Retorna { valido, erros, avisos }:
 *  - erros: problema que quebra alguma etapa seguinte → exige regenerar.
 *  - avisos: fora do ideal (ex.: narração 45 palavras) mas não bloqueia.
 */
export function validarRoteiro(roteiro, { minSlides = 15 } = {}) {
  const erros = [];
  const avisos = [];
  const rotulo = (i) => `slide ${padSlide(i)}`;

  if (!roteiro || typeof roteiro !== 'object') {
    erros.push('Roteiro não é um objeto');
    return { valido: false, erros, avisos };
  }

  if (typeof roteiro.titulo_aula !== 'string' || !roteiro.titulo_aula.trim()) erros.push('titulo_aula vazio');
  if (typeof roteiro.introducao !== 'string' || !roteiro.introducao.trim()) erros.push('introducao vazia');
  if (typeof roteiro.conclusao !== 'string' || !roteiro.conclusao.trim()) erros.push('conclusao vazia');
  if (typeof roteiro.introducao_imagem_prompt !== 'string' || !roteiro.introducao_imagem_prompt.trim()) {
    avisos.push('introducao_imagem_prompt ausente (será usado o prompt padrão da capa)');
  }
  if (typeof roteiro.conclusao_imagem_prompt !== 'string' || !roteiro.conclusao_imagem_prompt.trim()) {
    avisos.push('conclusao_imagem_prompt ausente (será usado o prompt padrão da capa)');
  }

  if (!Array.isArray(roteiro.slides)) {
    erros.push('slides não é uma lista');
    return { valido: false, erros, avisos };
  }

  if (roteiro.slides.length < minSlides) erros.push(`poucos slides (${roteiro.slides.length}; mínimo ${minSlides})`);

  const ids = new Set();
  roteiro.slides.forEach((s, i) => {
    const r = rotulo(i);
    if (!s || typeof s !== 'object') {
      erros.push(`${r}: não é um objeto`);
      return;
    }
    if (typeof s.id !== 'string' || !/^slide-\d{2}$/.test(s.id) || ids.has(s.id)) {
      erros.push(`${r}: id inválido ou duplicado ("${s.id}")`);
    } else {
      ids.add(s.id);
    }

    if (typeof s.titulo !== 'string' || !s.titulo.trim()) avisos.push(`${r}: titulo vazio`);
    else if (contarPalavras(s.titulo) > 8) avisos.push(`${r}: titulo com ${contarPalavras(s.titulo)} palavras (máx. 8)`);

    if (!Array.isArray(s.pontos)) avisos.push(`${r}: pontos não é uma lista`);
    else if (s.pontos.length === 0) avisos.push(`${r}: sem pontos`);

    const n = contarPalavras(s.narracao);
    if (typeof s.narracao !== 'string' || !s.narracao.trim()) erros.push(`${r}: narracao vazia`);
    else if (n < 30) erros.push(`${r}: narracao curta demais (${n} palavras)`);
    else if (n < 50 || n > 110) avisos.push(`${r}: narracao com ${n} palavras (ideal 60-90)`);

    if (typeof s.referencia_biblica !== 'string' || !s.referencia_biblica.trim()) {
      avisos.push(`${r}: referencia_biblica vazia`);
    }

    if (typeof s.imagem_prompt !== 'string' || !s.imagem_prompt.trim()) erros.push(`${r}: imagem_prompt vazio`);
    else if (contarPalavras(s.imagem_prompt) < 5) avisos.push(`${r}: imagem_prompt muito curto (${contarPalavras(s.imagem_prompt)} palavras)`);
  });

  return { valido: erros.length === 0, erros, avisos };
}

async function main() {
  const topico = process.argv[2];
  if (!topico) {
    console.error('Uso: node gerar_roteiro.mjs "Tópico da aula" [--material caminho-do-texto.txt]');
    process.exit(1);
  }

  const idxMaterial = process.argv.indexOf('--material');
  let material = null;
  if (idxMaterial !== -1 && process.argv[idxMaterial + 1]) {
    material = readFileSync(process.argv[idxMaterial + 1], 'utf8');
    if (material.length > MATERIAL_MAX_CHARS) {
      console.error(`  Material de apoio truncado de ${material.length} para ${MATERIAL_MAX_CHARS} caracteres (contexto do llama).`);
      material = truncarMaterial(material, MATERIAL_MAX_CHARS);
    }
  }

  const slug = slugDe(topico);

  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'output', slug);
  await mkdir(outDir, { recursive: true });

  console.error(`[1/4] Gerando roteiro para: ${topico} ...`);
  const roteiro = await gerarRoteiro(topico, { material });
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
