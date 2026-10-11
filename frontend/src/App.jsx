import React from 'react';
import { NOME_ETAPA } from './lib.js';
import { StudioProvider, useStudio } from './store.jsx';
import Dashboard from './components/Dashboard.jsx';
import Resumo from './components/Resumo.jsx';
import Workspace from './components/Workspace.jsx';
import TestemunhosStudio from './components/TestemunhosStudio.jsx';
import { ModalConfig, ModalLogs, ModalServicos, ModalSlide } from './components/Modals.jsx';

function Topo() {
  const { tela, mostrarTela, job, setModal, logTemErro, setLogTemErro, servicos } = useStudio();
  const rodando = job?.status === 'rodando';
  const ehTestemunhos = tela === 'testemunhos';

  return (
    <header className="topo">
      <div className="topo-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button className="brand" id="btn-inicio" title="Início" onClick={() => mostrarTela('dashboard')}>
            <span className="logo">✦</span>
            <span>Estúdio de Videoaulas</span>
          </button>

          {/* Alternador de Modo: Aulas vs Testemunhos */}
          <nav style={{ display: 'flex', gap: '6px', background: 'rgba(0,0,0,0.25)', padding: '3px', borderRadius: '8px', border: '1px solid var(--borda)' }}>
            <button
              type="button"
              className={`btn btn-ghost${!ehTestemunhos ? ' ativo' : ''}`}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                borderRadius: '6px',
                background: !ehTestemunhos ? 'var(--painel-2)' : 'transparent',
                color: !ehTestemunhos ? 'var(--ouro)' : 'var(--texto-2)',
                fontWeight: !ehTestemunhos ? '600' : 'normal',
              }}
              onClick={() => mostrarTela('dashboard')}
            >
              📖 Aulas Teológicas
            </button>
            <button
              type="button"
              className={`btn btn-ghost${ehTestemunhos ? ' ativo' : ''}`}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                borderRadius: '6px',
                background: ehTestemunhos ? 'var(--painel-2)' : 'transparent',
                color: ehTestemunhos ? 'var(--ouro)' : 'var(--texto-2)',
                fontWeight: ehTestemunhos ? '600' : 'normal',
              }}
              onClick={() => mostrarTela('testemunhos')}
            >
              🕊️ Testemunhos de Fé
            </button>
          </nav>
        </div>

        <div className="topo-acoes">
          {rodando && (
            <span className="job-topo" id="job-topo">🔄 {(NOME_ETAPA[job.etapa] || job.etapa)} em andamento</span>
          )}
          <button
            className="btn btn-ghost"
            id="btn-logs"
            title="Ver logs em tempo real"
            onClick={() => { setLogTemErro(false); setModal('logs'); }}
          >
            📋 Logs
          </button>
          <button
            className={`btn btn-ghost${servicos ? (servicos.ok ? ' ok' : ' erro') : ' carregando'}`}
            id="btn-servicos"
            title={servicos ? (servicos.ok ? 'Todos os serviços disponíveis' : 'Alguns serviços indisponíveis — clique para ver') : 'Verificando serviços…'}
            onClick={() => setModal('servicos')}
          >
            ◉ Serviços
          </button>
          <button className="btn btn-ghost" id="btn-config" title="Configurações" onClick={() => setModal('config')}>
            ⚙
          </button>
        </div>
      </div>
    </header>
  );
}

function Toast() {
  const { toastState } = useStudio();
  if (!toastState) return <div id="toast" className="toast" hidden />;
  return (
    <div id="toast" key={toastState.key} className={`toast${toastState.erro ? ' erro' : ''}`}>
      {toastState.msg}
    </div>
  );
}

function Telas() {
  const { tela, modal, modalSlideIdx } = useStudio();
  return (
    <main id="app">
      <section id="tela-dashboard" className={`tela${tela === 'dashboard' ? ' ativa' : ''}`}>
        {tela === 'dashboard' && <Dashboard />}
      </section>
      <section id="tela-resumo" className={`tela${tela === 'resumo' ? ' ativa' : ''}`}>
        {tela === 'resumo' && <Resumo />}
      </section>
      <section id="tela-aula" className={`tela${tela === 'aula' ? ' ativa' : ''}`}>
        {tela === 'aula' && <Workspace />}
      </section>
      <section id="tela-testemunhos" className={`tela${tela === 'testemunhos' ? ' ativa' : ''}`}>
        {tela === 'testemunhos' && <TestemunhosStudio />}
      </section>
      <Toast />
      {modal === 'logs' && <ModalLogs />}
      {modal === 'servicos' && <ModalServicos />}
      {modal === 'config' && <ModalConfig />}
      {modalSlideIdx != null && <ModalSlide />}
    </main>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Topo />
      <Telas />
    </StudioProvider>
  );
}
