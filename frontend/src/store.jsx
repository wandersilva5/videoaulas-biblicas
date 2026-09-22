import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, renumerarSlides } from './lib.js';

const StudioContext = createContext(null);
export const useStudio = () => useContext(StudioContext);

const LOGS_EXECUCOES_RETIDAS = 3;

// Lê a rota inicial do hash para o primeiro render já nascer na página
// certa (sem isso, o efeito de sincronização apagaria o hash no mount,
// antes do boot tentar restaurá-lo).
function lerHashInicial() {
  const m = /^#\/aula\/([a-z0-9-]+)(?:\/(\d+))?$/.exec(window.location.hash || '');
  if (!m) return { tela: 'dashboard', slug: null, etapa: 1 };
  return { tela: 'aula', slug: m[1], etapa: Math.min(8, Math.max(1, Number(m[2]) || 1)) };
}

function podarLogs(logs) {
  const vistos = [];
  for (const m of logs) {
    if (m.jobId != null && !vistos.includes(m.jobId)) vistos.push(m.jobId);
  }
  if (vistos.length <= LOGS_EXECUCOES_RETIDAS) return logs;
  const descartar = vistos.slice(0, vistos.length - LOGS_EXECUCOES_RETIDAS);
  return logs.filter((m) => m.jobId == null || !descartar.includes(m.jobId));
}

export function StudioProvider({ children }) {
  const hashInicial = useRef(null);
  if (!hashInicial.current) hashInicial.current = lerHashInicial();
  const [tela, setTela] = useState(hashInicial.current.tela);
  const [slug, setSlug] = useState(hashInicial.current.slug);
  const [roteiro, setRoteiro] = useState(null);
  const [artefatos, setArtefatos] = useState(null);
  const [aulas, setAulas] = useState([]);
  const [config, setConfig] = useState(null);
  const [servicos, setServicos] = useState(null);
  const [etapa, setEtapa] = useState(hashInicial.current.etapa);
  const [jobAtivo, setJobAtivo] = useState(false);
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logTemErro, setLogTemErro] = useState(false);
  const [logAberto, setLogAberto] = useState(false);
  const [modal, setModal] = useState(null); // null | 'logs' | 'servicos' | 'config'
  const [modalSlideIdx, setModalSlideIdx] = useState(null);
  const [toastState, setToastState] = useState(null);
  // Barras de progresso das montagens (etapa 4 = vídeo, 5/6 = short).
  const [progresso, setProgresso] = useState({ video: null, short: null });

  const toastTimer = useRef(null);
  const jobClearT = useRef(null);
  const ultimoJobIdVisto = useRef(null);
  const telaRef = useRef(tela);
  telaRef.current = tela;
  const etapaRef = useRef(etapa);
  etapaRef.current = etapa;
  const slugRef = useRef(slug);
  slugRef.current = slug;
  const jobRef = useRef(job);
  jobRef.current = job;

  const toast = useCallback((msg, erro = false) => {
    clearTimeout(toastTimer.current);
    setToastState({ msg, erro, key: Date.now() });
    toastTimer.current = setTimeout(() => setToastState(null), 4000);
  }, []);

  const adicionarLog = useCallback((msg) => {
    setLogs((ant) => podarLogs([...ant, msg]));
    if (msg.tipo === 'erro') setLogTemErro(true);
  }, []);

  const limparLogs = useCallback(() => {
    setLogs([]);
    setLogTemErro(false);
    toast('Logs limpos.');
  }, [toast]);

  const copiarLogs = useCallback(() => {
    setLogs((ant) => {
      if (!ant.length) {
        toast('Nenhum log para copiar.', true);
        return ant;
      }
      const texto = ant
        .map((m) => `[${new Date(m.ts || Date.now()).toLocaleTimeString('pt-BR')}] [${m.tipo || 'log'}] ${m.linha || m.tipo}`)
        .join('\n');
      navigator.clipboard.writeText(texto)
        .then(() => toast('Logs copiados para a área de transferência!'))
        .catch(() => toast('Não foi possível copiar os logs.', true));
      return ant;
    });
  }, [toast]);

  const carregarAulas = useCallback(async () => {
    const lista = await api('/api/aulas');
    setAulas(lista);
    return lista;
  }, []);

  const carregarRoteiro = useCallback(async (sg) => {
    const r = await api(`/api/roteiro/${sg ?? slugRef.current}`);
    setRoteiro(r);
    return r;
  }, []);

  const carregarArtefatos = useCallback(async (sg) => {
    const st = await api(`/api/artefatos/${sg ?? slugRef.current}`);
    setArtefatos(st);
    return st;
  }, []);

  const mostrarTela = useCallback((nome) => {
    setTela(nome);
    if (nome === 'dashboard') carregarAulas().catch(() => {});
  }, [carregarAulas]);

  const abrirAula = useCallback(async (sg) => {
    setSlug(sg);
    setEtapa(1);
    setLogAberto(false);
    const [r, st] = await Promise.all([
      api(`/api/roteiro/${sg}`),
      api(`/api/artefatos/${sg}`),
    ]);
    setRoteiro(r);
    setArtefatos(st);
    setTela('aula');
  }, []);

  // ---- Roteamento por hash: a URL reflete a tela atual
  // (#/ ou #/aula/<slug>/<etapa>) para que F5 e voltar/avançar
  // permaneçam na página em vez de cair na home. ----
  useEffect(() => {
    const desejado = tela === 'aula' && slug ? `#/aula/${slug}/${etapa}` : '#/';
    if (window.location.hash !== desejado) {
      window.history.replaceState(null, '', desejado);
    }
  }, [tela, slug, etapa]);

  const rotaAula = useCallback(() => {
    const m = /^#\/aula\/([a-z0-9-]+)(?:\/(\d+))?$/.exec(window.location.hash || '');
    if (!m) return null;
    return { slug: m[1], etapa: Math.min(8, Math.max(1, Number(m[2]) || 1)) };
  }, []);

  useEffect(() => {
    const aoMudarHash = () => {
      const rota = rotaAula();
      if (rota) {
        if (rota.slug !== slugRef.current) {
          abrirAula(rota.slug)
            .then(() => setEtapa(rota.etapa))
            .catch(() => mostrarTela('dashboard'));
        } else {
          setEtapa(rota.etapa);
        }
      } else if (telaRef.current !== 'dashboard') {
        mostrarTela('dashboard');
      }
    };
    window.addEventListener('hashchange', aoMudarHash);
    return () => window.removeEventListener('hashchange', aoMudarHash);
  }, [abrirAula, mostrarTela, rotaAula]);

  // ---- Aulas: renomear / excluir (com atualização de estado, sem depender só de refetch) ----
  const renomearAula = useCallback(async (sg, tituloAtual) => {
    const novoTitulo = prompt('Novo título para esta aula:', tituloAtual || '');
    if (!novoTitulo || novoTitulo.trim() === '' || novoTitulo.trim() === tituloAtual) return;
    try {
      const res = await api(`/api/aulas/${sg}/titulo`, {
        method: 'PUT',
        body: JSON.stringify({ titulo_aula: novoTitulo.trim() }),
      });
      toast('Título da aula atualizado com sucesso!');
      setAulas((ant) => ant.map((a) => (a.slug === sg ? { ...a, titulo_aula: res.titulo_aula } : a)));
      if (sg === slugRef.current) {
        setRoteiro((r) => (r ? { ...r, titulo_aula: res.titulo_aula } : r));
      }
    } catch (e) {
      toast(e.message, true);
    }
  }, [toast]);

  const excluirAula = useCallback(async (sg, titulo) => {
    if (!confirm(`Excluir a aula "${titulo || sg}"?\n\nIsso apaga o roteiro, imagens, narrações, vídeos e o PDF, além do cache de render. Essa ação não pode ser desfeita.`)) return;
    try {
      await api(`/api/aulas/${sg}`, { method: 'DELETE' });
      toast('Aula excluída.');
    } catch (e) {
      // A aula pode já ter sido excluída (card desatualizado): sincroniza mesmo assim.
      toast(e.message, true);
    }
    try {
      const lista = await api('/api/aulas');
      setAulas(lista);
    } catch {
      // Se o refetch falhar, remove ao menos o card local (correção do bug da
      // lista que não atualizava após excluir).
      setAulas((ant) => ant.filter((a) => a.slug !== sg));
    }
    if (sg === slugRef.current) {
      setSlug(null);
      setRoteiro(null);
      setArtefatos(null);
      setTela('dashboard');
    }
  }, [toast]);

  // ---- Roteiro ----
  const salvarRoteiro = useCallback(async (roteiroEditado) => {
    const r = roteiroEditado ?? roteiro;
    try {
      await api(`/api/roteiro/${slugRef.current}`, { method: 'PUT', body: JSON.stringify(r) });
      await carregarArtefatos();
      toast('Roteiro salvo. Áudios de textos alterados ficam marcados como desatualizados.');
    } catch (e) {
      toast(e.message, true);
    }
  }, [roteiro, carregarArtefatos, toast]);

  const regenerarRoteiro = useCallback(async () => {
    setJobAtivo(true);
    try {
      const res = await api('/api/roteiro', { method: 'POST', body: JSON.stringify({ topico: roteiro.topico }) });
      setSlug(res.slug);
      setRoteiro(res.roteiro);
      await carregarArtefatos(res.slug);
      setEtapa(1);
      toast('Roteiro regenerado.');
    } catch (e) {
      toast(e.message, true);
    } finally {
      setJobAtivo(false);
    }
  }, [roteiro, carregarArtefatos, toast]);

  // Solta <video>/<audio> antes de um job (Windows trava a substituição do
  // arquivo durante a remontagem se um player mantiver o handle aberto).
  const liberarPlayers = useCallback(() => {
    document.querySelectorAll('video, audio').forEach((p) => {
      try {
        p.pause();
        p.removeAttribute('src');
        p.load();
      } catch {
        /* player já morto */
      }
    });
  }, []);

  const rodarJob = useCallback(async (promise, mensagemOk) => {
    setJobAtivo(true);
    liberarPlayers();
    try {
      await promise;
      toast(mensagemOk);
      await carregarArtefatos();
    } catch (e) {
      toast(e.message, true);
    } finally {
      setJobAtivo(false);
    }
  }, [carregarArtefatos, liberarPlayers, toast]);

  const cancelarJob = useCallback(async () => {
    try {
      await api('/api/cancelar-job', { method: 'POST' });
      toast('Cancelando job em execução...');
    } catch (e) {
      toast(e.message, true);
    }
  }, [toast]);

  const carregarServicos = useCallback(async () => {
    try {
      const dados = await api('/api/health');
      setServicos(dados);
      return dados;
    } catch {
      setServicos({ ok: false, servicos: null });
      return { ok: false, servicos: null };
    }
  }, []);

  const setProgressoArea = useCallback((area, pct, texto) => {
    setProgresso((ant) => ({ ...ant, [area]: { pct, texto } }));
  }, []);

  const marcarJob = useCallback((j) => setJob(j), []);

  // ---- Sondagem do job no servidor (cobre reload no meio de um job) ----
  const verJobServidor = useCallback(async () => {
    let d;
    try {
      d = await api('/api/job');
    } catch {
      return;
    }
    if (d.ativo) {
      setJobAtivo(true);
      const atual = jobRef.current;
      if (!atual || atual.jobId !== d.jobId || atual.status !== 'rodando') {
        setJob({ jobId: d.jobId, etapa: d.etapa, status: 'rodando', msg: 'Em andamento…', iniciadoEm: d.iniciadoEm });
      }
      return;
    }
    const atual = jobRef.current;
    if (atual?.status === 'rodando') {
      const ult = d.ultimo;
      setJobAtivo(false);
      setJob({
        etapa: ult?.etapa || atual.etapa,
        status: ult ? (ult.ok ? 'ok' : 'erro') : 'erro',
        msg: ult ? (ult.ok ? 'Processo finalizado com sucesso.' : ult.cancelado ? 'Job cancelado pelo usuário.' : 'Falha na execução — veja o log.') : 'Execução encerrada.',
      });
      clearTimeout(jobClearT.current);
      jobClearT.current = setTimeout(() => setJob(null), 8000);
      if (telaRef.current === 'aula') carregarArtefatos().catch(() => {});
    } else if (!atual && d.ultimo && d.ultimo.jobId !== ultimoJobIdVisto.current) {
      ultimoJobIdVisto.current = d.ultimo.jobId;
      const ult = d.ultimo;
      setJob({
        etapa: ult.etapa,
        status: ult.ok ? 'ok' : 'erro',
        msg: ult.ok ? 'Processo finalizado com sucesso.' : ult.cancelado ? 'Job cancelado pelo usuário.' : 'Falha na execução — veja o log.',
      });
      clearTimeout(jobClearT.current);
      jobClearT.current = setTimeout(() => setJob(null), 8000);
      if (telaRef.current === 'aula') carregarArtefatos().catch(() => {});
    }
  }, [carregarArtefatos]);

  // ---- SSE /api/progresso ----
  useEffect(() => {
    const sse = new EventSource('/api/progresso');
    const onProgresso = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.tipo === 'inicio') {
        setJobAtivo(true);
        clearTimeout(jobClearT.current);
        setJob({ jobId: msg.jobId, etapa: msg.etapa, status: 'rodando', msg: 'Preparando…', iniciadoEm: msg.iniciadoEm || Date.now() });
      }
      if (msg.tipo === 'progress') {
        setJob((ant) => {
          if (ant?.etapa === msg.etapa) {
            const m = /\((\d+)%\)$/.exec(msg.linha);
            return { ...ant, status: 'rodando', msg: msg.linha, pct: m ? Number(m[1]) : ant.pct };
          }
          return ant;
        });
      }
      if (msg.tipo === 'erro') {
        setJob((ant) => (ant?.etapa === msg.etapa ? { ...ant, status: 'erro', msg: msg.linha } : ant));
        if (telaRef.current === 'aula') setLogAberto(true);
      }
      if (msg.tipo === 'log') {
        setJob((ant) => (ant?.etapa === msg.etapa ? { ...ant, status: 'rodando', msg: msg.linha } : ant));
      }
      if (msg.tipo === 'fim') {
        setJobAtivo(false);
        if (etapaRef.current === 4 || etapaRef.current === 5 || etapaRef.current === 6) {
          const area = etapaRef.current === 4 ? 'video' : 'short';
          const textoOk = etapaRef.current === 4 ? 'Vídeo pronto!' : (etapaRef.current === 5 ? 'Roteiro Short pronto!' : 'Short pronto!');
          setProgresso((ant) => ({ ...ant, [area]: { pct: msg.ok ? 100 : 0, texto: msg.ok ? textoOk : 'Falha na montagem' } }));
        }
        setJob({
          etapa: msg.etapa,
          status: msg.ok ? 'ok' : 'erro',
          msg: msg.ok ? 'Processo finalizado com sucesso.' : msg.cancelado ? 'Job cancelado pelo usuário.' : 'Falha na execução — clique em "Ver Log" para detalhes.',
        });
        if (!msg.ok && !msg.cancelado && telaRef.current === 'aula') setLogAberto(true);
        clearTimeout(jobClearT.current);
        jobClearT.current = setTimeout(() => setJob(null), 12000);
        setTimeout(() => {
          if (telaRef.current === 'aula') carregarArtefatos().catch(() => {});
        }, 400);
      }
      if ((msg.etapa === 'video' || msg.etapa === 'roteiro-short' || msg.etapa === 'short' || msg.etapa === 'questionario') && msg.tipo === 'progress') {
        const m = /\((\d+)%\)/.exec(msg.linha);
        const pct = m ? Number(m[1]) : 0;
        if (etapaRef.current === 4 && msg.etapa === 'video') {
          setProgresso((ant) => ({ ...ant, video: { pct, texto: msg.linha } }));
        }
        if (etapaRef.current === 5 && msg.etapa === 'roteiro-short') {
          setProgresso((ant) => ({ ...ant, short: { pct, texto: msg.linha } }));
        }
        if (etapaRef.current === 6 && msg.etapa === 'short') {
          setProgresso((ant) => ({ ...ant, short: { pct, texto: msg.linha } }));
        }
      }
      adicionarLog(msg);
    };
    sse.addEventListener('progresso', onProgresso);
    return () => sse.close();
  }, [adicionarLog, carregarArtefatos]);

  // ---- Boot + polling ----
  useEffect(() => {
    const timers = [];
    async function boot() {
      try {
        const cfg = await api('/api/config');
        setConfig(cfg);
      } catch {
        /* servidor ainda subindo */
      }
      carregarServicos();
      const t1 = setInterval(carregarServicos, 30000);
      try {
        const resLogs = await api('/api/logs');
        if (resLogs?.logs?.length) {
          setLogs((ant) => podarLogs([...ant, ...resLogs.logs]));
          if (resLogs.logs.some((m) => m.tipo === 'erro')) setLogTemErro(true);
        }
      } catch {
        /* sem histórico */
      }
      verJobServidor();
      const t2 = setInterval(verJobServidor, 5000);
      const t3 = setInterval(() => {
        const el = document.querySelector('.status-desde');
        if (el && jobRef.current?.status === 'rodando' && jobRef.current?.iniciadoEm) {
          const s = Math.max(0, Math.floor((Date.now() - jobRef.current.iniciadoEm) / 1000));
          el.textContent = `em andamento há ${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}`;
        }
      }, 1000);
      timers.push(t1, t2, t3);
    }
    boot();
    // Restaura a página do hash (F5 no workspace volta à mesma aula/etapa).
    const rotaInicial = rotaAula();
    if (rotaInicial) {
      abrirAula(rotaInicial.slug)
        .then(() => setEtapa(rotaInicial.etapa))
        .catch(() => mostrarTela('dashboard'));
    } else {
      mostrarTela('dashboard');
    }
    return () => timers.forEach(clearInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({
    tela, slug, roteiro, artefatos, aulas, config, servicos, etapa, jobAtivo, job,
    logs, logTemErro, logAberto, modal, modalSlideIdx, toastState, progresso,
    setEtapa, setRoteiro, setModal, setModalSlideIdx, setLogAberto, setLogTemErro,
    setProgressoArea, marcarJob,
    toast, carregarAulas, carregarRoteiro, carregarArtefatos, mostrarTela, abrirAula,
    renomearAula, excluirAula, salvarRoteiro, regenerarRoteiro, rodarJob, cancelarJob,
    carregarServicos, verJobServidor, adicionarLog, limparLogs, copiarLogs,
    renumerar: () => setRoteiro((r) => (r ? renumerarSlides({ ...r, slides: [...r.slides] }) : r)),
  }), [
    tela, slug, roteiro, artefatos, aulas, config, servicos, etapa, jobAtivo, job,
    logs, logTemErro, logAberto, modal, modalSlideIdx, toastState, progresso,
    toast, carregarAulas, carregarRoteiro, carregarArtefatos, mostrarTela, abrirAula,
    renomearAula, excluirAula, salvarRoteiro, regenerarRoteiro, rodarJob, cancelarJob,
    carregarServicos, verJobServidor, adicionarLog, limparLogs, copiarLogs, setProgressoArea, marcarJob,
  ]);

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
