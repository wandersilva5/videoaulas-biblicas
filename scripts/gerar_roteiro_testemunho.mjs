/**
 * gerar_roteiro_testemunho.mjs — Transforma um relato em texto ou arquivo .txt em
 * um roteiro de testemunho de fé audiovisual dividido em cenas integradas.
 *
 * Regras inegociáveis:
 * 1. Fidelidade absoluta ao relato original (zero invenção de fatos, nomes ou milagres).
 * 2. Hook/Gancho de impacto nos primeiros 3 segundos da Cena 1.
 * 3. Cenas minimalistas e cinematográficas de 25-45 palavras, ilustradas por
 *    várias imagens (TESTEMUNHO_IMAGENS_POR_CENA, padrão 3) que se revezam no vídeo.
 * 4. Fechamento adulto e acolhedor com CTA para ouvir mais testemunhos.
 *
 * Uso:
 *   node gerar_roteiro_testemunho.mjs --titulo "Meu Milagre" --arquivo caminho/relato.txt [--formato 16:9]
 *   node gerar_roteiro_testemunho.mjs --titulo "Meu Milagre" --texto "texto..." [--formato 16:9]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { slugDe, modeloLLama, limparTextoDePromptImagem } from './util.mjs';
import { extrairJson } from './gerar_roteiro.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS_DIR, '..');
const LLAMA_URL = process.env.LLAMA_URL || 'http://127.0.0.1:8091';

// Quantas imagens ilustram cada cena (revezadas no vídeo durante a narração).
const IMAGENS_POR_CENA = Math.max(1, Number(process.env.TESTEMUNHO_IMAGENS_POR_CENA) || 3);

// Reenquadros usados para completar a cena quando o modelo devolve menos
// prompts que o alvo — variações do MESMO instante, sem inventar elementos.
const VARIACOES_DE_QUADRO = [
  'wide establishing shot of the same scene, generous negative space, soft atmospheric light',
  'intimate close-up detail of the same moment, shallow depth of field, warm rim light',
  'low angle silhouette against the light source, minimalist cinematic composition',
  'overhead view of the same scene, muted palette, gentle falling shadows',
  'slow motion feel, drifting particles of light, same subject and setting',
  'side profile framing, deep shadows, single warm light source, quiet mood',
];

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

const SYSTEM_PROMPT = `Você é um roteirista sênior especializado em testemunhos reais cristãos e biografias narradas.
Sua missão é transformar o relato real fornecido em um roteiro audiovisual impactante, dividido em cenas sequenciais.

REGRAS OBRIGATÓRIAS E INEGOCIÁVEIS:
1. FIDELIDADE ABSOLUTA AO RELATO (ZERO INVENÇÃO):
   - Você NÃO pode inventar personagens, nomes, diagnósticos médicos, lugares, datas ou desfechos que não estejam explícitos no texto fornecido.
   - Se o relato for curto, preserve a essência exata sem adicionar ficção.
   - Sua tarefa é puramente dar cadência dramática, pontuação madura e ritmo audiovisual ao relato real.

2. OS PRIMEIROS 3 SEGUNDOS (HOOK OBRIGATÓRIO NA CENA 1):
   - A primeiríssima frase narrada da Cena 1 DEVE ser um gancho de impacto que prenda a atenção imediatamente.
   - NUNCA comece com saudações mornas ("Olá irmãos", "A paz do Senhor", "Hoje vou contar...").
   - Comece direto no momento decisivo, na vulnerabilidade ou no dilema central da história.

3. TOM ADULTO, RESPEITOSO E CATIVANTE:
   - Narrativa madura, profunda, sóbria e emocionante, sem pieguice e sem sensacionalismo.
   - Português do Brasil natural, com frases bem pontuadas para pausas dramáticas de leitor de voz (TTS).
   - Escreva números e ordinais por extenso quando forem lidos em voz alta.

4. CENAS SEQUENCIAIS MINIMALISTAS (VÁRIAS IMAGENS POR CENA):
    - Divida a história entre 6 e 12 cenas (dependendo da extensão do relato).
    - Cada cena narrada deve ter entre 25 e 45 palavras (tempo ideal de 10 a 16 segundos por imagem).
    - Cada cena DEVE trazer exatamente ${IMAGENS_POR_CENA} prompts de imagem em Inglês no array "imagens":
      * TODOS descrevem O MESMO instante da cena, em planos/ângulos diferentes (plano aberto, detalhe próximo, silhueta contra a luz, visão superior...).
      * Estilo minimalista, conceitual e cinematográfico. Descreva luz, sombra, atmosfera, silhuetas ou ação simples e marcante.
      * NUNCA coloque texto na imagem. Sem balões de fala, sem diagramas.
      * NUNCA invente elementos novos: são apenas reenquadros do mesmo momento já narrado.
      * Exemplo: ["cinematic minimalist illustration of a lone figure in prayer under a gentle beam of golden light in a dark room, wide shot, deep emotional atmosphere, no text", "close-up of clasped hands in dim warm light, minimalist cinematic, no text", "silhouette of a person kneeling by a window at dawn, soft golden rays, minimalist, no text"]

5. FECHAMENTO E CTA NA ÚLTIMA CENA:
    - A última cena encerra o testemunho com gratidão e esperança para o espectador.
    - Convida de forma calorosa e elegante a compartilhar a história com quem precisa de esperança e se inscrever para ouvir mais testemunhos reais.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON PURO, SEM MARKDOWN):
{
  "titulo": "Título do Testemunho",
  "hook_3s": "Frase de impacto dos primeiros 3 segundos",
  "cenas": [
    {
      "id": "cena-01",
      "titulo_cena": "O Ponto de Ruptura",
      "narracao": "Frase de impacto que prende nos primeiros 3 segundos. Desenvolvimento curto da cena...",
      "imagens": ["cinematic minimalist illustration of...", "close-up minimalist illustration of...", "silhouette minimalist illustration of..."]
    }
  ]
}`;

/**
 * Normaliza os prompts de imagem de uma cena: aceita `imagens` (novo) ou
 * `imagem_prompt` (legado), remove vazios/duplicados e completa com
 * reenquadros do mesmo instante até atingir IMAGENS_POR_CENA.
 */
function normalizarImagens(c) {
  const brutos = Array.isArray(c.imagens) ? c.imagens : c.imagem_prompt ? [c.imagem_prompt] : [];
  const limpos = [
    ...new Set(brutos.map((p) => limparTextoDePromptImagem(String(p ?? '').trim())).filter(Boolean)),
  ];
  while (limpos.length < IMAGENS_POR_CENA) {
    const base =
      limpos[0] ||
      'cinematic minimalist illustration, soft warm light, deep shadows, hopeful atmosphere, no text';
    limpos.push(
      limparTextoDePromptImagem(
        `${base}, ${VARIACOES_DE_QUADRO[(limpos.length - 1) % VARIACOES_DE_QUADRO.length]}`,
      ),
    );
  }
  return limpos;
}

export async function gerarRoteiroTestemunho({ titulo, texto, formato = '16:9' }) {
  if (!texto || !texto.trim()) {
    throw new Error('Texto do testemunho não fornecido.');
  }

  const modelo = modeloLLama();
  console.error(`[testemunho] Gerando roteiro com o modelo: ${modelo}...`);

  const userPrompt = `TÍTULO / TEMA: "${titulo || 'Testemunho Real de Fé'}"
FORMATO VISUAL: ${formato}

RELATO REAL FORNECIDO:
"""
${texto.trim()}
"""

Transforme este relato no roteiro de cenas com fidelidade estrita. Responda APENAS com o JSON.`;

  const payload = {
    model: modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.6,
    max_tokens: 4096,
    stream: false,
  };

  const resp = await postJson(`${LLAMA_URL}/v1/chat/completions`, payload);
  if (resp.status !== 200) {
    throw new Error(`llama-server retornou status HTTP ${resp.status}: ${resp.text.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(resp.text);
  } catch (e) {
    throw new Error(`Falha ao decodificar resposta do llama: ${e.message}`);
  }

  const rawContent = data.choices?.[0]?.message?.content?.trim();
  if (!rawContent) {
    throw new Error('llama-server retornou conteúdo vazio para o roteiro.');
  }

  const roteiro = extrairJson(rawContent);

  // Validações essenciais
  if (!roteiro.cenas || !Array.isArray(roteiro.cenas) || roteiro.cenas.length === 0) {
    throw new Error('Roteiro gerado não contém uma lista válida de cenas.');
  }
  if (roteiro.cenas.length < 4) {
    console.error(`[testemunho][aviso] Roteiro com apenas ${roteiro.cenas.length} cenas — o ideal é 6 ou mais.`);
  }

  // Normalização
  const slug = slugDe(titulo || roteiro.titulo || 'testemunho');
  roteiro.titulo = (titulo || roteiro.titulo || 'Testemunho de Fé').trim();
  roteiro.slug = slug;
  roteiro.formato = formato;
  roteiro.hook_3s = (roteiro.hook_3s || roteiro.cenas[0]?.narracao?.slice(0, 100) || '').trim();

  roteiro.cenas = roteiro.cenas.map((c, i) => {
    const num = String(i + 1).padStart(2, '0');
    const imagens = normalizarImagens(c);
    return {
      id: `cena-${num}`,
      titulo_cena: c.titulo_cena ? String(c.titulo_cena).trim() : `Cena ${i + 1}`,
      narracao: String(c.narracao || '').trim(),
      imagens,
      // Compat: leitores antigos (e o fallback de roteiros legados) leem o 1º prompt.
      imagem_prompt: imagens[0],
    };
  });

  return roteiro;
}

async function main() {
  const args = process.argv.slice(2);
  let titulo = '';
  let texto = '';
  let arquivoPath = '';
  let formato = '16:9';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--titulo' && args[i + 1]) {
      titulo = args[++i];
    } else if (args[i] === '--texto' && args[i + 1]) {
      texto = args[++i];
    } else if (args[i] === '--arquivo' && args[i + 1]) {
      arquivoPath = args[++i];
    } else if (args[i] === '--formato' && args[i + 1]) {
      formato = args[++i];
    }
  }

  if (arquivoPath) {
    texto = await readFile(arquivoPath, 'utf8');
  }

  if (!texto.trim()) {
    console.error('Uso: node gerar_roteiro_testemunho.mjs --titulo "..." (--texto "..." | --arquivo "...txt") [--formato 16:9|9:16]');
    process.exit(1);
  }

  const roteiro = await gerarRoteiroTestemunho({ titulo, texto, formato });
  const outDir = join(ROOT, 'output', 'testemunhos', roteiro.slug);
  await mkdir(outDir, { recursive: true });

  // Salva o texto original de apoio
  await writeFile(join(outDir, 'relato_original.txt'), texto, 'utf8');
  await writeFile(join(outDir, 'roteiro.json'), JSON.stringify(roteiro, null, 2), 'utf8');

  console.error(`[testemunho] Roteiro gerado com sucesso em ${join(outDir, 'roteiro.json')} (${roteiro.cenas.length} cenas)`);
  console.log(JSON.stringify(roteiro, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[erro] ${err.message}`);
    process.exit(1);
  });
}
