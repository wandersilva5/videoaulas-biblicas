/**
 * gerar_roteiro_short.mjs — Gera um roteiro promocional otimizado para YouTube Short
 * a partir do roteiro da aula completa. O foco é: hook → valor → CTA para o canal.
 *
 * Uso: node gerar_roteiro_short.mjs <caminho/roteiro.json> [--material <arquivo>]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extrairJson, modeloLLama, truncarMaterial, MATERIAL_MAX_CHARS } from './util.mjs';
import { normalizarReferenciasParaTts } from './gerar_narracao.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const LLAMA_URL = process.env.LLAMA_URL || 'http://127.0.0.1:8091';
const MODELO = modeloLLama();

const PROMPT_SYSTEM = `Você é um roteirista especialista em YouTube Shorts de teologia.
Seu objetivo: criar um roteiro de 50-58 segundos (vertical 9:16) que funcione como "isca" para a videoaula completa.

ESTRUTURA OBRIGATÓRIA (5 blocos, ~10-12s cada):
1. HOOK (0-3s): Pergunta intrigante, afirmação ousada ou mistério — para segurar o scroll
2. PROBLEMA/DOR (3-10s): Identifica a dúvida ou necessidade do espectador
3. PROMESSA DE VALOR (10-25s): "Neste estudo você vai descobrir..." — lista 3 benefícios concretos
4. AUTORIDADE/PROVA (25-40s): Cita 1 versículo-chave + 1 insight teológico profundo
5. CTA (40-55s): "Curso completo no canal Teologia Pra Todos — link na bio / descrição"

REGRAS:
- Português do Brasil, tom acolhedor mas autoridade teológica
- Linguagem simples, sem jargão acadêmico desnecessário
- Frases curtas, ritmo ágil para retenção
- Máximo 160 palavras total (≈55s em fala natural)
- NÃO inclua marcações de tempo, numeração de blocos ou rótulos no texto final
- O texto final DEVE ser a narração contínua pronta para TTS`;

const PROMPT_USER_TEMPLATE = (topico, slides, material) => `TÓPICO DA AULA COMPLETA: "${topico}"

SLIDES PRINCIPAIS (títulos + pontos-chave):
${slides.map((s, i) => `${i + 1}. ${s.titulo}: ${s.pontos.slice(0, 3).join('; ')}`).join('\n')}

MATERIAL DE APOIO (trecho):
${material ? truncarMaterial(material, 3000) : '(não fornecido)'}

---

Gere APENAS o texto da narração do Short (um parágrafo contínuo, 130-160 palavras), seguindo a estrutura:
Hook → Problema → Promessa (3 benefícios) → Autoridade (versículo + insight) → CTA para o canal "Teologia Pra Todos".

Não adicione comentários, explicações, formatação markdown nem rótulos dos blocos.`;

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function gerarRoteiroShort(topico, slides, material = '') {
  const prompt = PROMPT_USER_TEMPLATE(topico, slides, material);
  
  const payload = {
    model: MODELO,
    messages: [
      { role: 'system', content: PROMPT_SYSTEM },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: 300,
    stream: false,
  };

  const resp = await postJson(`${LLAMA_URL}/v1/chat/completions`, payload);
  const content = resp.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('LLM não retornou conteúdo');
  return content;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Uso: node gerar_roteiro_short.mjs <caminho/roteiro.json> [--material <arquivo>]');
    process.exit(1);
  }

  const roteiroPath = args[0];
  let materialPath = null;
  const matIdx = args.indexOf('--material');
  if (matIdx !== -1 && args[matIdx + 1]) materialPath = args[matIdx + 1];

  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);

  let material = '';
  if (materialPath) {
    material = (await readFile(materialPath, 'utf8')).trim();
  }

  console.error('[Short] Gerando roteiro promocional via LLM...');
  let narracaoShort = await gerarRoteiroShort(roteiro.titulo_aula, roteiro.slides, material);
  narracaoShort = normalizarReferenciasParaTts(narracaoShort);

  console.error(`  Narração gerada (${narracaoShort.length} chars): ${narracaoShort.slice(0, 80)}...`);

  // Salva o roteiro do short (formato simplificado compatível com o pipeline)
  const shortRoteiro = {
    slug: roteiro.slug,
    topico: roteiro.topico,
    titulo_aula: roteiro.titulo_aula,
    introducao: narracaoShort, // usa o mesmo texto para intro (o short é uma peça única)
    conclusao: '',
    slides: [],
    introducao_imagem_prompt: roteiro.introducao_imagem_prompt,
    conclusao_imagem_prompt: roteiro.conclusao_imagem_prompt,
    _short_narracao: narracaoShort, // marcação interna
  };

  const shortRoteiroPath = join(outDir, 'roteiro-short.json');
  await writeFile(shortRoteiroPath, JSON.stringify(shortRoteiro, null, 2), 'utf8');
  
  console.log(JSON.stringify({ roteiro_short_path: shortRoteiroPath, narracao: narracaoShort }));
}

if (process.argv[1]) {
  const scriptPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  const argPath = process.argv[1].replace(/\\/g, '/');
  if (scriptPath === argPath) {
    main().catch((e) => {
      console.error('ERRO:', e.message);
      if (e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
      process.exit(1);
    });
  }
}