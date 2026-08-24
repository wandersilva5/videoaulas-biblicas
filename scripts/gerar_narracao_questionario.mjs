import { readFile, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { gerarNarracaoItem } from './gerar_narracao.mjs';
import { concatenarAudiosComGaps, TEXTO_INTRO_QUESTIONARIO, PREFIX_INTRO_QUESTIONARIO } from './util.mjs';

/** Normaliza o id do quiz: "Q1-PERGUNTA" / "q01-resposta" / "q1" -> "q1-pergunta" / "q01-resposta" / "q1". */
function normalizarIdQuiz(id) {
  return String(id ?? '')
    .toLowerCase()
    .replace(/^q0*(\d+)(-pergunta|-resposta)?$/, 'q$1$2');
}

const ORDINAL_PERGUNTA = ['', 'primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava', 'nona', 'décima'];

/** Sorteia um seed novo para o Qwen (pronúncia diferente a cada regeneração). */
function seedAleatorio() {
  return String(Math.floor(Math.random() * 1e9));
}

/**
 * Reescreve "Pergunta número N:" para "Primeira pergunta:" etc. — o clone de voz
 * pronuncia "número um" de forma estranha e o ordinal soa natural em pt-BR.
 */
function normalizarNarracaoPergunta(texto) {
  return String(texto ?? '').replace(/Pergunta\s+n[uú]mero\s+(\d+)\s*[:.]/gi, (_, n) => {
    const ord = ORDINAL_PERGUNTA[Number(n)];
    return ord ? `${ord[0].toUpperCase()}${ord.slice(1)} pergunta:` : `Pergunta ${n}:`;
  });
}

/**
 * Divide a narração da pergunta em segmentos (pergunta + cada opção + aviso de
 * tempo). Textos longos numa única passada fazem o clone de voz pular/embaralhar
 * as opções; gerar cada parte separada faz o áudio seguir exatamente o texto.
 */
function dividirPerguntaEmSegmentos(texto) {
  const t = String(texto ?? '');
  const segmentos = [];

  // Extrai o aviso de tempo ("Você tem 10 segundos para responder.")
  const avisoMatch = t.match(/Você tem \d+ segundos para responder\./i);
  const temAviso = avisoMatch ? avisoMatch[0] : null;

  // Remove o aviso para processar o restante
  const resto = temAviso ? t.replace(temAviso, '').trim() : t;

  // Separa "Pergunta número N: ..." das opções
  const partes = resto.split(/Opção [ABC]: /i);
  if (partes.length >= 2) {
    // Primeira parte é a pergunta (sem as opções)
    const pergunta = partes[0].trim();
    if (pergunta) segmentos.push(pergunta);

    // Restantes são opções
    for (let i = 1; i < partes.length; i++) {
      const opcao = partes[i].trim();
      if (opcao) segmentos.push(opcao);
    }
  } else {
    // Fallback: usa o texto todo como pergunta
    segmentos.push(resto);
  }

  // Adiciona o aviso no final, se existir
  if (temAviso) segmentos.push(temAviso);

  return segmentos;
}

/** Pausa (s) entre os segmentos da pergunta no áudio final. */
const GAP_SEGMENTO = 0.4;

async function gerarNarracaoPergunta(item, outDir, variar = false) {
  const outPath = join(outDir, `${item.prefix}-narracao.mp3`);
  const texto = normalizarNarracaoPergunta(item.texto);
  const segmentos = dividirPerguntaEmSegmentos(texto);
  if (segmentos.length <= 1) {
    return gerarNarracaoItem({ ...item, texto }, outDir);
  }
  console.error(`  [narração] ${item.titulo} em ${segmentos.length} segmentos ...`);
  const tmpPaths = [];
  for (let i = 0; i < segmentos.length; i++) {
    const segItem = {
      id: `${item.id}-seg${i + 1}`,
      titulo: `${item.titulo} (${i + 1}/${segmentos.length})`,
      texto: segmentos[i],
      prefix: `${item.prefix}-seg${i + 1}`,
    };
    if (variar) {
      process.env.QWEN_SEED = seedAleatorio();
      process.env.QWEN_SUB_SEED = seedAleatorio();
    }
    await gerarNarracaoItem(segItem, outDir);
    tmpPaths.push(join(outDir, `${segItem.prefix}-narracao.mp3`));
  }
  const gaps = segmentos.map(() => GAP_SEGMENTO);
  await concatenarAudiosComGaps(tmpPaths.map((p) => ({ id: p, path: p })), gaps, outPath);
  for (const p of tmpPaths) {
    try {
      await unlink(p);
    } catch {
      /* já removido */
    }
  }
  console.error(`  OK: ${outPath}`);
  return { id: item.id, titulo: item.titulo, path: outPath };
}

/**
 * Monta o texto da narração da pergunta a partir dos campos editáveis
 * (`pergunta` + `opcoes`) — NÃO usa `narracao_pergunta` do JSON, que é gerado
 * pelo LLM e fica congelado (editar as opções sem reescrever esse campo não
 * mudava o áudio). Assim áudio e tela ficam sempre consistentes.
 */
function montarNarracaoPergunta(p) {
  const opcoes = (p.opcoes || [])
    .map((o, i) => `Opção ${'ABC'[i]}: ${String(o).replace(/^[A-C]\)\s*/i, '')}`)
    .join('. ');
  const texto = `Pergunta número ${p.numero}: ${p.pergunta} ${opcoes}. Você tem 10 segundos para responder.`;
  return normalizarNarracaoPergunta(texto);
}

/**
 * Monta a narração da resposta a partir de `resposta_correta` + a opção correta.
 * Preserva a explicação do LLM (se existir) mas sempre com a letra certa de
 * acordo com `resposta_correta` (se você mudou a resposta, o áudio acompanha).
 */
function montarNarracaoResposta(p) {
  const letra = 'ABC'[p.resposta_correta] || 'A';
  const opcaoCorreta = String((p.opcoes || [])[p.resposta_correta] || '')
    .replace(/^[A-C]\)\s*/i, '');
  const explicacao = String(p.narracao_resposta || '')
    .replace(/^A resposta correta é a letra [A-C]\.?\s*/i, '')
    .trim();
  if (explicacao) return `A resposta correta é a letra ${letra}. ${explicacao}`;
  return `A resposta correta é a letra ${letra}. ${opcaoCorreta}`;
}

async function main() {
  const roteiroPath = process.argv[2];
  if (!roteiroPath) {
    console.error('Uso: node gerar_narracao_questionario.mjs <caminho/roteiro.json> [--apenas <id>] [--todos] [--variar]');
    console.error('  --apenas <id>  regenera só um item: intro, q1-pergunta, q1-resposta, q2 ... (independente de existir)');
    console.error('  --todos         regenera todos os áudios (ignora os já existentes)');
    console.error('  --variar        usa seed aleatório (pronúncia diferente a cada vez; útil quando uma pronúncia não ficou boa)');
    process.exit(1);
  }
  const apenasIdx = process.argv.indexOf('--apenas');
  const apenas = apenasIdx !== -1 ? process.argv[apenasIdx + 1] : null;
  const todos = process.argv.includes('--todos');
  const variar = process.argv.includes('--variar');

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

  const itens = [];
  itens.push({
    id: 'intro-questionario',
    titulo: 'Introdução do questionário',
    texto: TEXTO_INTRO_QUESTIONARIO,
    prefix: PREFIX_INTRO_QUESTIONARIO,
  });
  for (let i = 0; i < questionario.perguntas.length; i++) {
      const p = questionario.perguntas[i];
      const prefixBase = `q${String(i + 1).padStart(2, '0')}`;
      itens.push(
          {
              id: `${p.id}-pergunta`,
              titulo: `Pergunta ${i + 1}`,
              texto: montarNarracaoPergunta(p),
              prefix: `${prefixBase}-pergunta`,
              quiz: true,
          },
          {
              id: `${p.id}-resposta`,
              titulo: `Resposta ${i + 1}`,
              texto: montarNarracaoResposta(p),
              prefix: `${prefixBase}-resposta`,
          },
      );
  }

  let alvos = itens;
  if (apenas) {
    const alvo = normalizarIdQuiz(apenas);
    const ehIntro = alvo === 'intro' || alvo === 'intro-questionario';
    const temSufixo = /-(pergunta|resposta)$/.test(alvo);
    alvos = itens.filter((it) => {
      if (ehIntro) return it.id === 'intro-questionario';
      const n = normalizarIdQuiz(it.id);
      return temSufixo ? n === alvo : n.split('-')[0] === alvo;
    });
    if (alvos.length === 0) {
      console.error(`ERRO: item "${apenas}" não encontrado (use intro, q1-pergunta, q1-resposta ou q1)`);
      process.exit(1);
    }
  } else if (!todos) {
    alvos = itens.filter((it) => !existsSync(join(outDir, `${it.prefix}-narracao.mp3`)));
  }

  console.error(`[2/3] Gerando narração do questionário (${alvos.length} de ${itens.length} itens) ...`);

  const resultados = [];
  for (const item of alvos) {
    const outPath = join(outDir, `${item.prefix}-narracao.mp3`);
    if (!todos && !apenas && existsSync(outPath)) {
      console.error(`  [narração] ${item.titulo} já existe, pulando.`);
    } else if (item.quiz) {
      await gerarNarracaoPergunta(item, outDir, variar);
    } else {
      if (variar) {
        process.env.QWEN_SEED = seedAleatorio();
        process.env.QWEN_SUB_SEED = seedAleatorio();
      }
      await gerarNarracaoItem(item, outDir);
    }
    resultados.push(outPath);
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
