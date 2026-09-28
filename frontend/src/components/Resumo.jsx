import React from 'react';
import { DESCRICAO_ETAPA, ETAPAS, ICONES_ETAPA, dicaProximo, statusEtapa } from '../lib.js';
import { useStudio } from '../store.jsx';

function detalheEtapa(n, artefatos, roteiro) {
  if (!artefatos) return '';
  if (n === 1) return `${roteiro?.slides?.length ?? 0} slides`;
  if (n === 2) {
    if (artefatos.imagensCompletas) return 'Todas prontas';
    const total = (artefatos.slides?.length ?? 0) + 2;
    const prontas = [artefatos.intro, ...artefatos.slides, artefatos.conclusao].filter((x) => x?.imagem?.existe).length;
    return `${prontas}/${total} prontas`;
  }
  if (n === 3) return artefatos.audioCompleto ? 'Todos os áudios prontos' : 'Faltam narrações';
  if (n === 4) return artefatos.video?.existe ? artefatos.video.arquivo : 'Não montado';
  if (n === 5) return artefatos.roteiro_short?.existe ? 'Roteiro pronto' : 'Não gerado';
  if (n === 6) return artefatos.short?.existe ? artefatos.short.arquivo : 'Não gerado';
  if (n === 7) return artefatos.pdf?.existe ? artefatos.pdf.arquivo : 'Não gerado';
  const qtd = artefatos.questionario?.perguntas?.length ?? 0;
  if (artefatos.questionario?.existe) return `Vídeo pronto · ${qtd} perguntas`;
  return qtd ? `${qtd} áudios prontos` : 'Não gerado';
}

export default function Resumo() {
  const {
    roteiro, artefatos, slug, jobAtivo, toast,
    mostrarTela, abrirEtapa, renomearAula, excluirAula,
    carregarRoteiro, carregarArtefatos,
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

  return (
    <div className="container">
      <div className="caminho">
        <button className="btn btn-ghost" onClick={() => mostrarTela('dashboard')}>← Aulas</button>
        <h2 id="titulo-aula">{roteiro.titulo_aula}</h2>
        <button className="btn btn-ghost btn-mini" title="Renomear título da aula" onClick={() => renomearAula(slug, roteiro.titulo_aula)}>✏️</button>
        <button className="btn btn-ghost btn-mini" title="Recarregar roteiro e artefatos" onClick={atualizar}>↻ Atualizar</button>
        <button className="btn btn-ghost btn-mini btn-perigo" title="Excluir esta aula" onClick={() => excluirAula(slug, roteiro?.titulo_aula)}>🗑</button>
        <div className="spacer" />
        <div id="dica-proximo" className="dica">{dicaProximo(artefatos)}</div>
      </div>

      <p className="msg-progresso">Resumo do estudo — clique num passo para abrir a tela dele. O ✓ marca a etapa já criada.</p>

      <div className="grid-passos">
        {ETAPAS.map((e) => {
          const s = statusEtapa(e.n, artefatos);
          const feito = s === 'ok';
          const parcial = s === 'alerta';
          return (
            <button
              key={e.n}
              className={`card-passo ${feito ? 'pronto' : parcial ? 'parcial' : 'pendente'}`}
              onClick={() => abrirEtapa(e.n)}
              title={`Abrir ${e.rotulo}`}
            >
              <span className="passo-topo">
                <span className="passo-icone">{ICONES_ETAPA[e.n]}</span>
                <span className={`passo-check ${feito ? 'ok' : parcial ? 'alerta' : 'pendente'}`}>
                  {feito ? '✓' : parcial ? '!' : '○'}
                </span>
              </span>
              <span className="passo-num">Passo {e.n}</span>
              <span className="passo-titulo">{e.rotulo}</span>
              <span className="passo-desc">{DESCRICAO_ETAPA[e.n]}</span>
              <span className="passo-detalhe">{detalheEtapa(e.n, artefatos, roteiro)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
