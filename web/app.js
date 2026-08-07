const $ = (sel) => document.querySelector(sel);

const ETAPAS = [
  { n: 1, rotulo: 'Roteiro' },
  { n: 2, rotulo: 'Imagens' },
  { n: 3, rotulo: 'Narração' },
  { n: 4, rotulo: 'Vídeo' },
  { n: 5, rotulo: 'PDF' },
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

const NOME_ETAPA = { roteiro: 'Roteiro', imagens: 'Imagens', narracao: 'Narração', video: 'Vídeo', pdf: 'PDF' };

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
// Log (SSE)
// ---------------------------------------------------------------------------
function adicionarLog(msg) {
  estado.logs.push(msg);
  if (estado.logs.length > 400) estado.logs.splice(0, estado.logs.length - 400);
  const el = $('#log-linhas');
  if (!el.classList.contains('aberto')) return;
  const div = document.createElement('div');
  div.className = `log-linha ${msg.tipo || 'log'}`;
  const hora = new Date(msg.ts).toLocaleTimeString('pt-BR');
  div.innerHTML = `<span class="hora">${hora}</span>${esc(msg.linha || msg.tipo)}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
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
  if (n === 2) return st.imagensCompletas ? 'ok' : st.slides.some((s) => s.imagem.existe) ? 'alerta' : 'erro';
  if (n === 3) return st.audioCompleto ? 'ok' : 'alerta';
  if (n === 4) return st.video.existe ? 'ok' : 'erro';
  return st.pdf?.existe ? 'ok' : 'erro';
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
  else renderEtapa5(container);
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
  const botaoCancelar =
    job.status === 'rodando'
      ? `<button class="btn btn-ghost btn-mini status-cancelar" id="btn-cancelar-job" title="Cancelar este job">✕ Cancelar</button>`
      : '';
  el.innerHTML = `
    <span class="status-icone">${icone}</span>
    <div class="status-texto">
      <strong>${statusTexto}</strong>
      <span>${esc(job.msg || '')}</span>
      ${job.status === 'rodando' && job.iniciadoEm ? `<span class="status-desde">em andamento há ${tempoDesde(job.iniciadoEm)}</span>` : ''}
      ${job.pct != null ? `<div class="barra-progresso status-barra"><div style="width:${Math.max(0, Math.min(100, job.pct))}%"></div></div>` : ''}
    </div>
    ${botaoCancelar}`;
  atualizarIndicadorTopo(job.status === 'rodando');
}

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
      <label>Conclusão (narrada)</label>
      <textarea data-field="conclusao" rows="3">${esc(r.conclusao)}</textarea>
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
  r.conclusao = $('[data-field="conclusao"]')?.value ?? r.conclusao;
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
function renderEtapa2(el) {
  const st = estado.artefatos;
  const cards = st.slides
    .map((s) => {
      const img = s.imagem.existe
        ? `<img src="/media/${estado.slug}/slide-${String(s.idx).padStart(2, '0')}.png" loading="lazy" />`
        : '';
      const regen = s.imagem.existe
        ? `<button class="regen" data-action="regen-imagem" data-slide="${s.id}" title="Regenerar imagem (novo seed)">↻</button>`
        : '';
      const badge = s.imagem.existe
        ? (s.imagem.desatualizado ? '<span class="badge alerta">prompt alterado</span>' : '<span class="badge ok">ok</span>')
        : '<span class="badge erro">pendente</span>';
      return `<div class="img-card ${s.imagem.existe ? '' : 'faltando'}" data-idx="${s.idx}">${img}${regen}
        <div class="img-info"><span>${esc(s.titulo)}</span>${badge}</div></div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Imagens dos slides</h3>
      <div class="etapa-acoes">
        <button class="btn btn-perigo" data-action="gerar-todas-imagens-recriar" title="Apaga as atuais e gera todas de novo">↺ Recriar todas</button>
        <button class="btn btn-primario" data-action="gerar-todas-imagens">Gerar as que faltam</button>
      </div>
    </div>
    <p class="msg-progresso">Geração via ComfyUI local (≈30s por imagem). "↻" regenera uma imagem com seed aleatório.</p>
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
          <select id="cfg-fps"><option>24</option><option selected>30</option><option>60</option></select>
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

function setProgressoVideo(pct, texto) {
  const area = $('#area-progresso-video');
  if (!area) return;
  area.hidden = false;
  $('#barra-progresso-video').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  $('#msg-progresso-video').textContent = texto || '…';
}

// ---------------------------------------------------------------------------
// Etapa 5 — PDF de estudo
// ---------------------------------------------------------------------------
function renderEtapa5(el) {
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
// Modal fullscreen de slides
// ---------------------------------------------------------------------------
function abrirModalSlide(i) {
  const slides = estado.artefatos?.slides || [];
  if (!slides.length) return;
  estado.modalIndice = ((i % slides.length) + slides.length) % slides.length;
  const s = slides[estado.modalIndice];
  $('#modal-slide-img').src = `/media/${estado.slug}/slide-${String(s.idx).padStart(2, '0')}.png`;
  $('#modal-slide-img').alt = s.titulo || '';
  $('#modal-slide-contador').textContent = `${s.idx} / ${slides.length}`;
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
    if (card?.dataset.idx) abrirModalSlide(Number(card.dataset.idx) - 1);
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
    setProgressoVideo(0, 'Iniciando montagem…');
    return rodarJob(
      api(`/api/video/${estado.slug}`, { method: 'POST', body: JSON.stringify({ fps: Number(fps), width: Number(w), height: Number(h), padding: Number(padding) }) }),
      'Vídeo montado com sucesso!',
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
      a.pdfPronto ? '<span class="badge ok">✓ PDF</span>' : '',
    ].join('');
    const thumb = a.thumbnail
      ? `<img class="card-thumb" src="${a.thumbnail}" alt="" loading="lazy" />`
      : `<div class="card-thumb card-thumb-placeholder">✦</div>`;
    card.innerHTML = `
      <div class="card-thumb-wrap">${thumb}<button class="btn-excluir" data-slug="${esc(a.slug)}" title="Excluir aula">🗑</button></div>
      <h3>${esc(a.titulo_aula)}</h3>
      <div class="meta">${a.slides} slides</div>
      <div class="badges">${badges}</div>`;
    el.appendChild(card);
  }
}

$('#lista-aulas').addEventListener('click', async (ev) => {
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

$('#btn-nova-aula').onclick = async () => {
  const topico = $('#input-topico').value.trim();
  if (!topico) return toast('Digite um tópico.', true);
  const slug = slugDe(topico);
  try {
    const aulas = await api('/api/aulas');
    if (aulas.some(a => a.slug === slug)) {
      return toast(`Já existe uma aula com este tópico ("${slug}").`, true);
    }
    if (estado.servicos && !servicoOk('llama')) {
      toast('llama-server indisponível — o roteiro não será gerado. Inicie-o antes.', true);
      return;
    }
    const res = await api('/api/roteiro', { method: 'POST', body: JSON.stringify({ topico }) });
    $('#input-topico').value = '';
    await abrirAula(res.slug);
    toast('Roteiro gerado! Revise o texto na etapa Roteiro.');
  } catch (e) {
    toast(e.message, true);
  }
};
$('#input-topico').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') $('#btn-nova-aula').click();
});

$('#btn-voltar').onclick = () => mostrarTela('dashboard');
$('#btn-inicio').onclick = () => mostrarTela('dashboard');
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
    el.innerHTML = '';
    for (const m of estado.logs) adicionarLog(m);
    el.scrollTop = el.scrollHeight;
  }
};
$('#btn-limpar-log').onclick = () => {
  estado.logs = [];
  $('#log-linhas').innerHTML = '';
};

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
    if (estado.etapa === 4) setProgressoVideo(msg.ok ? 100 : 0, msg.ok ? 'Vídeo pronto!' : 'Falha na montagem');
    estado.job = {
      etapa: msg.etapa,
      status: msg.ok ? 'ok' : 'erro',
      msg: msg.ok ? 'Processo finalizado com sucesso.' : msg.cancelado ? 'Job cancelado pelo usuário.' : 'Falha na execução — veja o log.',
    };
    renderStatusJob();
    clearTimeout(_jobClearT);
    _jobClearT = setTimeout(() => {
      estado.job = null;
      renderStatusJob();
    }, 8000);
    setTimeout(() => {
      if (estado.tela === 'aula') {
        carregarArtefatos();
        mudarEtapa(estado.etapa);
      }
    }, 400);
  }
  if (msg.etapa === 'video' && msg.tipo === 'progress' && estado.etapa === 4) {
    const m = /\((\d+)%\)/.exec(msg.linha);
    setProgressoVideo(m ? Number(m[1]) : 0, msg.linha);
  }
  adicionarLog(msg);
});

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
(async function init() {
  estado.config = await api('/api/config');
  carregarServicos();
  setInterval(carregarServicos, 30000);
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
