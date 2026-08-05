const $ = (sel) => document.querySelector(sel);

const ETAPAS = [
  { n: 1, rotulo: 'Roteiro' },
  { n: 2, rotulo: 'Imagens' },
  { n: 3, rotulo: 'Narração' },
  { n: 4, rotulo: 'Vídeo' },
];

const estado = {
  tela: 'dashboard',
  slug: null,
  roteiro: null,
  artefatos: null,
  config: null,
  etapa: 1,
  jobAtivo: false,
  logs: [],
};

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');

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
  return st.video.existe ? 'ok' : 'erro';
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
  else renderEtapa4(container);
  sincronizarBotoes();
}

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
      return `<div class="img-card ${s.imagem.existe ? '' : 'faltando'}">${img}${regen}
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
      return `<div class="item-audio">
        <span class="rotulo">${esc(it.rotulo)}</span>
        ${it.audio.existe ? `<audio controls preload="none" src="/media/${estado.slug}/${it.prefix}-narracao.mp3"></audio>` : '<span class="msg-progresso">sem áudio ainda</span>'}
        ${badge}
        <button class="btn btn-mini regen" data-action="regen-narracao" data-slide="${it.id}">↻ regenerar</button>
      </div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="etapa-topo">
      <h3>Narrações</h3>
      <div class="etapa-acoes">
        <button class="btn btn-primario" data-action="gerar-todas-narracao">Gerar as que faltam</button>
      </div>
    </div>
    <p class="msg-progresso">Voz: <strong>${esc(estado.config?.VOZ || 'pt-BR-AntonioNeural')}</strong>. Edite o texto na etapa Roteiro e use "↻ regenerar" para atualizar só o item.</p>
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
      <div class="video-rotulo">${esc(v.arquivo)}</div>
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
        <label>Segundos de margem/slide <input id="cfg-padding" type="number" value="0.8" min="0" step="0.1" /></label>
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
// Ações
// ---------------------------------------------------------------------------
async function salvarRoteiro() {
  lerRoteiroDoDOM();
  try {
    await api(`/api/roteiro/${estado.slug}`, { method: 'PUT', body: JSON.stringify(estado.roteiro) });
    await carregarArtefatos();
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
  if (acao === 'gerar-todas-narracao') {
    return rodarJob(api(`/api/narracao/${estado.slug}`, { method: 'POST', body: JSON.stringify({}) }), 'Narrações atualizadas.');
  }
  if (acao === 'montar-video') {
    const fps = $('#cfg-fps').value;
    const [w, h] = $('#cfg-res').value === 'custom' ? [$('#cfg-width').value, $('#cfg-height').value] : $('#cfg-res').value.split(',');
    const padding = $('#cfg-padding').value;
    setProgressoVideo(0, 'Iniciando montagem…');
    return rodarJob(
      api(`/api/video/${estado.slug}`, { method: 'POST', body: JSON.stringify({ fps: Number(fps), width: Number(w), height: Number(h), padding: Number(padding) }) }),
      'Vídeo montado com sucesso!',
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
    inp.value = estado.config[inp.dataset.cfg] ?? '';
  });
  $('#modal-config').hidden = false;
}

$('#btn-config').onclick = abrirConfig;
$('#btn-fechar-config').onclick = () => ($('#modal-config').hidden = true);
$('#btn-salvar-config').onclick = async () => {
  const novo = {};
  document.querySelectorAll('#modal-config [data-cfg]').forEach((inp) => (novo[inp.dataset.cfg] = inp.value));
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
    ].join('');
    card.innerHTML = `
      <h3>${esc(a.titulo_aula)}</h3>
      <div class="meta">${a.slides} slides</div>
      <div class="badges">${badges}</div>`;
    el.appendChild(card);
  }
}

$('#btn-nova-aula').onclick = async () => {
  const topico = $('#input-topico').value.trim();
  if (!topico) return toast('Digite um tópico.', true);
  const slug = slugDe(topico);
  try {
    const aulas = await api('/api/aulas');
    if (aulas.some(a => a.slug === slug)) {
      return toast(`Já existe uma aula com este tópico ("${slug}").`, true);
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
  }
  if (msg.tipo === 'fim') {
    estado.jobAtivo = false;
    sincronizarBotoes();
    if (estado.etapa === 4) setProgressoVideo(msg.ok ? 100 : 0, msg.ok ? 'Vídeo pronto!' : 'Falha na montagem');
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
  mostrarTela('dashboard');
})();
