const $ = (sel) => document.querySelector(sel);

const ETAPAS = [
  { n: 1, rotulo: 'Roteiro' },
  { n: 2, rotulo: 'Imagens' },
  { n: 3, rotulo: 'Narração' },
  { n: 4, rotulo: 'Vídeo' },
  { n: 5, rotulo: 'Roteiro Short' },
  { n: 6, rotulo: 'Short' },
  { n: 7, rotulo: 'PDF' },
  { n: 8, rotulo: 'Questionário' },
];

const estado = {
  tela: 'dashboard',
  slug: null,
  roteiro: null,
  artefatos: null,
  config: null,
  servicos: null,
  etapa: 1,
  jobAtivo: false,
  job: null,
  modalIndice: null,
  logs: [],
};

const NOME_ETAPA = { roteiro: 'Roteiro', imagens: 'Imagens', narracao: 'Narração', video: 'Vídeo', 'roteiro-short': 'Roteiro Short', short: 'Short', pdf: 'PDF', questionario: 'Questionário' };

// Cópia browser-safe de esc/slugDe (util.mjs não pode ser importado no navegador:
// depende de node:crypto). Mantidas em sincronia com scripts/util.mjs.
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function slugDe(topico) {
  return topico
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// URL de imagem com cache-busting: inclui o mtime do arquivo, então ao regenerar
// uma imagem o navegador busca a versão nova em vez de exibir a em cache.
function urlImagem(arquivo, mtime) {
  const v = mtime != null && mtime !== false ? mtime : Date.now();
  return `/media/${estado.slug}/${arquivo}?v=${v}`;
}

function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('erro', erro);
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 4000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) throw new Error(data?.erro || `Erro HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Log (SSE e Histórico)
// ---------------------------------------------------------------------------
function formatarLinhaLog(msg) {
  const hora = new Date(msg.ts || Date.now()).toLocaleTimeString('pt-BR');
  const div = document.createElement('div');
  div.className = `log-linha ${msg.tipo || 'log'}`;
  div.innerHTML = `<span class="hora">${hora}</span>${esc(msg.linha || msg.tipo)}`;
  return div;
}

// Retém apenas as LOGS_EXECUCOES_RETIDAS últimas execuções (job) para o
// histórico não crescer sem limite — mesma regra do servidor (servidor.mjs).
const LOGS_EXECUCOES_RETIDAS = 3;

function podarLogsPorExecucao() {
  const vistos = [];
  for (const m of estado.logs) {
    if (m.jobId != null && !vistos.includes(m.jobId)) vistos.push(m.jobId);
  }
  if (vistos.length <= LOGS_EXECUCOES_RETIDAS) return;
  const descartar = vistos.slice(0, vistos.length - LOGS_EXECUCOES_RETIDAS);
  estado.logs = estado.logs.filter((m) => m.jobId == null || !descartar.includes(m.jobId));
}

function adicionarLog(msg) {
  estado.logs.push(msg);
  podarLogsPorExecucao();

  if (msg.tipo === 'erro') {
    const btnLogs = $('#btn-logs');
    if (btnLogs) btnLogs.classList.add('tem-erro');
  }

  // Painel inline (na tela da aula)
  const el = $('#log-linhas');
  if (el && el.classList.contains('aberto')) {
    el.appendChild(formatarLinhaLog(msg));
    el.scrollTop = el.scrollHeight;
  }

  // Modal global de logs
  const elModal = $('#log-linhas-modal');
  if (elModal && !$('#modal-logs').hidden) {
    elModal.appendChild(formatarLinhaLog(msg));
    elModal.scrollTop = elModal.scrollHeight;
  }
}

function renderizarTodosLogs(containerId) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = '';
  for (const m of estado.logs) {
    el.appendChild(formatarLinhaLog(m));
  }
  el.scrollTop = el.scrollHeight;
}

function copiarLogsTexto() {
  if (!estado.logs.length) return toast('Nenhum log para copiar.', true);
  const texto = estado.logs
    .map((m) => `[${new Date(m.ts || Date.now()).toLocaleTimeString('pt-BR')}] [${m.tipo || 'log'}] ${m.linha || m.tipo}`)
    .join('\n');
  navigator.clipboard.writeText(texto)
    .then(() => toast('Logs copiados para a área de transferência!'))
    .catch(() => toast('Não foi possível copiar os logs.', true));
}

function abrirModalLogs() {
  renderizarTodosLogs('#log-linhas-modal');
  $('#modal-logs').hidden = false;
}

function fecharModalLogs() {
  $('#modal-logs').hidden = true;
}

function abrirPainelLogsInline() {
  const el = $('#log-linhas');
  if (!el) return;
  el.classList.add('aberto');
  $('#btn-toggle-log').textContent = '▴ Log das etapas';
  renderizarTodosLogs('#log-linhas');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Serviços (health check)
// ---------------------------------------------------------------------------
async function carregarServicos(force = false) {
  try {
    const dados = await api('/api/health');
    estado.servicos = dados;
    renderServicosBadge();
    renderListaServicos();
    return dados;
  } catch (e) {
    estado.servicos = { ok: false, servicos: null };
    renderServicosBadge();
    return estado.servicos;
  }
}

function servicoOk(nome) {
  return estado.servicos?.servicos?.[nome]?.ok === true;
}

function renderServicosBadge() {
  const btn = $('#btn-servicos');
  const s = estado.servicos;
  btn.classList.toggle('ok', s?.ok === true);
  btn.classList.toggle('erro', s?.ok === false);
  btn.classList.toggle('carregando', !s);
  btn.title = s
    ? (s.ok ? 'Todos os serviços disponíveis' : 'Alguns serviços indisponíveis — clique para ver')
    : 'Verificando serviços…';
}

function renderListaServicos() {
  const el = $('#lista-servicos');
  if (!el) return;
  const s = estado.servicos;
  if (!s?.servicos) {
    el.innerHTML = '<div class="servico-item carregando"><span class="servico-status">…</span><span class="servico-nome">Verificando…</span></div>';
    return;
  }
  const ordens = ['llama', 'comfy', 'qwen', 'ffmpeg', 'ffprobe', 'chromium'];
  el.innerHTML = ordens
    .map((k) => {
      const v = s.servicos[k];
      if (!v) return '';
      const status = v.ok ? '✓' : '✕';
      const detalhe = v.ok ? (v.versao || 'ok') : (v.erro || 'indisponível');
      return `<div class="servico-item ${v.ok ? 'ok' : 'erro'}">
        <span class="servico-status">${status}</span>
        <div class="servico-info">
          <span class="servico-nome">${esc(v.rotulo || k)}</span>
          <span class="servico-detalhe">${esc(detalhe)}</span>
        </div>
      </div>`;
    })
    .join('')
    + `<p class="servico-resumo">${s.ok ? 'Tudo pronto para rodar o pipeline.' : 'Alguns pré-requisitos estão indisponíveis.'}</p>`;
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------
function mostrarTela(nome) {
  estado.tela = nome;
  $('#tela-dashboard').classList.toggle('ativa', nome === 'dashboard');
  $('#tela-aula').classList.toggle('ativa', nome === 'aula');
  if (nome === 'dashboard') carregarAulas();
}

async function abrirAula(slug) {
  estado.slug = slug;
  estado.etapa = 1;
  await Promise.all([carregarRoteiro(), carregarArtefatos()]);
  $('#titulo-aula').textContent = estado.roteiro.titulo_aula;
  mostrarTela('aula');
  renderStepper();
  mudarEtapa(1);
}

async function carregarRoteiro() {
  estado.roteiro = await api(`/api/roteiro/${estado.slug}`);
}

async function carregarArtefatos() {
  estado.artefatos = await api(`/api/artefatos/${estado.slug}`);
  renderStepper();
}

// ---------------------------------------------------------------------------
// Stepper + dica
// ---------------------------------------------------------------------------
function statusEtapa(n) {
  const st = estado.artefatos;
  if (!st) return 'erro';
  if (n === 1) return 'ok';
  if (n === 2) {
    const temAlguma = [st.intro, ...st.slides, st.conclusao].some((x) => x?.imagem?.existe);
    return st.imagensCompletas ? 'ok' : temAlguma ? 'alerta' : 'erro';
  }
  if (n === 3) return st.audioCompleto ? 'ok' : 'alerta';
  if (n === 4) return st.video.existe ? 'ok' : 'erro';
  if (n === 5) {
    const shortRoteiro = st.roteiro_short?.existe;
    return shortRoteiro ? 'ok' : 'erro';
  }
  if (n === 6) return st.short?.existe ? 'ok' : 'erro';
  if (n === 7) return st.pdf?.existe ? 'ok' : 'erro';
  return st.questionario?.existe ? 'ok' : 'erro';
}

function renderStepper() {
  const el = $('#stepper');
  el.innerHTML = '';
  const st = estado.artefatos;
  for (const e of ETAPAS) {
    const s = statusEtapa(e.n);
    const btn = document.createElement('button');
    btn.className = `passo ${estado.etapa === e.n ? 'ativo' : ''}`;
    const icone = s === 'ok' ? '✓' : s === 'alerta' ? '!' : '○';
    btn.innerHTML = `<span class="num">${e.n}</span><span class="rotulo">${e.rotulo}</span><span class="status-dot ${s}">${icone}</span>`;
    btn.onclick = () => mudarEtapa(e.n);
    el.appendChild(btn);
  }
  // dica do próximo passo
  const dica = $('#dica-proximo');
  if (!st) { dica.textContent = ''; return; }
  if (!st.imagensCompletas) dica.textContent = 'Próximo: gerar imagens dos slides';
  else if (!st.audioCompleto) dica.textContent = 'Próximo: gerar narrações';
  else if (!st.video.existe) dica.textContent = 'Próximo: montar o vídeo';
  else dica.textContent = 'Tudo pronto — revise ou ajuste à vontade';
}

function mudarEtapa(n) {
  estado.etapa = n;
  renderStepper();
  const container = $('#etapa-container');
  if (n === 1) renderEtapa1(container);
  else if (n === 2) renderEtapa2(container);
  else if (n === 3) renderEtapa3(container);
  else if (n === 4) renderEtapa4(container);
  else if (n === 5) renderEtapa5(container);
  else if (n === 6) renderEtapa6(container);
  else if (n === 7) renderEtapa7(container);
  else renderEtapa8(container);
  sincronizarBotoes();
  renderStatusJob();
}

let _jobClearT = null;

function tempoDesde(msIni) {
  const s = Math.max(0, Math.floor((Date.now() - msIni) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function renderStatusJob() {
  const el = $('#status-job');
  const job = estado.job;
  if (!job) {
    el.hidden = true;
    atualizarIndicadorTopo(false);
    return;
  }
  el.hidden = false;
  el.className = `status-job ${job.status}`;
  const rotulo = NOME_ETAPA[job.etapa] || job.etapa;
  const icone =
    job.status === 'ok' ? '✓' :
    job.status === 'erro' ? '✕' : '🔄';
  const statusTexto = job.status === 'ok' ? `${rotulo} concluída com sucesso` :
    job.status === 'erro' ? `${rotulo} falhou` : `${rotulo} em andamento`;
  const botaoAcao =
    job.status === 'rodando'
      ? `<button class="btn btn-ghost btn-mini status-cancelar" id="btn-cancelar-job" title="Cancelar este job">✕ Cancelar</button>`
      : job.status === 'erro'
      ? `<button class="btn btn-ghost btn-mini status-ver-log" id="btn-status-ver-log" title="Ver detalhes do erro no log">📋 Ver Log</button>`
      : '';
  el.innerHTML = `
    <span class="status-icone">${icone}</span>
    <div class="status-texto">
      <strong>${statusTexto}</strong>
      <span>${esc(job.msg || '')}</span>
      ${job.status === 'rodando' && job.iniciadoEm ? `<span class="status-desde">em andamento há ${tempoDesde(job.iniciadoEm)}</span>` : ''}
      ${job.pct != null ? `<div class="barra-progresso status-barra"><div style="width:${Math.max(0, Math.min(100, job.pct))}%"></div></div>` : ''}
    </div>
    ${botaoAcao}`;
  atualizarIndicadorTopo(job.status === 'rodando');
}

// Clique no banner de status (cancelar ou abrir log)
document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'btn-status-ver-log') {
    if (estado.tela === 'aula') {
      abrirPainelLogsInline();
    } else {
      abrirModalLogs();
    }
  }
});

function atualizarIndicadorTopo(ativo) {
  const el = $('#job-topo');
  if (!el) return;
  el.hidden = !ativo;
  if (ativo) {
    const rotulo = NOME_ETAPA[estado.job?.etapa] || estado.job?.etapa || 'job';
    el.textContent = `🔄 ${rotulo} em andamento`;
  }
}

// Sondagem do estado do job no servidor: cobre o caso de a página ser recarregada
// (o SSE não "reapresenta" um job já em andamento) ou de o SSE cair no meio.
let _ultimoJobIdVisto = null;

async function verJobServidor() {
  let d;
  try {
    d = await api('/api/job');
  } catch {
    return;
  }
  if (d.ativo) {
    estado.jobAtivo = true;
    sincronizarBotoes();
    if (!estado.job || estado.job.jobId !== d.jobId || estado.job.status !== 'rodando') {
      estado.job = { jobId: d.jobId, etapa: d.etapa, status: 'rodando', msg: 'Em andamento…', iniciadoEm: d.iniciadoEm };
      renderStatusJob();
    } else {
      atualizarIndicadorTopo(true);
    }
    return;
  }

  // Nenhum job ativo no servidor
  atualizarIndicadorTopo(false);
  if (estado.job?.status === 'rodando') {
    // Job terminou sem o SSE estar conectado: mostra o último resultado
    const ult = d.ultimo;
    estado.jobAtivo = false;
    sincronizarBotoes();
    estado.job = {
      etapa: ult?.etapa || estado.job.etapa,
      status: ult ? (ult.ok ? 'ok' : 'erro') : 'erro',
      msg: ult ? (ult.ok ? 'Processo finalizado com sucesso.' : ult.cancelado ? 'Job cancelado pelo usuário.' : 'Falha na execução — veja o log.') : 'Execução encerrada.',
    };
    renderStatusJob();
    clearTimeout(_jobClearT);
    _jobClearT = setTimeout(() => {
      estado.job = null;
      renderStatusJob();
    }, 8000);
    if (estado.tela === 'aula') {
      carregarArtefatos();
      mudarEtapa(estado.etapa);
    }
  } else if (!estado.job && d.ultimo && d.ultimo.jobId !== _ultimoJobIdVisto) {
    // Página recarregada depois do fim: mostra o último resultado brevemente
    _ultimoJobIdVisto = d.ultimo.jobId;
    const ult = d.ultimo;
    estado.job = {
      etapa: ult.etapa,
      status: ult.ok ? 'ok' : 'erro',
      msg: ult.ok ? 'Processo finalizado com sucesso.' : ult.cancelado ? 'Job cancelado pelo usuário.' : 'Falha na execução — veja o log.',
    };
    renderStatusJob();
    clearTimeout(_jobClearT);
    _jobClearT = setTimeout(() => {
      estado.job = null;
      renderStatusJob();
    }, 8000);
    if (estado.tela === 'aula') {
      carregarArtefatos();
      mudarEtapa(estado.etapa);
    }
  }
}

async function cancelarJob() {
  try {
    await api('/api/cancelar-job', { method: 'POST' });
    toast('Cancelando job em execução...');
  } catch (e) {
    toast(e.message, true);
  }
}

$('#status-job').addEventListener('click', (ev) => {
  if (ev.target.closest('#btn-cancelar-job')) cancelarJob();
});

function sincronizarBotoes() {
  document.querySelectorAll('#etapa-container .btn').forEach((b) => (b.disabled = estado.jobAtivo));
}

// ---------------------------------------------------------------------------
// Etapa 1 — Roteiro
// ---------------------------------------------------------------------------
function renderEtapa1(el) {
  const r = estado.roteiro;
  const cards = r.slides
    .map(
      (s, i) => `
    <div class="slide-card" draggable="true" data-dragidx="${i}">
      <div class="cabeca">
        <span class="alça" title="Arrastar para reordenar">⠿</span>
        <span class="num-slide">SLIDE ${String(i + 1).padStart(2, '0')}</span>
        <input data-slide="${i}" data-field="titulo" value="${esc(s.titulo)}" placeholder="Título (máx 8 palavras)" />
        <button class="lixeira" data-action="del-slide" data-slide="${i}" title="Remover slide">✕</button>
      </div>
      <div class="pontos-editor">
        ${s.pontos.map((p, j) => `
          <div class="ponto-linha">
            <span>▸</span>
            <input data-slide="${i}" data-ponto="${j}" value="${esc(p)}" placeholder="Ponto-chave" />
            <button data-action="del-ponto" data-slide="${i}" data-ponto="${j}" title="Remover ponto">✕</button>
          </div>`).join('')}
      </div>
      <button class="btn-adicionar-ponto" data-action="add-ponto" data-slide="${i}">+ ponto</button>
      <div class="campo-texto" style="margin-top:12px">
        <label>Narração <span class="contador" data-contador="${i}"></span></label>
        <textarea data-slide="${i}" data-field="narracao">${esc(s.narracao)}</textarea>
      </div>
      <div class="campo-texto">
        <label>Referência bíblica</label>
        <input data-slide="${i}" data-field="referencia_biblica" value="${esc(s.referencia_biblica || '')}" placeholder="Livro capítulo:versículo (ex.: João 3:16)" />
      </div>
      <div class="campo-texto">
        <label>Prompt da imagem (EN)</label>
        <input data-slide="${i}" data-field="imagem_prompt" value="${esc(s.imagem_prompt)}" />
      </div>
    </div>`,
    )
    .join('');

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Roteiro</h3>
      <div class="etapa-acoes">
        <button class="btn btn-perigo" data-action="regenerar-roteiro">↺ Regenerar roteiro</button>
        <button class="btn btn-primario" data-action="salvar-roteiro">💾 Salvar alterações</button>
      </div>
    </div>
    <div class="cartao campo-texto">
      <label>Título da aula</label>
      <input data-field="titulo_aula" value="${esc(r.titulo_aula)}" placeholder="Título da videoaula" />
    </div>
    <div class="cartao campo-texto">
      <label>Introdução (narrada)</label>
      <textarea data-field="introducao" rows="3">${esc(r.introducao)}</textarea>
    </div>
    <div class="cartao campo-texto">
      <label>Introdução — prompt da imagem de capa (EN)</label>
      <textarea data-field="introducao_imagem_prompt" rows="2">${esc(r.introducao_imagem_prompt || '')}</textarea>
    </div>
    <div class="cartao campo-texto">
      <label>Conclusão (narrada)</label>
      <textarea data-field="conclusao" rows="3">${esc(r.conclusao)}</textarea>
    </div>
    <div class="cartao campo-texto">
      <label>Conclusão — prompt da imagem de capa (EN)</label>
      <textarea data-field="conclusao_imagem_prompt" rows="2">${esc(r.conclusao_imagem_prompt || '')}</textarea>
    </div>
    <div class="etapa-topo" style="margin-bottom:10px">
      <h3 style="font-size:16px">Slides</h3>
      <button class="btn" data-action="add-slide">+ novo slide</button>
    </div>
    <div id="lista-slides">${cards}</div>`;

  atualizarContadores();
  el.querySelectorAll('.slide-card').forEach((card) => {
    card.addEventListener('dragstart', () => card.classList.add('dragging'));
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (ev) => ev.preventDefault());
    card.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const from = Number(card.dataset.dragidx);
      const to = Number(el.querySelector('.slide-card.dragging')?.dataset.dragidx ?? from);
      if (from !== to) {
        const [item] = estado.roteiro.slides.splice(from, 1);
        estado.roteiro.slides.splice(to, 0, item);
        renumerarSlides();
        renderEtapa1(el);
      }
    });
  });
}

function renumerarSlides() {
  estado.roteiro.slides.forEach((s, i) => {
    s.id = `slide-${String(i + 1).padStart(2, '0')}`;
  });
  // Atualizar manifesto será feito no salvamento (PUT /api/roteiro)
}

function lerRoteiroDoDOM() {
  const r = estado.roteiro;
  r.titulo_aula = $('[data-field="titulo_aula"]')?.value ?? r.titulo_aula;
  r.introducao = $('[data-field="introducao"]')?.value ?? r.introducao;
  r.introducao_imagem_prompt = $('[data-field="introducao_imagem_prompt"]')?.value ?? r.introducao_imagem_prompt;
  r.conclusao = $('[data-field="conclusao"]')?.value ?? r.conclusao;
  r.conclusao_imagem_prompt = $('[data-field="conclusao_imagem_prompt"]')?.value ?? r.conclusao_imagem_prompt;
  r.slides.forEach((s, i) => {
    s.titulo = $(`[data-slide="${i}"][data-field="titulo"]`)?.value ?? s.titulo;
    s.narracao = $(`[data-slide="${i}"][data-field="narracao"]`)?.value ?? s.narracao;
    s.referencia_biblica = $(`[data-slide="${i}"][data-field="referencia_biblica"]`)?.value ?? (s.referencia_biblica || '');
    s.imagem_prompt = $(`[data-slide="${i}"][data-field="imagem_prompt"]`)?.value ?? s.imagem_prompt;
    s.pontos = Array.from(document.querySelectorAll(`[data-slide="${i}"][data-ponto]`))
      .map((inp) => inp.value)
      .filter((v) => v.trim() !== '');
  });
}

function contarPalavras(texto) {
  return (texto.trim().match(/\S+/g) || []).length;
}

function atualizarContadores() {
  estado.roteiro.slides.forEach((s, i) => {
    const badge = $(`[data-contador="${i}"]`);
    if (!badge) return;
    const n = contarPalavras(s.narracao);
    badge.textContent = `${n} palavras`;
    badge.className = `contador ${n >= 60 && n <= 90 ? 'dentro' : 'fora'}`;
  });
}

// ---------------------------------------------------------------------------
// Etapa 2 — Imagens
// ---------------------------------------------------------------------------
function itensImagem() {
  const st = estado.artefatos;
  if (!st) return [];
  const pad = (n) => String(n).padStart(2, '0');
  const imgDe = (x) => ({ existe: !!x?.existe, mtime: x?.mtime ?? null, desatualizado: !!x?.desatualizado });
  return [
    { id: 'intro', titulo: 'Introdução', arquivo: 'slide-00.png', imagem: imgDe(st.intro?.imagem) },
    ...st.slides.map((s) => ({ id: s.id, titulo: s.titulo, arquivo: `slide-${pad(s.idx)}.png`, imagem: imgDe(s.imagem) })),
    { id: 'conclusao', titulo: 'Conclusão', arquivo: `slide-${pad(st.slides.length + 1)}.png`, imagem: imgDe(st.conclusao?.imagem) },
  ];
}

function renderEtapa2(el) {
  const itens = itensImagem();
  const cards = itens
    .map((s, i) => {
      const img = s.imagem.existe
        ? `<img src="${urlImagem(s.arquivo, s.imagem.mtime)}" loading="lazy" />`
        : '';
      const regen = s.imagem.existe
        ? `<button class="regen" data-action="regen-imagem" data-slide="${s.id}" title="Regenerar imagem (novo seed)">↻</button>`
        : '';
      const badge = s.imagem.existe
        ? (s.imagem.desatualizado ? '<span class="badge alerta">prompt alterado</span>' : '<span class="badge ok">ok</span>')
        : '<span class="badge erro">pendente</span>';
      return `<div class="img-card ${s.imagem.existe ? '' : 'faltando'}" data-idx="${i}">${img}${regen}
        <div class="img-info"><span>${esc(s.titulo)}</span>${badge}</div></div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Imagens</h3>
      <div class="etapa-acoes">
        <button class="btn btn-perigo" data-action="gerar-todas-imagens-recriar" title="Apaga as atuais e gera todas de novo (capas + slides)">↺ Recriar todas</button>
        <button class="btn btn-primario" data-action="gerar-todas-imagens">Gerar as que faltam</button>
      </div>
    </div>
    <p class="msg-progresso">Capas de abertura/encerramento + slides. Geração via ComfyUI local (≈30s por imagem). "↻" regenera uma imagem com seed aleatório.</p>
    <div class="grid-imagens">${cards}</div>`;
}

// ---------------------------------------------------------------------------
// Etapa 3 — Narração
// ---------------------------------------------------------------------------
function renderEtapa3(el) {
  const st = estado.artefatos;
  const itens = [
    { id: 'intro', rotulo: 'Introdução', prefix: '00-intro', audio: st.intro },
    ...st.slides.map((s) => ({ id: s.id, rotulo: s.titulo, prefix: String(s.idx).padStart(2, '0'), audio: s.audio })),
    { id: 'conclusao', rotulo: 'Conclusão', prefix: st.slides.length ? `${String(st.slides.length + 1).padStart(2, '0')}-conclusao` : '01-conclusao', audio: st.conclusao },
  ];
  const lista = itens
    .map((it) => {
      const badge = it.audio.existe
        ? (it.audio.desatualizado ? '<span class="badge alerta">texto alterado</span>' : '<span class="badge ok">ok</span>')
        : '<span class="badge erro">pendente</span>';
      const download = it.audio.existe
        ? `<a class="btn btn-mini" href="/media/${estado.slug}/${it.prefix}-narracao.mp3" download title="Baixar MP3">⬇</a>`
        : '';
      return `<div class="item-audio">
        <span class="rotulo">${esc(it.rotulo)}</span>
        ${it.audio.existe ? `<audio controls preload="none" src="/media/${estado.slug}/${it.prefix}-narracao.mp3"></audio>` : '<span class="msg-progresso">sem áudio ainda</span>'}
        ${badge}
        ${download}
        <button class="btn btn-mini regen" data-action="regen-narracao" data-slide="${it.id}">↻ regenerar</button>
        ${it.audio.existe ? `<button class="btn btn-mini btn-perigo" data-action="del-narracao" data-slide="${it.id}" title="Apagar este MP3">🗑</button>` : ''}
      </div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Narrações</h3>
      <div class="etapa-acoes">
        <button class="btn" data-action="regenerar-desatualizados-narracao" title="Gera só os itens sem áudio ou com o texto alterado">↻ Regenerar desatualizados</button>
        <button class="btn btn-primario" data-action="recriar-todas-narracao" title="Regenera todos os MP3, mesmo os já atualizados">🎙 Gerar todos</button>
      </div>
    </div>
    <p class="msg-progresso">Voz: <strong>${esc(estado.config?.VOZ || 'pt-BR-AntonioNeural')}</strong>. Textos inalterados são pulados (manifesto). Edite o texto na etapa Roteiro e use "↻ regenerar" para atualizar só o item.</p>
    ${lista}`;
}

// ---------------------------------------------------------------------------
// Etapa 4 — Vídeo
// ---------------------------------------------------------------------------
function renderEtapa4(el) {
  const st = estado.artefatos;
  const problemas = [];
  if (!st.imagensCompletas) problemas.push('faltam imagens (etapa 2)');
  if (!st.audioCompleto) problemas.push('faltam narrações (etapa 3)');
  const pode = problemas.length === 0;
  const videos = (st.videos || [])
    .map((v) => `
    <div class="video-item">
      <div class="video-rotulo">
        <span>${esc(v.arquivo)}</span>
        <a class="btn btn-mini" href="/media/${estado.slug}/${esc(v.arquivo)}" download title="Baixar MP4">⬇ download</a>
      </div>
      <video class="player-video" controls src="/media/${estado.slug}/${esc(v.arquivo)}"></video>
    </div>`)
    .join('');

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Montagem do vídeo</h3>
      <button class="btn btn-primario" data-action="montar-video" ${pode ? '' : 'disabled'}>🎬 Montar vídeo</button>
    </div>
    ${pode ? '' : `<p class="msg-progresso" style="color:var(--alerta)">⚠ ${problemas.join(' · ')}</p>`}
    <div class="cartao">
      <div class="video-config">
        <label>FPS
          <select id="cfg-fps"><option selected>24</option><option>30</option><option>60</option></select>
        </label>
        <label>Resolução
          <select id="cfg-res">
            <optgroup label="Horizontal 16:9">
              <option value="3840,2160">3840×2160 · 4K</option>
              <option value="1920,1080" selected>1920×1080 · Full HD</option>
              <option value="1280,720">1280×720 · HD</option>
            </optgroup>
            <optgroup label="Vertical 9:16 (Reels/TikTok)">
              <option value="2160,3840">2160×3840 · 4K vertical</option>
              <option value="1080,1920">1080×1920 · Full HD vertical</option>
              <option value="720,1280">720×1280 · HD vertical</option>
            </optgroup>
            <option value="custom">Personalizado…</option>
          </select>
        </label>
        <label>Largura (custom) <input id="cfg-width" type="number" value="1920" min="320" step="16" /></label>
        <label>Altura (custom) <input id="cfg-height" type="number" value="1080" min="240" step="16" /></label>
        <label>Segundos de margem/slide <input id="cfg-padding" type="number" value="0.3" min="0" step="0.1" /></label>
      </div>
      <p class="msg-progresso">O vídeo sai como <strong>&lt;slug&gt;-&lt;largura&gt;x&lt;altura&gt;.mp4</strong> — formatos diferentes não se sobrescrevem.</p>
      <div id="area-progresso-video" hidden>
        <div class="msg-progresso" id="msg-progresso-video">Preparando…</div>
        <div class="barra-progresso"><div id="barra-progresso-video"></div></div>
      </div>
    </div>
    ${videos}`;
}

function setProgressoVideo(pct, texto, etapa = 4) {
  const areaId = etapa === 5 ? '#area-progresso-short' : '#area-progresso-video';
  const barraId = etapa === 5 ? '#barra-progresso-short' : '#barra-progresso-video';
  const msgId = etapa === 5 ? '#msg-progresso-short' : '#msg-progresso-video';
  const area = $(areaId);
  if (!area) return;
  area.hidden = false;
  $(barraId).style.width = `${Math.max(0, Math.min(100, pct))}%`;
  $(msgId).textContent = texto || '…';
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Etapa 5 — Roteiro Short (promocional via LLM)
// ---------------------------------------------------------------------------
function renderEtapa5(el) {
  const st = estado.artefatos;
  const shortRoteiro = st.roteiro_short;

  const shortRoteiroHtml = shortRoteiro?.existe
    ? `
      <div class="cartao">
        <h4 style="color:var(--dourado); margin-bottom:10px">Roteiro promocional do Short</h4>
        <textarea readonly style="width:100%; min-height:150px; font-family:monospace; font-size:14px; background:#0d1b2a; color:#dce5ef; border:1px solid rgba(224,180,90,0.3); border-radius:8px; padding:12px; resize:vertical;">${esc(shortRoteiro.narracao || shortRoteiro.introducao || '')}</textarea>
        <p class="msg-progresso" style="margin-top:10px">Gerado em ${new Date(shortRoteiro.mtime).toLocaleString('pt-BR')}</p>
      </div>`
    : '<p class="msg-progresso" style="color:var(--alerta)">Roteiro do Short ainda não gerado.</p>';

  const problemas = [];
  if (!st.video?.existe) problemas.push('vídeo principal não gerado (etapa 4)');
  const pode = problemas.length === 0;

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Roteiro do Short (Promocional)</h3>
      <button class="btn btn-primario" data-action="gerar-roteiro-short" ${pode ? '' : 'disabled'}>🤖 Gerar via LLM</button>
    </div>
    ${pode ? '' : `<p class="msg-progresso" style="color:var(--alerta)">⚠ ${problemas.join(' · ')}</p>`}
    <p class="msg-progresso">Gera um roteiro promocional otimizado para Shorts (hook → problema → valor → autoridade → CTA) via llama-server. O texto tem ~150 palavras para ~55s de narração.</p>
    ${shortRoteiroHtml}`;
}

// ---------------------------------------------------------------------------
// Etapa 6 — YouTube Short
// ---------------------------------------------------------------------------
function renderEtapa6(el) {
  const st = estado.artefatos;
  const short = st.short;

  const shortHtml = short?.existe
    ? `
      <div class="cartao">
        <div class="video-item">
          <div class="video-rotulo">
            <span>${esc(short.arquivo)}</span>
            <a class="btn btn-mini" href="/media/${estado.slug}/${esc(short.arquivo)}" download title="Baixar YouTube Short">⬇ download</a>
          </div>
          <video class="player-video" controls src="/media/${estado.slug}/${esc(short.arquivo)}"></video>
        </div>
        <p class="msg-progresso" style="margin-top:10px">Gerado em ${new Date(short.mtime).toLocaleString('pt-BR')} · ${(short.tamanho / (1024 * 1024)).toFixed(1)} MB</p>
      </div>`
    : '<p class="msg-progresso" style="color:var(--alerta)">YouTube Short ainda não gerado.</p>';

  const videos = (st.shorts || [])
    .filter((v) => v.arquivo !== short?.arquivo)
    .map((v) => `
    <div class="video-item">
      <div class="video-rotulo">
        <span>${esc(v.arquivo)}</span>
        <a class="btn btn-mini" href="/media/${estado.slug}/${esc(v.arquivo)}" download title="Baixar MP4">⬇ download</a>
      </div>
      <video class="player-video" controls src="/media/${estado.slug}/${esc(v.arquivo)}"></video>
    </div>`)
    .join('');

  const problemas = [];
  if (!st.imagensCompletas) problemas.push('faltam imagens (etapa 2)');
  if (!st.audioCompleto) problemas.push('faltam narrações (etapa 3)');
  const pode = problemas.length === 0;

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>YouTube Short</h3>
      <button class="btn btn-primario" data-action="gerar-short" ${pode ? '' : 'disabled'}>📱 Gerar Short</button>
    </div>
    ${pode ? '' : `<p class="msg-progresso" style="color:var(--alerta)">⚠ ${problemas.join(' · ')}</p>`}
    <div class="cartao">
      <div class="video-config">
        <label>FPS
          <select id="cfg-short-fps"><option selected>24</option><option>30</option><option>60</option></select>
        </label>
        <label>Resolução (vertical 9:16)
          <select id="cfg-short-res">
            <option value="1080,1920" selected>1080×1920 · Full HD</option>
            <option value="720,1280">720×1280 · HD</option>
            <option value="2160,3840">2160×3840 · 4K vertical</option>
            <option value="custom">Personalizado…</option>
          </select>
        </label>
        <label>Largura (custom) <input id="cfg-short-width" type="number" value="1080" min="320" step="16" /></label>
        <label>Altura (custom) <input id="cfg-short-height" type="number" value="1920" min="240" step="16" /></label>
        <label>Segundos de margem/slide <input id="cfg-short-padding" type="number" value="0.2" min="0" step="0.1" /></label>
      </div>
      <p class="msg-progresso">O Short sai como <strong><slug>-short-<largura>x<altura>.mp4</strong> — formato vertical 9:16, ≤60s. Usa intro + até 4 slides + conclusão da aula principal.</p>
      <div id="area-progresso-short" hidden>
        <div class="msg-progresso" id="msg-progresso-short">Preparando…</div>
        <div class="barra-progresso"><div id="barra-progresso-short"></div></div>
      </div>
    </div>
    ${shortHtml}
    ${videos}`;
}

// ---------------------------------------------------------------------------
// Etapa 7 — PDF de estudo
// ---------------------------------------------------------------------------
function renderEtapa7(el) {
  const st = estado.artefatos;
  const pdf = st.pdf;
  const pdfHtml = pdf?.existe
    ? `
      <div class="cartao">
        <div class="pdf-acoes">
          <a class="btn btn-primario" href="/pdfs/${esc(pdf.arquivo)}" target="_blank" rel="noopener">📄 Abrir <strong>${esc(pdf.arquivo)}</strong></a>
          <a class="btn" href="/pdfs/${esc(pdf.arquivo)}" download>⬇ download</a>
        </div>
        <p class="msg-progresso" style="margin-top:10px">Gerado em ${new Date(pdf.mtime).toLocaleString('pt-BR')} · ${(pdf.tamanho / 1024).toFixed(0)} KB · ${st.slides.length} slides</p>
      </div>`
    : '<p class="msg-progresso" style="color:var(--alerta)">PDF ainda não gerado.</p>';

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>PDF de estudo</h3>
      <div class="etapa-acoes">
        <button class="btn" data-action="regenerar-pdf">↻ Regenerar conteúdo complementar</button>
        <button class="btn btn-primario" data-action="gerar-pdf">📄 Gerar PDF</button>
      </div>
    </div>
    <p class="msg-progresso">Material de estudo gerado a partir do <strong>texto da narração</strong>. Cada slide é aprofundado com notas complementares e referências bíblicas adicionais (via llama-server) para preencher uma página inteira. Não depende de imagens nem áudio.</p>
    ${pdfHtml}`;
}

// ---------------------------------------------------------------------------
// Etapa 8 — Vídeo de Questionário
// ---------------------------------------------------------------------------
function renderEtapa8(el) {
  const st = estado.artefatos;
  const quiz = st.questionario;

  const videoHtml = quiz?.existe
    ? `
      <div class="cartao">
        <div class="video-item">
          <div class="video-rotulo">
            <span>${esc(quiz.arquivo)}</span>
            <a class="btn btn-mini" href="/media/${estado.slug}/${esc(quiz.arquivo)}" download title="Baixar vídeo do questionário">⬇ download</a>
          </div>
          <video class="player-video" controls src="/media/${estado.slug}/${esc(quiz.arquivo)}"></video>
        </div>
        <p class="msg-progresso" style="margin-top:10px">Gerado em ${new Date(quiz.mtime).toLocaleString('pt-BR')} · ${(quiz.tamanho / (1024 * 1024)).toFixed(1)} MB</p>
      </div>`
    : '<p class="msg-progresso" style="color:var(--alerta)">Vídeo do questionário ainda não gerado.</p>';

  const perguntas = (quiz?.perguntas || []);
  const audiosHtml = perguntas.map((p) => {
    const playerAudio = (a, rotulo) => {
      const prefix = a.id;
      const download = a.existe
        ? `<a class="btn btn-mini" href="/media/${estado.slug}/${prefix}-narracao.mp3" download title="Baixar MP3">⬇</a>`
        : '';
      return `<div class="item-audio">
        <span class="rotulo">${rotulo}</span>
        ${a.existe ? `<audio controls preload="none" src="/media/${estado.slug}/${prefix}-narracao.mp3"></audio>` : '<span class="msg-progresso">sem áudio ainda</span>'}
        ${download}
        <button class="btn btn-mini regen" data-action="regen-narracao-quiz" data-item="${prefix}" title="Regenera com novo seed de voz (tenta corrigir pronúncia)">↻ regenerar</button>
        ${a.existe ? `<button class="btn btn-mini btn-perigo" data-action="del-narracao-quiz" data-item="${prefix}" title="Apagar este MP3">🗑</button>` : ''}
      </div>`;
    };
    return `<div class="cartao" style="margin-top:10px; padding:14px 18px;">
      <strong style="color:var(--dourado)">${p.numero}. ${esc(p.tema)}</strong>
      ${playerAudio(p.pergunta_audio, 'Pergunta')}
      ${playerAudio(p.resposta_audio, 'Resposta')}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Vídeo de Questionário</h3>
      <div class="etapa-acoes">
        <button class="btn" data-action="regenerar-todas-narracao-quiz" title="Regenera todos os MP3 do questionário, mesmo os já existentes">🎙 Regenerar todos os áudios</button>
        <button class="btn" data-action="remontar-questionario" title="Monta o vídeo de novo com os áudios atuais, sem regenerar perguntas nem narração">🎬 Remontar vídeo</button>
        <button class="btn btn-primario" data-action="gerar-questionario">🧠 Gerar vídeo de questionário</button>
      </div>
    </div>
    <p class="msg-progresso">O modelo formula <strong>5 perguntas de múltipla escolha</strong> com base no conteúdo da aula. Cada pergunta tem <strong>10 segundos</strong> para o espectador responder antes de a resposta correta ser revelada e narrada. Este vídeo é separado da videoaula principal. Use <strong>🎬 Remontar vídeo</strong> depois de regenerar algum áudio.</p>
    <div class="cartao" style="padding: 16px 20px; background: rgba(224,180,90,0.07); border-color: rgba(224,180,90,0.3);">
      <strong style="color: var(--dourado)">Formato do vídeo:</strong>
      <ul style="margin-top: 8px; padding-left: 20px; color: var(--texto-2); font-size: 14px; line-height: 1.8;">
        <li>Tema da pergunta + número + texto da pergunta</li>
        <li>3 opções de resposta (A, B, C)</li>
        <li>10 segundos de espera com a tela congelada</li>
        <li>A voz lê a pergunta + opções antes do timer</li>
        <li>Após o timer, a opção correta é destacada e narrada</li>
      </ul>
    </div>
    ${videoHtml}
    ${perguntas.length ? `<h4 style="margin-top:18px; color:var(--dourado)">Áudios do questionário</h4>
      <p class="msg-progresso">Se alguma pronúncia não ficou boa, use "↻ regenerar" para refazer só aquele áudio (novo seed de voz). Depois monte o vídeo de novo.</p>
      ${audiosHtml}` : ''}`;
}

// ---------------------------------------------------------------------------
// Modal fullscreen de slides
// ---------------------------------------------------------------------------
function abrirModalSlide(i) {
  const itens = itensImagem();
  if (!itens.length) return;
  estado.modalIndice = ((i % itens.length) + itens.length) % itens.length;
  const s = itens[estado.modalIndice];
  $('#modal-slide-img').src = urlImagem(s.arquivo, s.imagem.mtime);
  $('#modal-slide-img').alt = s.titulo || '';
  $('#modal-slide-contador').textContent = `${estado.modalIndice + 1} / ${itens.length}`;
  $('#modal-slide-titulo').textContent = s.titulo || '';
  $('#modal-slide').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharModalSlide() {
  $('#modal-slide').hidden = true;
  $('#modal-slide-img').src = '';
  estado.modalIndice = null;
  document.body.style.overflow = '';
}

function navegarModalSlide(delta) {
  if (estado.modalIndice == null) return;
  abrirModalSlide(estado.modalIndice + delta);
}

$('#slide-fechar').onclick = fecharModalSlide;
$('#slide-anterior').onclick = () => navegarModalSlide(-1);
$('#slide-proximo').onclick = () => navegarModalSlide(1);
$('#modal-slide').addEventListener('click', (ev) => {
  if (ev.target === $('#modal-slide')) fecharModalSlide();
});
document.addEventListener('keydown', (ev) => {
  if ($('#modal-slide').hidden) return;
  if (ev.key === 'Escape') fecharModalSlide();
  else if (ev.key === 'ArrowLeft') navegarModalSlide(-1);
  else if (ev.key === 'ArrowRight') navegarModalSlide(1);
});

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------
async function salvarRoteiro() {
  lerRoteiroDoDOM();
  try {
    await api(`/api/roteiro/${estado.slug}`, { method: 'PUT', body: JSON.stringify(estado.roteiro) });
    await carregarArtefatos();
    $('#titulo-aula').textContent = estado.roteiro.titulo_aula;
    toast('Roteiro salvo. Áudios de textos alterados ficam marcados como desatualizados.');
    mudarEtapa(1);
  } catch (e) {
    toast(e.message, true);
  }
}

async function regenerarRoteiro() {
  estado.jobAtivo = true;
  sincronizarBotoes();
  try {
    const res = await api('/api/roteiro', { method: 'POST', body: JSON.stringify({ topico: estado.roteiro.topico }) });
    estado.slug = res.slug;
    estado.roteiro = res.roteiro;
    await carregarArtefatos();
    $('#titulo-aula').textContent = estado.roteiro.titulo_aula;
    mudarEtapa(1);
    toast('Roteiro regenerado.');
  } catch (e) {
    toast(e.message, true);
  } finally {
    estado.jobAtivo = false;
    sincronizarBotoes();
  }
}

async function rodarJob(promise, mensagemOk) {
  estado.jobAtivo = true;
  sincronizarBotoes();
  try {
    await promise;
    toast(mensagemOk);
    await carregarArtefatos();
    mudarEtapa(estado.etapa);
  } catch (e) {
    toast(e.message, true);
  } finally {
    estado.jobAtivo = false;
    sincronizarBotoes();
  }
}

// ---------------------------------------------------------------------------
// Delegação de eventos (etapa container)
// ---------------------------------------------------------------------------
$('#etapa-container').addEventListener('click', async (ev) => {
  const img = ev.target.closest('.img-card img');
  if (img) {
    const card = img.closest('.img-card');
    if (card?.dataset.idx) abrirModalSlide(Number(card.dataset.idx));
    return;
  }
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const acao = btn.dataset.action;
  const slideId = btn.dataset.slide;
  const i = btn.dataset.slide;

  if (acao === 'salvar-roteiro') return salvarRoteiro();
  if (acao === 'regenerar-roteiro') return regenerarRoteiro();
  if (acao === 'add-slide') {
    estado.roteiro.slides.push({
      id: `slide-${String(estado.roteiro.slides.length + 1).padStart(2, '0')}`,
      titulo: 'Novo slide',
      pontos: ['Ponto 1', 'Ponto 2'],
      narracao: '',
      referencia_biblica: '',
      imagem_prompt: 'flat illustration, educational minimal style, no text',
    });
    return mudarEtapa(1);
  }
  if (acao === 'del-slide') {
    if (!confirm(`Remover o slide ${Number(i) + 1}?`)) return;
    estado.roteiro.slides.splice(Number(i), 1);
    renumerarSlides();
    return mudarEtapa(1);
  }
  if (acao === 'add-ponto') {
    const s = estado.roteiro.slides[Number(i)];
    s.pontos.push('Novo ponto');
    return mudarEtapa(1);
  }
  if (acao === 'del-ponto') {
    const s = estado.roteiro.slides[Number(i)];
    s.pontos.splice(Number(btn.dataset.ponto), 1);
    return mudarEtapa(1);
  }
  if (acao === 'regen-imagem' || acao === 'gerar-todas-imagens' || acao === 'gerar-todas-imagens-recriar') {
    if (estado.servicos && !servicoOk('comfy')) return toast('ComfyUI indisponível — não é possível gerar imagens.', true);
  }
  if (acao === 'regen-narracao' || acao === 'regenerar-desatualizados-narracao' || acao === 'recriar-todas-narracao') {
    if (estado.servicos && !servicoOk('qwen')) return toast('Qwen3-TTS indisponível — não é possível gerar narração.', true);
  }
  if (acao === 'regen-imagem') {
    return rodarJob(api(`/api/imagens/${estado.slug}`, { method: 'POST', body: JSON.stringify({ slideId, variar: true }) }), 'Imagem regenerada.');
  }
  if (acao === 'gerar-todas-imagens') {
    return rodarJob(api(`/api/imagens/${estado.slug}`, { method: 'POST', body: JSON.stringify({}) }), 'Imagens atualizadas.');
  }
  if (acao === 'gerar-todas-imagens-recriar') {
    if (!confirm('Apagar todas as imagens atuais e gerar do zero? Isso pode levar vários minutos.')) return;
    return rodarJob(api(`/api/imagens/${estado.slug}`, { method: 'POST', body: JSON.stringify({ recriarTodos: true, variar: true }) }), 'Todas as imagens foram recriadas.');
  }
  if (acao === 'regen-narracao') {
    return rodarJob(api(`/api/narracao/${estado.slug}`, { method: 'POST', body: JSON.stringify({ slideId }) }), 'Narração regenerada.');
  }
  if (acao === 'del-narracao') {
    const mapa = { intro: 'Introdução', conclusao: 'Conclusão' };
    const it = (estado.artefatos?.slides || []).find((s) => s.id === slideId);
    const rotulo = it?.titulo || mapa[slideId] || slideId;
    if (!confirm(`Apagar o áudio de "${rotulo}"?`)) return;
    return rodarJob(api(`/api/narracao/${estado.slug}`, { method: 'DELETE', body: JSON.stringify({ slideId }) }), 'Áudio apagado.');
  }
  if (acao === 'regenerar-desatualizados-narracao') {
    return rodarJob(api(`/api/narracao/${estado.slug}`, { method: 'POST', body: JSON.stringify({}) }), 'Narrações atualizadas.');
  }
  if (acao === 'recriar-todas-narracao') {
    if (!confirm('Regenerar TODOS os MP3 de narração (inclusive os atualizados)? Custa tempo de TTS.')) return;
    return rodarJob(api(`/api/narracao/${estado.slug}`, { method: 'POST', body: JSON.stringify({ todos: true }) }), 'Todas as narrações foram recriadas.');
  }
  if (acao === 'montar-video') {
    if (estado.servicos && (!servicoOk('ffmpeg') || !servicoOk('ffprobe') || !servicoOk('chromium'))) {
      return toast('Falta ffmpeg/ffprobe ou Chromium — não é possível montar o vídeo.', true);
    }
    const fps = $('#cfg-fps').value;
    const [w, h] = $('#cfg-res').value === 'custom' ? [$('#cfg-width').value, $('#cfg-height').value] : $('#cfg-res').value.split(',');
    const padding = $('#cfg-padding').value;
    setProgressoVideo(0, 'Iniciando montagem…', 4);
    return rodarJob(
      api(`/api/video/${estado.slug}`, { method: 'POST', body: JSON.stringify({ fps: Number(fps), width: Number(w), height: Number(h), padding: Number(padding) }) }),
      'Vídeo montado com sucesso!',
    );
  }
  if (acao === 'gerar-roteiro-short') {
    if (estado.servicos && !servicoOk('llama')) {
      return toast('llama-server indisponível — não é possível gerar roteiro do Short.', true);
    }
    if (!confirm('Gerar roteiro promocional do Short via LLM? O modelo vai criar um texto otimizado com hook, valor e CTA para o canal.')) return;
    return rodarJob(
      api(`/api/roteiro-short/${estado.slug}`, { method: 'POST' }),
      'Roteiro do Short gerado com sucesso!',
    );
  }
  if (acao === 'gerar-short') {
    if (estado.servicos && (!servicoOk('ffmpeg') || !servicoOk('ffprobe') || !servicoOk('chromium'))) {
      return toast('Falta ffmpeg/ffprobe ou Chromium — não é possível montar o Short.', true);
    }
    const fps = $('#cfg-short-fps').value;
    const [w, h] = $('#cfg-short-res').value === 'custom' ? [$('#cfg-short-width').value, $('#cfg-short-height').value] : $('#cfg-short-res').value.split(',');
    const padding = $('#cfg-short-padding').value;
    setProgressoVideo(0, 'Iniciando montagem do Short…', 5);
    return rodarJob(
      api(`/api/short/${estado.slug}`, { method: 'POST', body: JSON.stringify({ fps: Number(fps), width: Number(w), height: Number(h), padding: Number(padding) }) }),
      'YouTube Short gerado com sucesso!',
    );
  }
  if (acao === 'gerar-pdf' || acao === 'regenerar-pdf') {
    if (estado.servicos && !servicoOk('llama')) {
      if (acao === 'regenerar-pdf') return toast('llama-server indisponível — não é possível regenerar o conteúdo complementar.', true);
      toast('llama-server indisponível — o PDF será gerado sem o conteúdo complementar.', true);
    }
  }
  if (acao === 'gerar-pdf') {
    return rodarJob(api(`/api/pdf/${estado.slug}`, { method: 'POST', body: JSON.stringify({}) }), 'PDF de estudo gerado!');
  }
  if (acao === 'regenerar-pdf') {
    if (!confirm('Gerar novo conteúdo complementar (notas e referências) via llama-server e regenerar o PDF? Pode levar alguns minutos.')) return;
    return rodarJob(
      api(`/api/pdf/${estado.slug}`, { method: 'POST', body: JSON.stringify({ regenerarEnriquecimento: true }) }),
      'PDF regenerado com novo conteúdo complementar!',
    );
  }
  if (acao === 'gerar-questionario') {
    if (estado.servicos && (!servicoOk('llama') || !servicoOk('qwen') || !servicoOk('ffmpeg') || !servicoOk('chromium'))) {
      const faltam = [];
      if (!servicoOk('llama')) faltam.push('llama-server');
      if (!servicoOk('qwen')) faltam.push('Qwen3-TTS');
      if (!servicoOk('ffmpeg')) faltam.push('ffmpeg');
      if (!servicoOk('chromium')) faltam.push('Chromium');
      return toast(`Serviços indisponíveis: ${faltam.join(', ')}`, true);
    }
    if (!confirm('Gerar o vídeo de questionário? O modelo vai criar 5 perguntas de múltipla escolha e gerar a narração e o vídeo. Isso pode levar alguns minutos.')) return;
    return rodarJob(
      api(`/api/questionario/${estado.slug}`, { method: 'POST' }),
      'Vídeo de questionário gerado com sucesso!',
    );
  }
  if (acao === 'remontar-questionario') {
    if (estado.servicos && (!servicoOk('ffmpeg') || !servicoOk('ffprobe') || !servicoOk('chromium'))) {
      return toast('Falta ffmpeg/ffprobe ou Chromium — não é possível montar o vídeo.', true);
    }
    if (!confirm('Remontar o vídeo do questionário com os áudios atuais? As perguntas e narrações não serão regeneradas.')) return;
    return rodarJob(
      api(`/api/video-questionario/${estado.slug}`, { method: 'POST' }),
      'Vídeo do questionário remontado!',
    );
  }
  if (acao === 'regen-narracao-quiz' || acao === 'regenerar-todas-narracao-quiz') {
    if (estado.servicos && !servicoOk('qwen')) return toast('Qwen3-TTS indisponível — não é possível gerar narração.', true);
    const itemId = btn.dataset.item;
    if (!itemId && acao === 'regenerar-todas-narracao-quiz') {
      if (!confirm('Regenerar TODOS os áudios do questionário (pergunta + resposta de cada)? Custa tempo de TTS.')) return;
      return rodarJob(
        api(`/api/narracao-questionario/${estado.slug}`, { method: 'POST', body: JSON.stringify({ todos: true, variar: true }) }),
        'Todos os áudios do questionário foram regenerados.',
      );
    }
    if (acao === 'regen-narracao-quiz') {
      return rodarJob(
        api(`/api/narracao-questionario/${estado.slug}`, { method: 'POST', body: JSON.stringify({ itemId, variar: true }) }),
        `Áudio ${itemId} regenerado.`,
      );
    }
  }
  if (acao === 'del-narracao-quiz') {
    const itemId = btn.dataset.item;
    if (!confirm(`Apagar o áudio ${itemId}?`)) return;
    return rodarJob(
      api(`/api/narracao-questionario/${estado.slug}`, { method: 'DELETE', body: JSON.stringify({ itemId }) }),
      'Áudio apagado.',
    );
  }
});

// Contador de palavras + valores enquanto digita
$('#etapa-container').addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset && t.dataset.field) {
    const i = t.dataset.slide;
    const s = estado.roteiro.slides[Number(i)];
    if (s && t.dataset.field === 'narracao') {
      s.narracao = t.value;
      const n = contarPalavras(t.value);
      const badge = $(`[data-contador="${i}"]`);
      if (badge) {
        badge.textContent = `${n} palavras`;
        badge.className = `contador ${n >= 60 && n <= 90 ? 'dentro' : 'fora'}`;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------
async function abrirConfig() {
  estado.config = await api('/api/config');
  document.querySelectorAll('#modal-config [data-cfg]').forEach((inp) => {
    const v = estado.config[inp.dataset.cfg];
    if (inp.type === 'checkbox') inp.checked = v === '1' || v === true || v === 1;
    else inp.value = v ?? '';
  });
  $('#modal-config').hidden = false;
}

$('#btn-config').onclick = abrirConfig;
$('#btn-fechar-config').onclick = () => ($('#modal-config').hidden = true);

// ---------------------------------------------------------------------------
// Serviços (modal de status)
// ---------------------------------------------------------------------------
$('#btn-servicos').onclick = () => {
  $('#modal-servicos').hidden = false;
  renderListaServicos();
  if (!estado.servicos) carregarServicos();
};
$('#btn-fechar-servicos').onclick = () => ($('#modal-servicos').hidden = true);
$('#btn-recarregar-servicos').onclick = async () => {
  $('#btn-recarregar-servicos').disabled = true;
  await carregarServicos(true);
  $('#btn-recarregar-servicos').disabled = false;
};
$('#btn-salvar-config').onclick = async () => {
  const novo = {};
  document.querySelectorAll('#modal-config [data-cfg]').forEach((inp) => {
    novo[inp.dataset.cfg] = inp.type === 'checkbox' ? (inp.checked ? '1' : '') : inp.value;
  });
  await api('/api/config', { method: 'PUT', body: JSON.stringify(novo) });
  estado.config = novo;
  $('#modal-config').hidden = true;
  toast('Configurações salvas.');
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
async function carregarAulas() {
  const aulas = await api('/api/aulas');
  const el = $('#lista-aulas');
  el.innerHTML = '';
  if (!aulas.length) {
    el.innerHTML = '<p style="color:var(--texto-3)">Nenhuma aula ainda — crie uma acima.</p>';
    return;
  }
  for (const a of aulas) {
    const card = document.createElement('div');
    card.className = 'card-aula';
    card.onclick = () => abrirAula(a.slug);
    const badges = [
      a.imagensCompletas ? '<span class="badge ok">✓ imagens</span>' : '<span class="badge alerta">imagens</span>',
      a.audioCompleto ? '<span class="badge ok">✓ áudio</span>' : '<span class="badge alerta">áudio</span>',
      a.videoPronto ? '<span class="badge ok">✓ vídeo</span>' : '',
      a.shortPronto ? '<span class="badge ok">✓ short</span>' : '',
      a.pdfPronto ? '<span class="badge ok">✓ PDF</span>' : '',
    ].join('');
    const thumb = a.thumbnail
      ? `<img class="card-thumb" src="${a.thumbnail}" alt="" loading="lazy" />`
      : `<div class="card-thumb card-thumb-placeholder">✦</div>`;
    card.innerHTML = `
      <div class="card-thumb-wrap">
        ${thumb}
        <button class="btn-renomear" data-slug="${esc(a.slug)}" data-titulo="${esc(a.titulo_aula)}" title="Renomear título da aula">✏️</button>
        <button class="btn-excluir" data-slug="${esc(a.slug)}" title="Excluir aula">🗑</button>
      </div>
      <h3>${esc(a.titulo_aula)}</h3>
      <div class="meta">${a.slides} slides</div>
      <div class="badges">${badges}</div>`;
    el.appendChild(card);
  }
}

async function renomearAula(slug, tituloAtual) {
  const novoTitulo = prompt('Novo título para esta aula:', tituloAtual || '');
  if (!novoTitulo || novoTitulo.trim() === '' || novoTitulo.trim() === tituloAtual) return;
  try {
    const res = await api(`/api/aulas/${slug}/titulo`, {
      method: 'PUT',
      body: JSON.stringify({ titulo_aula: novoTitulo.trim() }),
    });
    toast('Título da aula atualizado com sucesso!');
    if (estado.slug === slug && estado.roteiro) {
      estado.roteiro.titulo_aula = res.titulo_aula;
      $('#titulo-aula').textContent = res.titulo_aula;
      if (estado.etapa === 1) renderEtapa1($('#etapa-container'));
    }
    if (estado.tela === 'dashboard') {
      carregarAulas();
    }
  } catch (e) {
    toast(e.message, true);
  }
}

$('#lista-aulas').addEventListener('click', async (ev) => {
  const btnRenomear = ev.target.closest('.btn-renomear');
  if (btnRenomear) {
    ev.stopPropagation();
    return renomearAula(btnRenomear.dataset.slug, btnRenomear.dataset.titulo);
  }
  const btn = ev.target.closest('.btn-excluir');
  if (!btn) return;
  ev.stopPropagation();
  const slug = btn.dataset.slug;
  if (!confirm(`Excluir a aula "${slug}"?\n\nIsso apaga o roteiro, imagens, narrações, vídeos e o PDF, além do cache de render. Essa ação não pode ser desfeita.`)) return;
  try {
    await api(`/api/aulas/${slug}`, { method: 'DELETE' });
    toast('Aula excluída.');
    carregarAulas();
  } catch (e) {
    toast(e.message, true);
  }
});

// ---- Formulário Nova Aula ----
let ctxTabAtiva = 'assunto';

function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '');
    fr.onerror = () => reject(fr.error || new Error('Falha ao ler o arquivo'));
    fr.readAsDataURL(arquivo);
  });
}

function ativarCtxTab(tab) {
  ctxTabAtiva = tab;
  document.querySelectorAll('.ctx-tab').forEach((b) => b.classList.toggle('ativa', b.dataset.tab === tab));
  document.querySelectorAll('.ctx-painel').forEach((p) => p.classList.toggle('oculto', true));
  const painel = document.getElementById(`ctx-${tab}`);
  if (painel) painel.classList.remove('oculto');
}

document.querySelectorAll('.ctx-tab').forEach((btn) => {
  btn.addEventListener('click', () => ativarCtxTab(btn.dataset.tab));
});

// Drag-and-drop / clique na drop-area do PDF
const dropArea = document.getElementById('pdf-drop-area');
const pdfInput = document.getElementById('input-pdf');
const pdfTexto = document.getElementById('pdf-drop-texto');

function setPdfArquivo(arquivo) {
  if (arquivo && /\.pdf$/i.test(arquivo.name)) {
    pdfTexto.textContent = `📎 ${arquivo.name}`;
    // guarda no input via DataTransfer para manter a referência
    const dt = new DataTransfer();
    dt.items.add(arquivo);
    pdfInput.files = dt.files;
  }
}

if (dropArea && pdfInput) {
  dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('arrastando'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('arrastando'));
  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('arrastando');
    const arquivo = e.dataTransfer?.files?.[0];
    if (arquivo) setPdfArquivo(arquivo);
  });
  pdfInput.addEventListener('change', () => {
    const arquivo = pdfInput.files?.[0];
    if (arquivo) setPdfArquivo(arquivo);
  });
}

async function criarAula() {
  const titulo = $('#input-titulo')?.value?.trim();
  if (!titulo) return toast('Informe o título da aula.', true);
  const slug = slugDe(titulo);

  try {
    const aulas = await api('/api/aulas');
    if (aulas.some((a) => a.slug === slug)) {
      return toast(`Já existe uma aula com este título ("${slug}").`, true);
    }
  } catch (_) {}

  if (estado.servicos && !servicoOk('llama')) {
    toast('llama-server indisponível — o roteiro não será gerado. Inicie-o antes.', true);
    return;
  }

  let payload = { topico: titulo };

  if (ctxTabAtiva === 'assunto') {
    const assunto = $('#input-assunto')?.value?.trim();
    if (assunto) payload.material = assunto;

  } else if (ctxTabAtiva === 'pdf') {
    const arquivo = pdfInput?.files?.[0];
    if (!arquivo) return toast('Selecione um arquivo PDF.', true);
    if (!/\.pdf$/i.test(arquivo.name)) return toast('O arquivo precisa ter extensão .pdf.', true);
    try {
      const base64 = await arquivoParaBase64(arquivo);
      payload.pdf = { nome: arquivo.name, base64 };
    } catch (e) {
      return toast(`Erro ao ler o PDF: ${e.message}`, true);
    }

  } else if (ctxTabAtiva === 'texto') {
    const texto = $('#input-texto-contexto')?.value?.trim();
    if (texto) payload.material = texto;
  }

  try {
    const res = await api('/api/roteiro', { method: 'POST', body: JSON.stringify(payload) });
    // limpar formulário
    $('#input-titulo').value = '';
    $('#input-assunto').value = '';
    if (pdfInput) { pdfInput.value = ''; }
    if (pdfTexto) pdfTexto.textContent = 'Clique ou arraste um PDF aqui';
    if ($('#input-texto-contexto')) $('#input-texto-contexto').value = '';
    ativarCtxTab('assunto');
    await abrirAula(res.slug);
    if (res.pdf) {
      toast(`PDF importado (${res.pdf.paginas} páginas) — roteiro gerado a partir do material!`);
    } else {
      toast('Roteiro gerado! Revise o texto na etapa Roteiro.');
    }
  } catch (e) {
    toast(e.message, true);
  }
}

$('#btn-nova-aula').onclick = criarAula;
$('#input-titulo')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') criarAula(); });



$('#btn-voltar').onclick = () => mostrarTela('dashboard');
$('#btn-inicio').onclick = () => mostrarTela('dashboard');
$('#btn-renomear-aula').onclick = () => {
  if (estado.slug && estado.roteiro) {
    renomearAula(estado.slug, estado.roteiro.titulo_aula);
  }
};
$('#btn-excluir-aula').onclick = async () => {
  const slug = estado.slug;
  if (!slug) return;
  if (!confirm(`Excluir a aula "${estado.roteiro?.titulo_aula || slug}"?\n\nIsso apaga o roteiro, imagens, narrações, vídeos e o PDF, além do cache de render. Essa ação não pode ser desfeita.`)) return;
  if (estado.jobAtivo) return toast('Aguarde o job atual terminar.', true);
  try {
    await api(`/api/aulas/${slug}`, { method: 'DELETE' });
    estado.slug = null;
    estado.roteiro = null;
    estado.artefatos = null;
    toast('Aula excluída.');
    mostrarTela('dashboard');
  } catch (e) {
    toast(e.message, true);
  }
};
$('#btn-atualizar').onclick = async () => {
  if (estado.jobAtivo) return toast('Aguarde o job atual terminar.', true);
  try {
    await Promise.all([carregarRoteiro(), carregarArtefatos()]);
    $('#titulo-aula').textContent = estado.roteiro.titulo_aula;
    mudarEtapa(estado.etapa);
    toast('Aula atualizada.');
  } catch (e) {
    toast(e.message, true);
  }
};

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------
$('#btn-toggle-log').onclick = () => {
  const el = $('#log-linhas');
  el.classList.toggle('aberto');
  $('#btn-toggle-log').textContent = el.classList.contains('aberto') ? '▴ Log das etapas' : '▾ Log das etapas';
  if (el.classList.contains('aberto')) {
    renderizarTodosLogs('#log-linhas');
  }
};

$('#btn-limpar-log').onclick = () => {
  estado.logs = [];
  $('#log-linhas').innerHTML = '';
  $('#log-linhas-modal').innerHTML = '';
  $('#btn-logs').classList.remove('tem-erro');
  toast('Logs limpos.');
};

$('#btn-copiar-log').onclick = copiarLogsTexto;
$('#btn-copiar-log-modal').onclick = copiarLogsTexto;
$('#btn-limpar-log-modal').onclick = () => $('#btn-limpar-log').click();

$('#btn-logs').onclick = () => {
  $('#btn-logs').classList.remove('tem-erro');
  abrirModalLogs();
};
$('#btn-fechar-logs').onclick = fecharModalLogs;

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------
const sse = new EventSource('/api/progresso');
sse.addEventListener('progresso', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.tipo === 'inicio') {
    estado.jobAtivo = true;
    sincronizarBotoes();
    clearTimeout(_jobClearT);
    estado.job = { jobId: msg.jobId, etapa: msg.etapa, status: 'rodando', msg: 'Preparando…', iniciadoEm: msg.iniciadoEm || Date.now() };
    renderStatusJob();
  }
  if (msg.tipo === 'progress') {
    if (estado.job?.etapa === msg.etapa) {
      estado.job.status = 'rodando';
      estado.job.msg = msg.linha;
      const m = /\((\d+)%\)$/.exec(msg.linha);
      estado.job.pct = m ? Number(m[1]) : estado.job.pct;
      renderStatusJob();
    }
  }
  if (msg.tipo === 'erro') {
    if (estado.job?.etapa === msg.etapa) {
      estado.job.status = 'erro';
      estado.job.msg = msg.linha;
      renderStatusJob();
    }
    // Ao receber erro, expande os logs inline se estiver no workspace
    if (estado.tela === 'aula') {
      const el = $('#log-linhas');
      if (el && !el.classList.contains('aberto')) {
        el.classList.add('aberto');
        $('#btn-toggle-log').textContent = '▴ Log das etapas';
        renderizarTodosLogs('#log-linhas');
      }
    }
  }
  if (msg.tipo === 'log') {
    if (estado.job?.etapa === msg.etapa) {
      estado.job.status = 'rodando';
      estado.job.msg = msg.linha;
      renderStatusJob();
    }
  }
  if (msg.tipo === 'fim') {
    estado.jobAtivo = false;
    sincronizarBotoes();
    atualizarIndicadorTopo(false);
    if (estado.etapa === 4 || estado.etapa === 5 || estado.etapa === 6) {
      const textoOk = estado.etapa === 4 ? 'Vídeo pronto!' : (estado.etapa === 5 ? 'Roteiro Short pronto!' : 'Short pronto!');
      setProgressoVideo(
        msg.ok ? 100 : 0,
        msg.ok ? textoOk : 'Falha na montagem',
        estado.etapa
      );
    }
    estado.job = {
      etapa: msg.etapa,
      status: msg.ok ? 'ok' : 'erro',
      msg: msg.ok ? 'Processo finalizado com sucesso.' : msg.cancelado ? 'Job cancelado pelo usuário.' : 'Falha na execução — clique em "Ver Log" para detalhes.',
    };
    renderStatusJob();

    // Se falhou, abre o painel de log automaticamente
    if (!msg.ok && !msg.cancelado && estado.tela === 'aula') {
      const el = $('#log-linhas');
      if (el && !el.classList.contains('aberto')) {
        el.classList.add('aberto');
        $('#btn-toggle-log').textContent = '▴ Log das etapas';
        renderizarTodosLogs('#log-linhas');
      }
    }

    clearTimeout(_jobClearT);
    _jobClearT = setTimeout(() => {
      estado.job = null;
      renderStatusJob();
    }, 12000);
    setTimeout(() => {
      if (estado.tela === 'aula') {
        carregarArtefatos();
        mudarEtapa(estado.etapa);
      }
    }, 400);
  }
  if ((msg.etapa === 'video' || msg.etapa === 'roteiro-short' || msg.etapa === 'short' || msg.etapa === 'questionario') && msg.tipo === 'progress' && (estado.etapa === 4 || estado.etapa === 5 || estado.etapa === 6 || estado.etapa === 8)) {
    const m = /\((\d+)%\)/.exec(msg.linha);
    if (estado.etapa === 4 && msg.etapa === 'video') setProgressoVideo(m ? Number(m[1]) : 0, msg.linha, 4);
    if (estado.etapa === 5 && msg.etapa === 'roteiro-short') setProgressoVideo(m ? Number(m[1]) : 0, msg.linha, 5);
    if (estado.etapa === 6 && msg.etapa === 'short') setProgressoVideo(m ? Number(m[1]) : 0, msg.linha, 6);
  }
  adicionarLog(msg);
});

// ---------------------------------------------------------------------------
// Botão flutuante de salvar (etapa 1 - Roteiro)
// ---------------------------------------------------------------------------
function atualizarBotaoFlutuarSalvar() {
  const btnFlutuar = $('#btn-flutuar-salvar');
  const etapaTopo = $('.etapa-topo');
  if (!btnFlutuar || !etapaTopo) {
    if (btnFlutuar) btnFlutuar.hidden = true;
    return;
  }
  // Só mostra na etapa 1 (Roteiro)
  if (estado.etapa !== 1) {
    btnFlutuar.hidden = true;
    return;
  }
  const rect = etapaTopo.getBoundingClientRect();
  // Mostra o botão flutuante quando o topo da etapa saiu da tela (acima do header)
  // Header tem ~60px, então considera quando o bottom do etapa-topo < 70px
  const headerAltura = 70;
  if (rect.bottom < headerAltura) {
    btnFlutuar.hidden = false;
  } else {
    btnFlutuar.hidden = true;
  }
}

// Listener de scroll para o botão flutuante
let _scrollTimer = null;
window.addEventListener('scroll', () => {
  if (_scrollTimer) return;
  _scrollTimer = requestAnimationFrame(() => {
    atualizarBotaoFlutuarSalvar();
    _scrollTimer = null;
  });
}, { passive: true });

// Clique no botão flutuante
$('#btn-flutuar-salvar').addEventListener('click', () => {
  if (estado.etapa === 1) salvarRoteiro();
});

// Atualiza também ao mudar de etapa
const _mudarEtapaOriginal = mudarEtapa;
mudarEtapa = function(n) {
  _mudarEtapaOriginal(n);
  atualizarBotaoFlutuarSalvar();
};

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
(async function init() {
  estado.config = await api('/api/config');
  carregarServicos();
  setInterval(carregarServicos, 30000);
  
  // Carrega histórico de logs do servidor
  try {
    const resLogs = await api('/api/logs');
    if (resLogs?.logs?.length) {
      for (const item of resLogs.logs) {
        adicionarLog(item);
      }
    }
  } catch {
    /* sem histórico */
  }

  verJobServidor();
  setInterval(verJobServidor, 5000);
  setInterval(() => {
    if (estado.job?.status === 'rodando' && estado.job.iniciadoEm) {
      const el = document.querySelector('.status-desde');
      if (el) el.textContent = `em andamento há ${tempoDesde(estado.job.iniciadoEm)}`;
    }
  }, 1000);
  mostrarTela('dashboard');
})();
