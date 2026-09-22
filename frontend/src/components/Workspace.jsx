import React, { useEffect, useState } from 'react';
import { ETAPAS, NOME_ETAPA, dicaProximo, statusEtapa, tempoDesde } from '../lib.js';
import { useStudio } from '../store.jsx';
import {
  EtapaImagens, EtapaNarracao, EtapaPdf, EtapaQuestionario,
  EtapaRoteiro, EtapaRoteiroShort, EtapaShort, EtapaVideo,
} from './Etapas.jsx';

function Stepper() {
  const { etapa, artefatos, setEtapa } = useStudio();
  return (
    <nav className="stepper" id="stepper">
      {ETAPAS.map((e) => {
        const s = statusEtapa(e.n, artefatos);
        const icone = s === 'ok' ? '✓' : s === 'alerta' ? '!' : '○';
        return (
          <button
            key={e.n}
            className={`passo${etapa === e.n ? ' ativo' : ''}`}
            onClick={() => setEtapa(e.n)}
          >
            <span className="num">{e.n}</span>
            <span className="rotulo">{e.rotulo}</span>
            <span className={`status-dot ${s}`}>{icone}</span>
          </button>
        );
      })}
    </nav>
  );
}

function StatusJob() {
  const { job, cancelarJob, setLogAberto, tela, setModal } = useStudio();
  if (!job) return null;
  const rotulo = NOME_ETAPA[job.etapa] || job.etapa;
  const icone = job.status === 'ok' ? '✓' : job.status === 'erro' ? '✕' : '🔄';
  const statusTexto = job.status === 'ok'
    ? `${rotulo} concluída com sucesso`
    : job.status === 'erro' ? `${rotulo} falhou` : `${rotulo} em andamento`;
  return (
    <div id="status-job" className={`status-job ${job.status}`}>
      <span className="status-icone">{icone}</span>
      <div className="status-texto">
        <strong>{statusTexto}</strong>
        <span>{job.msg || ''}</span>
        {job.status === 'rodando' && job.iniciadoEm && (
          <span className="status-desde">em andamento há {tempoDesde(job.iniciadoEm)}</span>
        )}
        {job.pct != null && (
          <div className="barra-progresso status-barra">
            <div style={{ width: `${Math.max(0, Math.min(100, job.pct))}%` }} />
          </div>
        )}
      </div>
      {job.status === 'rodando' && (
        <button className="btn btn-ghost btn-mini status-cancelar" title="Cancelar este job" onClick={cancelarJob}>
          ✕ Cancelar
        </button>
      )}
      {job.status === 'erro' && (
        <button
          className="btn btn-ghost btn-mini status-ver-log"
          title="Ver detalhes do erro no log"
          onClick={() => { if (tela === 'aula') setLogAberto(true); else setModal('logs'); }}
        >
          📋 Ver Log
        </button>
      )}
    </div>
  );
}

function PainelLog() {
  const { logs, logAberto, setLogAberto, limparLogs, copiarLogs } = useStudio();
  return (
    <section className="painel-log">
      <div className="painel-log-topo">
        <button
          className="btn btn-ghost"
          id="btn-toggle-log"
          onClick={() => setLogAberto((v) => !v)}
        >
          {logAberto ? '▴ Log das etapas' : '▾ Log das etapas'}
        </button>
        <div className="painel-log-acoes">
          <button className="btn btn-ghost btn-mini" title="Copiar logs para a área de transferência" onClick={copiarLogs}>
            📋 Copiar
          </button>
          <button className="btn btn-ghost btn-mini" onClick={limparLogs}>Limpar</button>
        </div>
      </div>
      {logAberto && (
        <LogLinhas
          id="log-linhas"
          className="log-linhas aberto"
          logs={logs}
        />
      )}
    </section>
  );
}

export function LogLinhas({ id, className, logs }) {
  return (
    <div
      id={id}
      className={className}
      ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
    >
      {logs.map((m, i) => (
        <div className={`log-linha ${m.tipo || 'log'}`} key={`${m.ts}-${i}`}>
          <span className="hora">{new Date(m.ts || Date.now()).toLocaleTimeString('pt-BR')}</span>
          {m.linha || m.tipo}
        </div>
      ))}
    </div>
  );
}

function BotaoFlutuarSalvar() {
  const { etapa, salvarRoteiro } = useStudio();
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (etapa !== 1) {
      setVisivel(false);
      return;
    }
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const topo = document.querySelector('.etapa-topo');
        if (!topo) {
          setVisivel(false);
          return;
        }
        setVisivel(topo.getBoundingClientRect().bottom < 70);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [etapa]);

  if (!visivel) return null;
  return (
    <button className="btn-flutuar-salvar" title="Salvar alterações do roteiro" onClick={() => salvarRoteiro()}>
      💾 Salvar
    </button>
  );
}

export default function Workspace() {
  const {
    etapa, roteiro, artefatos, jobAtivo, toast,
    mostrarTela, renomearAula, excluirAula, carregarRoteiro, carregarArtefatos,
    slug, setEtapa,
  } = useStudio();

  if (!roteiro || !artefatos) return null;

  const atualizar = async () => {
    if (jobAtivo) {
      toast('Aguarde o job atual terminar.', true);
      return;
    }
    try {
      await Promise.all([carregarRoteiro(), carregarArtefatos()]);
      toast('Aula atualizada.');
    } catch (e) {
      toast(e.message, true);
    }
  };

  const excluir = async () => {
    if (jobAtivo) {
      toast('Aguarde o job atual terminar.', true);
      return;
    }
    await excluirAula(slug, roteiro?.titulo_aula);
  };

  return (
    <div className="workspace">
      <Stepper />
      <div className="conteudo">
        <div className="caminho">
          <button className="btn btn-ghost" id="btn-voltar" onClick={() => mostrarTela('dashboard')}>← Aulas</button>
          <h2 id="titulo-aula">{roteiro.titulo_aula}</h2>
          <button className="btn btn-ghost btn-mini" title="Renomear título da aula" onClick={() => renomearAula(slug, roteiro.titulo_aula)}>✏️</button>
          <button className="btn btn-ghost btn-mini" title="Recarregar roteiro e artefatos" onClick={atualizar}>↻ Atualizar</button>
          <button className="btn btn-ghost btn-mini btn-perigo" title="Excluir esta aula" onClick={excluir}>🗑</button>
          <div className="spacer" />
          <div id="dica-proximo" className="dica">{dicaProximo(artefatos)}</div>
        </div>
        <StatusJob />
        <div id="etapa-container">
          {etapa === 1 && <EtapaRoteiro />}
          {etapa === 2 && <EtapaImagens />}
          {etapa === 3 && <EtapaNarracao />}
          {etapa === 4 && <EtapaVideo />}
          {etapa === 5 && <EtapaRoteiroShort />}
          {etapa === 6 && <EtapaShort />}
          {etapa === 7 && <EtapaPdf />}
          {etapa === 8 && <EtapaQuestionario />}
        </div>
        <PainelLog />
      </div>
      <BotaoFlutuarSalvar />
    </div>
  );
}
