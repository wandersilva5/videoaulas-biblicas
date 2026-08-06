/**
 * gerar_pdf.mjs — Gera um PDF de estudo a partir de um roteiro.json
 * usando o texto da narração. Documento auxiliar com:
 *   - capa inicial e capa final (tema navy/dourado)
 *   - destaques para títulos e subtítulos (slides, pontos-chave)
 *   - referências bíblicas em destaque (ex.: "1 Coríntios 12:4", "João 3:16")
 *   - lista de referências bíblicas ao final (quando existirem)
 *
 * Uso: node gerar_pdf.mjs <caminho/roteiro.json>
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { chromium } from 'playwright';
import { esc, modeloLLama } from './util.mjs';

// Os PDFs ficam centralizados em <projeto>/pdfs, fora de output/<slug>.
const PDFS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'pdfs');

const LLAMA_URL = process.env.LLAMA_URL || 'http://127.0.0.1:8091';

function postJson(url, body, { timeoutMs = 10 * 60 * 1000 } = {}) {
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

function extrairJson(content) {
  try {
    return JSON.parse(content.trim());
  } catch {
    const semFence = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const inicio = semFence.indexOf('{');
    const fim = semFence.lastIndexOf('}');
    if (inicio === -1 || fim === -1) throw new Error('Resposta não contém JSON válido');
    return JSON.parse(semFence.slice(inicio, fim + 1));
  }
}

/**
 * Gera conteúdo complementar por slide (notas + referências extras) via
 * llama-server, para o PDF preencher uma página inteira por tema.
 * Resultado fica em cache em output/<slug>/enriquecimento.json.
 */
function promptEnriquecimento(roteiro) {
  const slides = (roteiro.slides || [])
    .map(
      (s) =>
        `- ${s.id} | Tema: ${s.titulo} | Referência: ${s.referencia_biblica || ''} | Resumo narrado: ${s.narracao || ''}`,
    )
    .join('\n');
  return `Você é um professor de teologia bíblica. Vai produzir conteúdo complementar para um "material de estudo" em PDF, baseado numa videoaula.

Gere um JSON válido (sem markdown, sem texto extra) com esta estrutura exata:
{
  "introducao_extra": "1-2 parágrafos aprofundando a introdução",
  "slides": [
    {
      "id": "slide-01",
      "notas_complementares": "2-3 parágrafos (120-180 palavras) explicando o tema com profundidade didática e acessível",
      "referencias_extra": ["João 3:16", "Romanos 5:8"]
    }
  ],
  "conclusao_extra": "1-2 parágrafos aprofundando a conclusão",
  "material_extra": "1-2 parágrafos de reflexão final e aplicação prática para o aluno"
}

REGRAS:
- Português do Brasil, tom respeitoso, claro e edificante.
- O "id" de cada slide deve bater exatamente com os ids fornecidos abaixo.
- "referencias_extra": 3-6 referências bíblicas REAIS e coerentes com o tema do slide, no formato padrão "Livro capítulo:versículo" (ex.: "1 Coríntios 12:4"). NÃO escreva o texto do versículo (evita erro de citação). Inclua também a referência principal do slide quando existir.
- As notas devem completar o estudo: explicar termos técnicos, contexto e aplicação prática, sem inventar doutrinas.

ROTEIRO DA AULA:
Título: ${roteiro.titulo_aula}
Introdução: ${roteiro.introducao}
Slides:
${slides}
Conclusão: ${roteiro.conclusao}`;
}

async function gerarEnriquecimento(roteiro) {
  const resp = await postJson(`${LLAMA_URL}/v1/chat/completions`, {
    model: modeloLLama(),
    messages: [
      { role: 'system', content: 'Você gera conteúdo complementar teológico para material de estudo.' },
      { role: 'user', content: promptEnriquecimento(roteiro) },
    ],
    temperature: 0.7,
    max_tokens: 8192,
    stream: false,
  });
  if (resp.status !== 200) throw new Error(`llama-server erro ${resp.status}: ${resp.text.slice(0, 300)}`);
  const data = JSON.parse(resp.text);
  const content = data.choices?.[0]?.message?.content ?? '';
  const enr = extrairJson(content);
  if (!Array.isArray(enr.slides)) throw new Error('enriquecimento sem lista de slides');
  return enr;
}

async function carregarOuGerarEnriquecimento(roteiro, outDir, regenerar) {
  if (process.env.PULAR_ENRIQUECIMENTO === '1') return null;
  const slug = roteiro.slug;
  const cachePath = join(outDir, 'enriquecimento.json');
  if (!regenerar) {
    try {
      const c = JSON.parse(await readFile(cachePath, 'utf8'));
      if (c?.dados?.slides) {
        console.error(`  enriquecimento (cache): ${cachePath}`);
        return c.dados;
      }
    } catch {
      /* sem cache ainda */
    }
  }
  console.error('  gerando conteúdo complementar via llama-server ...');
  const enr = await gerarEnriquecimento(roteiro);
  await writeFile(cachePath, JSON.stringify({ slug, gerado_em: new Date().toISOString(), dados: enr }, null, 2), 'utf8');
  console.error(`  conteúdo complementar salvo em: ${cachePath}`);
  return enr;
}

function mesclarEnriquecimento(roteiro, enr) {
  if (enr.introducao_extra) roteiro.introducao_extra = enr.introducao_extra;
  if (enr.conclusao_extra) roteiro.conclusao_extra = enr.conclusao_extra;
  if (enr.material_extra) roteiro.material_extra = enr.material_extra;
  for (const s of roteiro.slides || []) {
    const e = enr.slides?.find((x) => x.id === s.id);
    if (!e) continue;
    if (e.notas_complementares) s._notas = e.notas_complementares;
    if (Array.isArray(e.referencias_extra)) s._refsExtra = e.referencias_extra.filter(Boolean);
  }
}

// Divide um texto livre em parágrafos (linhas em branco separam parágrafos).
const paragrafos = (t) =>
  String(t ?? '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean);

const dataAtual = () =>
  new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

const CSS = `
@page { size: A4; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #22303f; }
.page { width: 210mm; min-height: 297mm; position: relative; page-break-after: always; }
.page:last-child { page-break-after: auto; }

/* ---------- Capas ---------- */
.cover {
  background: radial-gradient(1100px 620px at 75% 8%, #16263f 0%, #0b1320 58%);
  color: #eef3f9;
  padding: 24mm 24mm 20mm;
  display: flex; flex-direction: column;
}
.cover-topo { display: flex; justify-content: space-between; align-items: center; }
.cover-topo .marca { color: #e0b45a; font-weight: 700; font-size: 10pt; letter-spacing: 2px; text-transform: uppercase; }
.cover-topo .rotulo { color: #9db1c8; font-size: 8pt; letter-spacing: 1.5px; text-transform: uppercase; border: 1px solid rgba(224,180,90,0.5); border-radius: 99px; padding: 2mm 6mm; }
.cover-meio { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; position: relative; }
.cover .halo {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 120mm; height: 120mm; border-radius: 50%;
  background: radial-gradient(circle, rgba(224,180,90,0.22) 0%, rgba(224,180,90,0.06) 55%, transparent 72%);
}
.cover .kicker { color: #e0b45a; letter-spacing: 5px; text-transform: uppercase; font-weight: 700; font-size: 11pt; margin-bottom: 9mm; }
.cover h1 { font-size: 30pt; line-height: 1.18; font-weight: 700; max-width: 160mm; text-shadow: 0 3px 18px rgba(0,0,0,0.4); }
.cover .divisor { display: flex; align-items: center; justify-content: center; margin: 8mm 0; }
.cover .divisor span { width: 46mm; height: 1px; background: linear-gradient(90deg, transparent, #e0b45a, transparent); }
.cover .subtitulo { font-size: 12.5pt; color: #c9d4e0; max-width: 150mm; line-height: 1.5; }
.cover-rodape { display: flex; justify-content: space-between; color: #6b7f99; font-size: 8.5pt; letter-spacing: 1px; text-transform: uppercase; }
.cover .graça { font-size: 11pt; color: #c9d4e0; max-width: 130mm; line-height: 1.6; margin-top: 8mm; }
.cover .marca-fim { margin-top: 12mm; color: #e0b45a; font-weight: 700; letter-spacing: 4px; text-transform: uppercase; font-size: 11pt; }

/* ---------- Páginas de conteúdo ---------- */
.conteudo { background: #ffffff; padding: 20mm 22mm 16mm; display: flex; flex-direction: column; }
.conteudo .topo { display: flex; justify-content: space-between; align-items: center; padding-bottom: 4mm; border-bottom: 2px solid #e0b45a; margin-bottom: 8mm; }
.conteudo .topo .marca { color: #0b1320; font-weight: 700; font-size: 10pt; letter-spacing: 1px; }
.conteudo .topo .aula { color: #6b7f99; font-size: 9pt; max-width: 110mm; text-align: right; }
.conteudo .kicker { color: #b8860b; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; font-size: 9.5pt; margin-bottom: 3mm; }
.conteudo h2 { color: #0b1320; font-size: 19pt; line-height: 1.2; margin-bottom: 5mm; padding-bottom: 2.5mm; border-bottom: 2px solid rgba(224,180,90,0.55); }
.pontos { margin: 0 0 6mm 5mm; list-style: none; }
.pontos li { font-size: 11.5pt; color: #22303f; margin-bottom: 2.2mm; padding-left: 7mm; position: relative; }
.pontos li::before { content: '\\25B8'; position: absolute; left: 0; color: #e0b45a; font-weight: 700; }
.narracao { font-size: 11.5pt; line-height: 1.65; color: #22303f; text-align: justify; }
.paragrafos p { font-size: 11.5pt; line-height: 1.65; color: #22303f; text-align: justify; margin-bottom: 3mm; }
.paragrafos p:last-child { margin-bottom: 0; }
.citacao { margin-top: 7mm; background: #faf4e2; border-left: 4px solid #e0b45a; border-radius: 2mm; padding: 4mm 6mm; break-inside: avoid; }
.citacao .rotulo { font-size: 8pt; text-transform: uppercase; letter-spacing: 1.5px; color: #a06d10; font-weight: 700; margin-bottom: 1.5mm; }
.citacao .texto { font-size: 13pt; font-weight: 600; color: #0b1320; }
.notas { margin-top: 7mm; background: #eef3f9; border-left: 4px solid #1e5f8a; border-radius: 2mm; padding: 4mm 6mm; break-inside: avoid; }
.notas .rotulo { font-size: 8pt; text-transform: uppercase; letter-spacing: 1.5px; color: #1e5f8a; font-weight: 700; margin-bottom: 1.5mm; }
.notas .texto { font-size: 11pt; line-height: 1.55; color: #22303f; }
.notas .texto p { margin-bottom: 2mm; }
.notas .texto p:last-child { margin-bottom: 0; }
.bloco-refs { margin-top: 7mm; background: #faf4e2; border-left: 4px solid #e0b45a; border-radius: 2mm; padding: 3mm 6mm 1mm; break-inside: avoid; }
.bloco-refs .rotulo { font-size: 8pt; text-transform: uppercase; letter-spacing: 1.5px; color: #a06d10; font-weight: 700; margin-bottom: 1mm; }
.bloco-refs .referencias { margin-top: 0; }
.bloco-refs .referencias li { font-size: 11pt; font-weight: 600; padding: 2.2mm 2mm; }
.rodape-pagina { margin-top: auto; display: flex; justify-content: space-between; color: #9db1c8; font-size: 8.5pt; border-top: 1px solid #e8e2d2; padding-top: 3mm; }

/* ---------- Referências ---------- */
.referencias { list-style: none; margin-top: 7mm; }
.referencias li { display: flex; align-items: baseline; gap: 5mm; font-size: 12.5pt; color: #0b1320; font-weight: 600; padding: 3.5mm 4mm; border-bottom: 1px solid #f0ead8; }
.referencias .n { color: #e0b45a; font-weight: 700; font-size: 9pt; flex: 0 0 auto; }
`;

function capaInicial(roteiro, dataStr) {
  const subtitulo = roteiro.topico && roteiro.topico !== roteiro.titulo_aula ? roteiro.topico : 'Um estudo bíblico para a sua jornada de fé';
  return `
  <section class="page cover">
    <header class="cover-topo">
      <span class="marca">✦ Teologia Pra Todos</span>
      <span class="rotulo">Material de Estudo</span>
    </header>
    <div class="cover-meio">
      <div class="halo"></div>
      <div class="kicker">Estudo Complementar</div>
      <h1>${esc(roteiro.titulo_aula)}</h1>
      <div class="divisor"><span></span></div>
      <p class="subtitulo">${esc(subtitulo)}</p>
    </div>
    <footer class="cover-rodape">
      <span>${esc(dataStr)}</span>
      <span>Teologia Bíblica</span>
    </footer>
  </section>`;
}

function capaFinal(roteiro) {
  return `
  <section class="page cover">
    <header class="cover-topo">
      <span class="marca">✦ Teologia Pra Todos</span>
      <span class="rotulo">Material de Estudo</span>
    </header>
    <div class="cover-meio">
      <div class="halo"></div>
      <div class="kicker">Conclusão</div>
      <h1>Obrigado por estudar</h1>
      <p class="subtitulo">${esc(roteiro.titulo_aula)}</p>
      <div class="divisor"><span></span></div>
      <p class="graça">Que este material tenha edificado a sua fé e aprofundado o seu conhecimento das Escrituras.</p>
      <div class="marca-fim">✦ Teologia Pra Todos</div>
    </div>
    <footer class="cover-rodape">
      <span>${esc(roteiro.slug ?? '')}</span>
      <span>Fim</span>
    </footer>
  </section>`;
}

function caixaReferencias(citacao, extras = []) {
  const itens = [];
  if (citacao) itens.push(citacao.trim());
  for (const e of extras) {
    const v = String(e ?? '').trim();
    if (v && !itens.includes(v)) itens.push(v);
  }
  if (!itens.length) return '';
  return `<div class="bloco-refs"><div class="rotulo">Referências bíblicas</div><ol class="referencias">${itens
    .map((r, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(r)}</li>`)
    .join('')}</ol></div>`;
}

function paginaConteudo({ kicker, titulo, pontos, narracao, citacao, notas, notasRotulo = 'Notas complementares', refsExtra = [], pagina, total, tituloAula }) {
  const pontosHtml = (pontos || []).map((p) => `<li>${esc(p)}</li>`).join('');
  const notasHtml = paragrafos(notas).length
    ? `<div class="notas"><div class="rotulo">${esc(notasRotulo)}</div><div class="texto">${paragrafos(notas)
        .map((p) => `<p>${esc(p)}</p>`)
        .join('')}</div></div>`
    : '';
  const refsHtml = caixaReferencias(citacao, refsExtra);
  return `
  <section class="page conteudo">
    <header class="topo">
      <span class="marca">✦ Teologia Pra Todos</span>
      <span class="aula">${esc(tituloAula)}</span>
    </header>
    <div class="kicker">${esc(kicker)}</div>
    <h2>${esc(titulo)}</h2>
    ${pontosHtml ? `<ul class="pontos">${pontosHtml}</ul>` : ''}
    <p class="narracao">${esc(narracao)}</p>
    ${notasHtml}
    ${refsHtml}
    <footer class="rodape-pagina">
      <span>Página ${pagina} de ${total}</span>
      <span>Material de Estudo · Teologia Pra Todos</span>
    </footer>
  </section>`;
}

function paginaReferencias(refs, pagina, total, tituloAula) {
  const itens = refs.map((r, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(r)}</li>`).join('');
  return `
  <section class="page conteudo">
    <header class="topo">
      <span class="marca">✦ Teologia Pra Todos</span>
      <span class="aula">${esc(tituloAula)}</span>
    </header>
    <div class="kicker">Apêndice</div>
    <h2>Referências Bíblicas</h2>
    <p class="narracao">Versículos citados ao longo da aula, na ordem em que aparecem.</p>
    <ol class="referencias">${itens}</ol>
    <footer class="rodape-pagina">
      <span>Página ${pagina} de ${total}</span>
      <span>Material de Estudo · Teologia Pra Todos</span>
    </footer>
  </section>`;
}

function paginaMaterialExtra(texto, pagina, total, tituloAula) {
  const paragrafosHtml = paragrafos(texto)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
  return `
  <section class="page conteudo">
    <header class="topo">
      <span class="marca">✦ Teologia Pra Todos</span>
      <span class="aula">${esc(tituloAula)}</span>
    </header>
    <div class="kicker">Apêndice</div>
    <h2>Material Complementar</h2>
    <div class="paragrafos">${paragrafosHtml}</div>
    <footer class="rodape-pagina">
      <span>Página ${pagina} de ${total}</span>
      <span>Material de Estudo · Teologia Pra Todos</span>
    </footer>
  </section>`;
}

export function montarHtml(roteiro, { totalPaginas } = {}) {
  const slides = roteiro.slides || [];
  const tituloAula = roteiro.titulo_aula || '';
  const referencias = [
    ...new Set(
      slides
        .flatMap((s) => [(s.referencia_biblica || '').trim(), ...(s._refsExtra || []).map((r) => String(r).trim())])
        .filter(Boolean),
    ),
  ];
  const temRefs = referencias.length > 0;
  const temMaterial = paragrafos(roteiro.material_extra).length > 0;

  // Estimativa usada na 1ª renderização; o valor real é corrigido pelo
  // gerarPdf() após contar as páginas (notas podem quebrar a página do slide).
  const estimativa = 2 + 1 + slides.length + 1 + (temMaterial ? 1 : 0) + (temRefs ? 1 : 0) + 1;
  const total = totalPaginas ?? estimativa;
  let pagina = 1;

  const partes = [];
  partes.push(capaInicial(roteiro, dataAtual()));
  pagina += 1;

  partes.push(
    paginaConteudo({
      kicker: 'Introdução',
      titulo: 'Introdução',
      narracao: roteiro.introducao || '',
      notas: roteiro.introducao_extra || '',
      notasRotulo: 'Compreendendo melhor',
      pagina,
      total,
      tituloAula,
    }),
  );
  pagina += 1;

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    partes.push(
      paginaConteudo({
        kicker: `Slide ${String(i + 1).padStart(2, '0')}`,
        titulo: s.titulo,
        pontos: s.pontos || [],
        narracao: s.narracao || '',
        citacao: (s.referencia_biblica || '').trim() || null,
        notas: s._notas || '',
        notasRotulo: 'Compreendendo melhor',
        refsExtra: s._refsExtra || [],
        pagina,
        total,
        tituloAula,
      }),
    );
    pagina += 1;
  }

  partes.push(
    paginaConteudo({
      kicker: 'Conclusão',
      titulo: 'Conclusão',
      narracao: roteiro.conclusao || '',
      notas: roteiro.conclusao_extra || '',
      notasRotulo: 'Compreendendo melhor',
      pagina,
      total,
      tituloAula,
    }),
  );
  pagina += 1;

  if (temMaterial) {
    partes.push(paginaMaterialExtra(roteiro.material_extra, pagina, total, tituloAula));
    pagina += 1;
  }

  if (temRefs) {
    partes.push(paginaReferencias(referencias, pagina, total, tituloAula));
    pagina += 1;
  }

  partes.push(capaFinal(roteiro));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${esc(tituloAula)} · Material de Estudo</title>
<style>${CSS}</style>
</head>
<body>
${partes.join('\n')}
</body>
</html>`;
}

function contarPaginas(buffer) {
  const str = buffer.toString('latin1');
  const n = (str.match(/\/Type\s*\/Page\b/g) || []).length;
  return Math.max(1, n);
}

async function renderizar(page, html) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluateHandle(() => document.fonts.ready);
  return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
}

export async function gerarPdf(roteiroPath, { regenerarEnriquecimento = false } = {}) {
  const roteiro = JSON.parse(await readFile(roteiroPath, 'utf8'));
  const outDir = dirname(roteiroPath);
  const slug = roteiro.slug || basename(outDir);
  const pdfPath = join(PDFS_DIR, `${slug}-estudo.pdf`);
  await mkdir(PDFS_DIR, { recursive: true });

  // Conteúdo complementar (notas + referências extras) via llama-server, com
  // cache em output/<slug>/. Se falhar, o PDF é gerado mesmo assim com o conteúdo atual.
  try {
    const enr = await carregarOuGerarEnriquecimento(roteiro, outDir, regenerarEnriquecimento);
    if (enr) mesclarEnriquecimento(roteiro, enr);
  } catch (e) {
    console.error(`  aviso: não foi possível gerar o conteúdo complementar (${e.message}); gerando PDF com o conteúdo atual.`);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // 1ª passagem: descobre o número real de páginas (notas complementares
    // podem fazer um slide ocupar mais de uma página A4).
    const rascunho = await renderizar(page, montarHtml(roteiro));
    const totalPaginas = contarPaginas(rascunho);
    // 2ª passagem: regenera com a numeração "Página X de Y" correta.
    const html = montarHtml(roteiro, { totalPaginas });
    const buffer = await renderizar(page, html);
    await writeFile(pdfPath, buffer);
  } finally {
    await browser.close();
  }
  return { output_path: pdfPath, arquivo: basename(pdfPath), slug };
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_pdf.mjs <caminho/roteiro.json> [--regenerar-enriquecimento]');
    console.error('  --sem-enriquecimento       gera o PDF sem o conteúdo complementar');
    console.error('  --regenerar-enriquecimento ignora o cache e gera o conteúdo complementar de novo');
    process.exit(1);
  }
  const semEnriquecimento = process.argv.includes('--sem-enriquecimento');
  const regenerar = process.argv.includes('--regenerar-enriquecimento');
  if (semEnriquecimento) process.env.PULAR_ENRIQUECIMENTO = '1';
  console.error('[5/5] Gerando PDF de estudo ...');
  const result = await gerarPdf(roteiroPath, { regenerarEnriquecimento: regenerar });
  console.error(`PDF concluído: ${result.output_path}`);
  console.log(JSON.stringify(result));
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
