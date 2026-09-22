import React, { useEffect, useState } from 'react';
import { api, CFG_FIELDS, ORDEM_SERVICOS, itensImagem, urlImagem } from '../lib.js';
import { useStudio } from '../store.jsx';
import { LogLinhas } from './Workspace.jsx';

function Janela({ titulo, subtitulo, onFechar, larga, children, acoes }) {
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className={`modal-janela${larga ? ' modal-janela-larga' : ''}`}>
        <h3>{titulo}</h3>
        {subtitulo && <p className="modal-subtitulo">{subtitulo}</p>}
        {children}
        <div className="modal-acoes">
          {acoes}
          <button className="btn btn-ghost" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export function ModalLogs() {
  const { logs, setModal, limparLogs, copiarLogs } = useStudio();
  return (
    <div id="modal-logs" className="modal" onClick={(e) => { if (e.target.id === 'modal-logs') setModal(null); }}>
      <div className="modal-janela modal-janela-larga">
        <div className="modal-header-flex">
          <h3>Logs do Sistema</h3>
          <div className="painel-log-acoes">
            <button className="btn btn-ghost btn-mini" title="Copiar logs" onClick={copiarLogs}>📋 Copiar</button>
            <button className="btn btn-ghost btn-mini" onClick={limparLogs}>Limpar</button>
          </div>
        </div>
        <p className="modal-subtitulo">Acompanhe a saída dos comandos e diagnósticos em tempo real.</p>
        <LogLinhas id="log-linhas-modal" className="log-linhas aberto log-modal-conteudo" logs={logs} />
        <div className="modal-acoes">
          <button className="btn btn-ghost" onClick={() => setModal(null)}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export function ModalServicos() {
  const { servicos, setModal, carregarServicos } = useStudio();
  const [verificando, setVerificando] = useState(false);

  const s = servicos;
  return (
    <div id="modal-servicos" className="modal" onClick={(e) => { if (e.target.id === 'modal-servicos') setModal(null); }}>
      <div className="modal-janela">
        <h3>Serviços</h3>
        <p className="modal-subtitulo">Verifique os pré-requisitos do pipeline antes de rodar as etapas.</p>
        <div id="lista-servicos" className="servicos">
          {!s?.servicos ? (
            <div className="servico-item carregando"><span className="servico-status">…</span><span className="servico-nome">Verificando…</span></div>
          ) : (
            <>
              {ORDEM_SERVICOS.map((k) => {
                const v = s.servicos[k];
                if (!v) return null;
                const detalhe = v.ok ? (v.versao || 'ok') : (v.erro || 'indisponível');
                return (
                  <div key={k} className={`servico-item ${v.ok ? 'ok' : 'erro'}`}>
                    <span className="servico-status">{v.ok ? '✓' : '✕'}</span>
                    <div className="servico-info">
                      <span className="servico-nome">{v.rotulo || k}</span>
                      <span className="servico-detalhe">{detalhe}</span>
                    </div>
                  </div>
                );
              })}
              <p className="servico-resumo">{s.ok ? 'Tudo pronto para rodar o pipeline.' : 'Alguns pré-requisitos estão indisponíveis.'}</p>
            </>
          )}
        </div>
        <div className="modal-acoes">
          <button className="btn btn-ghost" onClick={() => setModal(null)}>Fechar</button>
          <button
            className="btn btn-primario"
            disabled={verificando}
            onClick={async () => { setVerificando(true); await carregarServicos(); setVerificando(false); }}
          >
            ↻ Verificar novamente
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModalConfig() {
  const { setModal, toast } = useStudio();
  const [form, setForm] = useState(null);

  useEffect(() => {
    api('/api/config').then(setForm).catch((e) => toast(e.message, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const salvar = async () => {
    try {
      await api('/api/config', { method: 'PUT', body: JSON.stringify(form) });
      setModal(null);
      toast('Configurações salvas.');
    } catch (e) {
      toast(e.message, true);
    }
  };

  return (
    <div id="modal-config" className="modal" onClick={(e) => { if (e.target.id === 'modal-config') setModal(null); }}>
      <div className="modal-janela">
        <h3>Configurações</h3>
        {form ? CFG_FIELDS.map((f) => {
          if (f.tipo === 'select') {
            return (
              <label key={f.k}>{f.rotulo}
                <select value={form[f.k] ?? ''} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}>
                  {f.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            );
          }
          if (f.tipo === 'check') {
            const checked = form[f.k] === '1' || form[f.k] === true || form[f.k] === 1;
            return (
              <label key={f.k} className="cfg-check">
                <input type="checkbox" checked={checked} onChange={(e) => setForm({ ...form, [f.k]: e.target.checked ? '1' : '' })} /> {f.rotulo}
              </label>
            );
          }
          return (
            <label key={f.k}>{f.rotulo}
              <input
                type={f.tipo}
                value={form[f.k] ?? ''}
                min={f.min}
                step={f.step}
                onChange={(e) => setForm({ ...form, [f.k]: e.target.value })}
              />
            </label>
          );
        }) : <p className="msg-progresso">Carregando…</p>}
        <div className="modal-acoes">
          <button className="btn btn-ghost" onClick={() => setModal(null)}>Fechar</button>
          <button className="btn btn-primario" onClick={salvar} disabled={!form}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

export function ModalSlide() {
  const { artefatos, slug, modalSlideIdx, setModalSlideIdx } = useStudio();
  const itens = itensImagem(artefatos);

  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Escape') setModalSlideIdx(null);
      else if (ev.key === 'ArrowLeft') setModalSlideIdx((i) => (i == null ? i : (i - 1 + itens.length) % itens.length));
      else if (ev.key === 'ArrowRight') setModalSlideIdx((i) => (i == null ? i : (i + 1) % itens.length));
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (modalSlideIdx == null || !itens.length) return null;
  const idx = ((modalSlideIdx % itens.length) + itens.length) % itens.length;
  const s = itens[idx];

  return (
    <div id="modal-slide" className="modal modal-slide" onClick={(e) => { if (e.target.id === 'modal-slide') setModalSlideIdx(null); }}>
      <button className="slide-fechar" title="Fechar (Esc)" onClick={() => setModalSlideIdx(null)}>✕</button>
      <button className="slide-nav nav-anterior" title="Anterior (←)" onClick={() => setModalSlideIdx((idx - 1 + itens.length) % itens.length)}>‹</button>
      <figure className="modal-slide-fig">
        <img id="modal-slide-img" src={urlImagem(slug, s.arquivo, s.imagem.mtime)} alt={s.titulo || ''} />
        <figcaption>
          <span id="modal-slide-contador" className="slide-contador">{idx + 1} / {itens.length}</span>
          <span id="modal-slide-titulo" className="slide-titulo">{s.titulo || ''}</span>
        </figcaption>
      </figure>
      <button className="slide-nav nav-proximo" title="Próximo (→)" onClick={() => setModalSlideIdx((idx + 1) % itens.length)}>›</button>
    </div>
  );
}

export { Janela };
