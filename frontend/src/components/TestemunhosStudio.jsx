import React, { useState, useEffect, useRef } from 'react';
import { api, servicoOk } from '../lib.js';
import { useStudio } from '../store.jsx';

function estimarDuracaoMinutos(texto) {
  if (!texto) return '0 min';
  const palavras = texto.trim().split(/\s+/).filter(Boolean).length;
  const minutos = (palavras / 140).toFixed(1);
  return `~${minutos} min (${palavras} palavras)`;
}

const DESCRICAO_PROJETO = `Testemunhos de Fé é um projeto dedicado a dar voz a histórias reais de fé, superação e recomeço. Aqui, cada relato é tratado com respeito, fidelidade e sobriedade — sem exageros e sem espetáculo, apenas a verdade do que Deus fez na vida de pessoas comuns.

Todos os vídeos são produzidos de forma independente: roteiro fiel ao relato original, imagens ilustrativas, narração contínua e trilha reflexiva. Nosso compromisso é levar esperança a quem precisa ouvir que não está sozinho.

Inscreva-se no canal, ative o sininho e acompanhe um novo testemunho por semana. Se você também tem uma história para contar, envie seu relato — ele pode encorajar alguém que está passando pelo mesmo caminho.

#TestemunhoDeFé #Fé #Esperança #Superação #HistóriasReais #FéEmDeus`;

function BlocoDescricaoYouTube({ onCopiar }) {
  return (
    <div style={{ borderTop: '1px solid var(--borda)', marginTop: '20px', paddingTop: '16px', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '14px' }}>
        <div>
          <h4 style={{ fontSize: '15px', color: 'var(--ouro)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>▶️</span> Sobre o Projeto — Descrição para o YouTube
          </h4>
          <p style={{ fontSize: '12px', color: 'var(--texto-3)' }}>
            Texto institucional do canal, pronto para colar na descrição do canal ou dos vídeos publicados.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCopiar}
          style={{
            border: '1px solid var(--borda)',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '13px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          📋 Copiar descrição
        </button>
      </div>

      <div>
        {DESCRICAO_PROJETO.split('\n\n').map((paragrafo, i) => {
          const hashtags = paragrafo.startsWith('#');
          return (
            <p
              key={i}
              style={{
                fontSize: hashtags ? '13px' : '14px',
                color: hashtags ? 'var(--ouro)' : 'var(--texto-2)',
                lineHeight: '1.6',
                margin: 0,
                marginBottom: hashtags ? 0 : '12px',
              }}
            >
              {paragrafo}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export default function TestemunhosStudio() {
  const { toast, servicos, job, imgsGerando, cancelarJob, slugTestemunho, setSlugTestemunho } = useStudio();
  const [testemunhos, setTestemunhos] = useState([]);
  const [carregandoLista, setCarregandoLista] = useState(false);
  const [slugSelecionado, setSlugSelecionado] = useState(null);
  const [dadosTestemunho, setDadosTestemunho] = useState(null);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);

  // Formulário de novo testemunho
  const [titulo, setTitulo] = useState('');
  const [textoRelato, setTextoRelato] = useState('');
  const [formato, setFormato] = useState('16:9');
  const [criandoRoteiro, setCriandoRoteiro] = useState(false);
  const fileInputRef = useRef(null);

  // Modal Lightbox da Imagem (índice na lista achatada de todas as imagens)
  const [lightboxIdx, setLightboxIdx] = useState(null);

  // Edição inline de cenas: { [cenaId]: { narracao, imagens: [prompt, ...] } }
  const [edicoes, setEdicoes] = useState({});
  const [promptsAbertos, setPromptsAbertos] = useState({});
  const [salvandoCenas, setSalvandoCenas] = useState(false);

  // Variáveis calculadas do status de processamento
  const jobRodando = job?.status === 'rodando';
  const jobEtapa = job?.etapa;
  const gerandoImagens = jobRodando && jobEtapa === 'imagens_testemunho';
  const gerandoVozes = jobRodando && jobEtapa === 'narracao_testemunho';
  const montandoVideo = jobRodando && jobEtapa === 'video_testemunho';
  const gerandoRoteiro = jobRodando && jobEtapa === 'roteiro_testemunho';
  const percentualJob = job?.pct != null ? job.pct : null;

  const carregarTestemunhos = async () => {
    setCarregandoLista(true);
    try {
      const lista = await api('/api/testemunhos');
      setTestemunhos(lista);
    } catch (e) {
      toast(`Falha ao listar testemunhos: ${e.message}`, true);
    } finally {
      setCarregandoLista(false);
    }
  };

  const abrirTestemunho = async (slug) => {
    setSlugSelecionado(slug);
    setSlugTestemunho(slug); // atualiza URL para #/testemunhos/<slug>
    setCarregandoDetalhes(true);
    try {
      const dados = await api(`/api/testemunhos/${slug}`);
      setDadosTestemunho(dados);
      // Prepara estado de edições (narração + lista de prompts de imagem da cena)
      const map = {};
      dados.cenas.forEach((c) => {
        const prompts = c.imagens?.length
          ? c.imagens.map((i) => i.prompt)
          : c.imagem_prompt
            ? [c.imagem_prompt]
            : [];
        map[c.id] = { narracao: c.narracao, imagens: prompts };
      });
      setEdicoes(map);
    } catch (e) {
      toast(`Erro ao abrir testemunho: ${e.message}`, true);
    } finally {
      setCarregandoDetalhes(false);
    }
  };

  useEffect(() => {
    carregarTestemunhos();
    // Se o F5 trouxe um slug no hash (#/testemunhos/<slug>), abre o projeto automaticamente.
    if (slugTestemunho) {
      abrirTestemunho(slugTestemunho);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recarrega dados quando um job termina ou quando uma imagem individual é gerada
  useEffect(() => {
    if (job?.status === 'ok' && slugSelecionado) {
      abrirTestemunho(slugSelecionado);
      carregarTestemunhos();
    }
  }, [job]);

  const importarTxt = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const conteudo = String(evt.target?.result || '');
      setTextoRelato(conteudo);
      if (!titulo.trim()) {
        const nomeSemExt = file.name.replace(/\.[^/.]+$/, '');
        setTitulo(nomeSemExt);
      }
      toast(`Arquivo "${file.name}" carregado (${conteudo.length} caracteres)`);
    };
    reader.onerror = () => toast('Erro ao ler o arquivo .txt', true);
    reader.readAsText(file, 'utf-8');
  };

  const criarTestemunho = async () => {
    if (!textoRelato.trim()) {
      toast('Insira o relato em texto ou anexe um arquivo .txt.', true);
      return;
    }
    if (servicos && !servicoOk(servicos, 'llama')) {
      toast('llama-server indisponível. Inicie o serviço para gerar o roteiro.', true);
      return;
    }
    setCriandoRoteiro(true);
    try {
      const res = await api('/api/testemunhos/roteiro', {
        method: 'POST',
        body: JSON.stringify({
          titulo: titulo.trim() || 'Testemunho de Fé',
          texto: textoRelato.trim(),
          formato,
        }),
      });
      toast('Roteiro gerado! Cenas disponíveis na Tela Única.');
      setTitulo('');
      setTextoRelato('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await carregarTestemunhos();
      if (res.slug) await abrirTestemunho(res.slug);
    } catch (e) {
      toast(e.message, true);
    } finally {
      setCriandoRoteiro(false);
    }
  };

  const salvarAlteracoesCenas = async () => {
    if (!dadosTestemunho) return;
    setSalvandoCenas(true);
    try {
      const roteiroAtualizado = {
        ...dadosTestemunho.roteiro,
        cenas: dadosTestemunho.roteiro.cenas.map((c) => {
          const imagens = (edicoes[c.id]?.imagens ?? []).map((p) => String(p || '').trim()).filter(Boolean);
          return {
            ...c,
            narracao: edicoes[c.id]?.narracao ?? c.narracao,
            imagens,
            // Compat: o primeiro prompt continua espelhado em imagem_prompt.
            imagem_prompt: imagens[0] || '',
          };
        }),
      };
      await api(`/api/testemunhos/${dadosTestemunho.slug}/roteiro`, {
        method: 'PUT',
        body: JSON.stringify(roteiroAtualizado),
      });
      toast('Textos das cenas salvos com sucesso!');
      await abrirTestemunho(dadosTestemunho.slug);
    } catch (e) {
      toast(`Erro ao salvar cenas: ${e.message}`, true);
    } finally {
      setSalvandoCenas(false);
    }
  };

  const gerarTodasImagens = async () => {
    if (!dadosTestemunho || jobRodando) return;
    if (servicos && !servicoOk(servicos, 'comfy')) {
      toast('ComfyUI indisponível. Inicie o serviço para gerar imagens.', true);
      return;
    }
    try {
      await api(`/api/testemunhos/${dadosTestemunho.slug}/imagens`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast('Geração de imagens iniciada...');
    } catch (e) {
      toast(e.message, true);
    }
  };

  // Prompts editados de uma cena (fallback para o que veio do servidor).
  const promptsDaCena = (c) =>
    edicoes[c.id]?.imagens ??
    (c.imagens?.length ? c.imagens.map((i) => i.prompt) : c.imagem_prompt ? [c.imagem_prompt] : []);

  const setPromptImagem = (cenaId, idx, valor) => {
    setEdicoes((prev) => {
      const atuais = [...(prev[cenaId]?.imagens ?? [])];
      while (atuais.length <= idx) atuais.push('');
      atuais[idx] = valor;
      return { ...prev, [cenaId]: { ...prev[cenaId], imagens: atuais } };
    });
  };

  const adicionarImagem = (cenaId) => {
    setEdicoes((prev) => {
      const atuais = [...(prev[cenaId]?.imagens ?? [])];
      return { ...prev, [cenaId]: { ...prev[cenaId], imagens: [...atuais, ''] } };
    });
    toast('Imagem adicionada à cena. Escreva o prompt (em inglês), salve os textos e clique em Gerar.');
  };

  const removerImagem = async (cenaId, arquivo) => {
    if (!dadosTestemunho) return;
    try {
      await api(`/api/testemunhos/${dadosTestemunho.slug}/imagens`, {
        method: 'DELETE',
        body: JSON.stringify({ arquivo }),
      });
      toast(`Imagem ${arquivo} removida.`);
      await abrirTestemunho(dadosTestemunho.slug);
    } catch (e) {
      toast(e.message, true);
    }
  };

  // Regenera uma imagem avulsa (cena-01-img-02). Salva o roteiro antes para
  // garantir que um prompt recém-editado vá para o ComfyUI.
  const gerarImagemCena = async (cenaId, arquivo) => {
    if (!dadosTestemunho || jobRodando) return;
    const idx = Number(/-img-(\d+)$/.exec(arquivo)?.[1] || 1) - 1;
    const promptAtual = String(promptsDaCena({ id: cenaId })[idx] || '').trim();
    if (!promptAtual) {
      toast('Escreva o prompt (em inglês) desta imagem antes de gerar.', true);
      return;
    }
    try {
      await salvarAlteracoesCenas();
      await api(`/api/testemunhos/${dadosTestemunho.slug}/imagens`, {
        method: 'POST',
        body: JSON.stringify({ cenaId: arquivo }),
      });
      toast(`Regenerando ${arquivo}...`);
    } catch (e) {
      toast(e.message, true);
    }
  };

  const gerarTodasVozes = async () => {
    if (!dadosTestemunho || jobRodando) return;
    try {
      await api(`/api/testemunhos/${dadosTestemunho.slug}/narracao`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast('Geração de narração iniciada...');
    } catch (e) {
      toast(e.message, true);
    }
  };

  const gerarVozCena = async (cenaId) => {
    if (!dadosTestemunho || jobRodando) return;
    try {
      await api(`/api/testemunhos/${dadosTestemunho.slug}/narracao`, {
        method: 'POST',
        body: JSON.stringify({ cenaId }),
      });
      toast(`Regenerando narração da ${cenaId}...`);
    } catch (e) {
      toast(e.message, true);
    }
  };

  const montarVideoFinal = async () => {
    if (!dadosTestemunho || jobRodando) return;
    if (!dadosTestemunho.imagensCompletas) {
      toast('Gere todas as imagens antes de montar o vídeo final.', true);
      return;
    }
    if (!dadosTestemunho.audiosCompletos) {
      toast('Gere todos os áudios antes de montar o vídeo final.', true);
      return;
    }
    try {
      await api(`/api/testemunhos/${dadosTestemunho.slug}/video`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast('Montagem do vídeo iniciada...');
    } catch (e) {
      toast(e.message, true);
    }
  };

  const excluirTestemunho = async (slug, e) => {
    e?.stopPropagation();
    if (!window.confirm(`Deseja realmente excluir o testemunho "${slug}"?`)) return;
    try {
      await api(`/api/testemunhos/${slug}`, { method: 'DELETE' });
      toast('Testemunho excluído.');
      if (slugSelecionado === slug) {
        setSlugSelecionado(null);
        setSlugTestemunho(null); // limpa o hash para #/testemunhos
        setDadosTestemunho(null);
      }
      carregarTestemunhos();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const copiarDescricaoProjeto = async () => {
    try {
      await navigator.clipboard.writeText(DESCRICAO_PROJETO);
      toast('Descrição do projeto copiada para a área de transferência!');
    } catch (e) {
      toast('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.', true);
    }
  };

  // Helper para verificar se uma cena específica está em processamento
  const isImagemGerando = (arquivo) => {
    const chave = String(arquivo).toLowerCase();
    if (imgsGerando?.[chave]) return true;
    if (gerandoImagens && String(job?.msg || '').toLowerCase().includes(chave)) return true;
    return false;
  };

  const isCenaGerandoImagem = (cenaId) =>
    (dadosTestemunho?.cenas?.find((c) => c.id === cenaId)?.imagens || []).some((i) => isImagemGerando(i.arquivo));

  const isCenaGerandoAudio = (cenaId) => {
    if (gerandoVozes && (job?.msg?.includes(cenaId) || job?.msg?.toLowerCase().includes(cenaId.replace('-', ' ')))) return true;
    return false;
  };

  // Lista achatada de todas as imagens prontas (lightbox com setas ←/→).
  const galeria = React.useMemo(
    () =>
      (dadosTestemunho?.cenas || []).flatMap((c) =>
        (c.imagens || [])
          .filter((i) => i.existe)
          .map((i) => ({ url: i.url, titulo: `${c.titulo_cena || c.id} · imagem ${i.idx}` })),
      ),
    [dadosTestemunho],
  );

  useEffect(() => {
    if (lightboxIdx == null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      else if (e.key === 'ArrowRight') setLightboxIdx((i) => (galeria.length ? (i + 1) % galeria.length : null));
      else if (e.key === 'ArrowLeft') setLightboxIdx((i) => (galeria.length ? (i - 1 + galeria.length) % galeria.length : null));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIdx, galeria.length]);

  return (
    <div className="testemunhos-container" style={{ padding: '24px 0', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Lightbox Modal (com navegação ←/→ e Esc) */}
      {lightboxIdx != null && galeria[lightboxIdx] && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.88)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setLightboxIdx(null)}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <img
              src={galeria[lightboxIdx].url}
              alt={galeria[lightboxIdx].titulo}
              style={{
                width: '100%',
                maxHeight: '78vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              }}
            />
            <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#eef3f9', gap: '16px' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setLightboxIdx((i) => (i - 1 + galeria.length) % galeria.length)}
                style={{ border: '1px solid var(--borda)', borderRadius: '6px', padding: '6px 14px' }}
                title="Imagem anterior (←)"
              >
                ←
              </button>
              <span style={{ fontSize: '13px' }}>
                {galeria[lightboxIdx].titulo} — {lightboxIdx + 1} / {galeria.length}
              </span>
              <button
                className="btn btn-ghost"
                onClick={() => setLightboxIdx((i) => (i + 1) % galeria.length)}
                style={{ border: '1px solid var(--borda)', borderRadius: '6px', padding: '6px 14px' }}
                title="Próxima imagem (→)"
              >
                →
              </button>
            </div>
            <div style={{ marginTop: '8px', textAlign: 'center' }}>
              <button className="btn btn-ghost" onClick={() => setLightboxIdx(null)}>✕ Fechar (Esc)</button>
            </div>
          </div>
        </div>
      )}

      {/* Visão de Lista / Novo quando nenhum estiver aberto */}
      {!slugSelecionado ? (
        <div>
          <div style={{ marginBottom: '28px', borderBottom: '1px solid var(--borda)', paddingBottom: '20px' }}>
            <h1 style={{ fontSize: '28px', color: 'var(--ouro)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🕊️</span> Testemunhos de Fé
            </h1>
            <p style={{ color: 'var(--texto-2)', fontSize: '15px' }}>
              Criação independente de histórias reais com narrativa adulta, gancho de 3 segundos, imagens minimalistas e narração contínua.
            </p>
          </div>

          {/* Banner de Processamento Geral se houver job rodando */}
          {jobRodando && (
            <div
              style={{
                background: 'linear-gradient(90deg, rgba(224, 180, 90, 0.15) 0%, rgba(17, 28, 46, 0.95) 100%)',
                border: '1px solid var(--ouro)',
                borderRadius: 'var(--raio)',
                padding: '16px 20px',
                marginBottom: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontSize: '22px', animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>🔄</span>
                <div>
                  <strong style={{ color: 'var(--ouro)', fontSize: '14px' }}>
                    Processamento em andamento ({jobEtapa})
                  </strong>
                  <p style={{ color: '#fff', fontSize: '13px', margin: '4px 0 0 0' }}>{job?.msg || 'Executando...'}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={cancelarJob}
                style={{ color: 'var(--erro)', border: '1px solid var(--erro)', borderRadius: '6px', fontSize: '12px', padding: '6px 14px' }}
              >
                ✕ Cancelar
              </button>
            </div>
          )}

          {/* Card de Criação */}
          <div className="card" style={{ background: 'var(--painel)', padding: '24px', borderRadius: 'var(--raio)', border: '1px solid var(--borda)', marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', color: 'var(--ouro)', marginBottom: '16px' }}>✦ Novo Testemunho</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--texto-2)' }}>Título / Identificador</label>
                <input
                  type="text"
                  className="form-input"
                  style={{ width: '100%', padding: '10px 14px', background: 'var(--painel-2)', border: '1px solid var(--borda)', borderRadius: '8px', color: '#fff' }}
                  placeholder='Ex.: "O Milagre da Madrugada"'
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--texto-2)' }}>Formato do Vídeo</label>
                <select
                  style={{ width: '100%', padding: '10px 14px', background: 'var(--painel-2)', border: '1px solid var(--borda)', borderRadius: '8px', color: '#fff' }}
                  value={formato}
                  onChange={(e) => setFormato(e.target.value)}
                >
                  <option value="16:9">16:9 (Widescreen)</option>
                  <option value="9:16">9:16 (Shorts/Reels)</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ fontSize: '13px', color: 'var(--texto-2)' }}>Relato Real (Texto ou arquivo .txt)</label>
                <span style={{ fontSize: '12px', color: 'var(--ouro)' }}>{estimarDuracaoMinutos(textoRelato)}</span>
              </div>
              <textarea
                rows={6}
                style={{ width: '100%', padding: '12px', background: 'var(--painel-2)', border: '1px solid var(--borda)', borderRadius: '8px', color: '#fff', resize: 'vertical' }}
                placeholder="Cole aqui o relato real do testemunho ou use o botão abaixo para anexar um arquivo .txt..."
                value={textoRelato}
                onChange={(e) => setTextoRelato(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <input
                  type="file"
                  accept=".txt"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  onChange={importarTxt}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ padding: '8px 16px', border: '1px solid var(--borda)', borderRadius: '8px' }}
                >
                  📁 Anexar Arquivo .txt
                </button>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                disabled={criandoRoteiro || gerandoRoteiro}
                onClick={criarTestemunho}
                style={{ background: 'var(--ouro)', color: '#0b1320', fontWeight: 'bold', padding: '10px 24px', borderRadius: '8px', border: 'none', opacity: (criandoRoteiro || gerandoRoteiro) ? 0.7 : 1 }}
              >
                {criandoRoteiro || gerandoRoteiro ? '⏳ Gerando Roteiro…' : '✨ Criar Roteiro de Cenas'}
              </button>
            </div>
          </div>

          {/* Lista de Testemunhos Existentes */}
          <div>
            <h2 style={{ fontSize: '18px', color: 'var(--texto)', marginBottom: '16px' }}>Testemunhos Criados ({testemunhos.length})</h2>
            {carregandoLista ? (
              <p style={{ color: 'var(--texto-3)' }}>Carregando testemunhos…</p>
            ) : testemunhos.length === 0 ? (
              <p style={{ color: 'var(--texto-3)' }}>Nenhum testemunho criado ainda. Use o formulário acima para criar o primeiro!</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
                {testemunhos.map((t) => (
                  <div
                    key={t.slug}
                    className="card"
                    style={{
                      background: 'var(--painel)',
                      borderRadius: 'var(--raio)',
                      border: '1px solid var(--borda)',
                      padding: '16px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      transition: 'transform 0.15s ease, border-color 0.15s ease',
                    }}
                    onClick={() => abrirTestemunho(t.slug)}
                  >
                    <div>
                      {t.thumbnail && (
                        <div style={{ height: '150px', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px', background: '#000' }}>
                          <img src={t.thumbnail} alt={t.titulo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <h3 style={{ fontSize: '16px', color: 'var(--ouro)', fontWeight: '600' }}>{t.titulo}</h3>
                        <span style={{ fontSize: '11px', background: 'var(--painel-2)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--borda)' }}>
                          {t.formato}
                        </span>
                      </div>
                      {t.hook_3s && (
                        <p style={{ fontSize: '12px', color: 'var(--texto-2)', fontStyle: 'italic', marginBottom: '12px' }}>
                          "{t.hook_3s.slice(0, 90)}..."
                        </p>
                      )}
                    </div>
                    <div style={{ borderTop: '1px solid var(--borda)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--texto-3)' }}>
                        {t.cenasTotal} cenas · {t.imagensProntas ?? t.cenasImagensProntas}/{t.imagensTotal ?? t.cenasTotal} 🖼️ · {t.cenasAudiosProntos} 🔊
                      </span>
                      <button
                        className="btn btn-ghost"
                        style={{ color: 'var(--erro)', padding: '4px 8px', fontSize: '12px' }}
                        onClick={(e) => excluirTestemunho(t.slug, e)}
                        title="Excluir testemunho"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tela Única (All-in-One Studio) do Testemunho */
        <div>
          {/* Topo / Barra de Ação da Tela Única */}
          <div
            style={{
              position: 'sticky',
              top: '60px',
              zIndex: 40,
              background: 'rgba(11, 19, 32, 0.95)',
              backdropFilter: 'blur(10px)',
              padding: '14px 20px',
              borderRadius: 'var(--raio)',
              border: '1px solid var(--borda)',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              boxShadow: 'var(--sombra)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button
                className="btn btn-ghost"
                onClick={() => { setSlugSelecionado(null); setSlugTestemunho(null); setDadosTestemunho(null); carregarTestemunhos(); }}
                style={{ padding: '6px 12px', border: '1px solid var(--borda)', borderRadius: '6px' }}
              >
                ← Voltar
              </button>
              <div>
                <h2 style={{ fontSize: '18px', color: 'var(--ouro)', margin: 0 }}>
                  {dadosTestemunho?.roteiro?.titulo || slugSelecionado}
                </h2>
                <span style={{ fontSize: '12px', color: 'var(--texto-3)' }}>
                  Formato: {dadosTestemunho?.roteiro?.formato || '16:9'} • {dadosTestemunho?.cenas?.length || 0} Cenas
                </span>
              </div>
            </div>

            {/* Ações por Etapas com indicadores de processamento */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                className="btn btn-ghost"
                onClick={salvarAlteracoesCenas}
                disabled={salvandoCenas || jobRodando}
                style={{ border: '1px solid var(--borda)', borderRadius: '6px', fontSize: '13px' }}
                title="Salva alterações feitas nos textos de cada cena"
              >
                {salvandoCenas ? '💾 Salvando…' : '💾 Salvar Textos'}
              </button>

              <button
                className="btn btn-ghost"
                onClick={gerarTodasImagens}
                disabled={jobRodando}
                style={{
                  border: gerandoImagens ? '1px solid var(--ouro)' : '1px solid var(--borda)',
                  background: gerandoImagens ? 'rgba(224, 180, 90, 0.15)' : 'transparent',
                  color: gerandoImagens ? 'var(--ouro)' : 'inherit',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              >
                {gerandoImagens ? `⏳ Gerando Imagens (${percentualJob ?? '...'}%)` : '🖼️ Gerar Imagens'}
              </button>

              <button
                className="btn btn-ghost"
                onClick={gerarTodasVozes}
                disabled={jobRodando}
                style={{
                  border: gerandoVozes ? '1px solid var(--ouro)' : '1px solid var(--borda)',
                  background: gerandoVozes ? 'rgba(224, 180, 90, 0.15)' : 'transparent',
                  color: gerandoVozes ? 'var(--ouro)' : 'inherit',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              >
                {gerandoVozes ? `⏳ Gerando Vozes (${percentualJob ?? '...'}%)` : '🎙️ Gerar Vozes'}
              </button>

              <button
                className="btn btn-primary"
                onClick={montarVideoFinal}
                disabled={jobRodando}
                style={{
                  background: montandoVideo ? 'var(--painel-2)' : 'var(--ouro)',
                  color: montandoVideo ? 'var(--ouro)' : '#0b1320',
                  fontWeight: 'bold',
                  borderRadius: '6px',
                  fontSize: '13px',
                  border: montandoVideo ? '1px solid var(--ouro)' : 'none',
                  padding: '8px 16px',
                }}
              >
                {montandoVideo ? `⏳ Montando (${percentualJob ?? '...'}%)` : '🎬 Montar Vídeo'}
              </button>
            </div>
          </div>

          {/* Banner de Processamento Ativo em Tempo Real com Barra de Progresso */}
          {jobRodando && (
            <div
              style={{
                background: 'linear-gradient(90deg, rgba(224, 180, 90, 0.18) 0%, rgba(17, 28, 46, 0.95) 100%)',
                border: '1px solid var(--ouro)',
                borderRadius: 'var(--raio)',
                padding: '16px 20px',
                marginBottom: '24px',
                boxShadow: '0 4px 20px rgba(224, 180, 90, 0.15)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '20px', animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>🔄</span>
                  <div>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--ouro)' }}>
                      {gerandoImagens && '🖼️ Gerando Imagens no ComfyUI'}
                      {gerandoVozes && '🎙️ Sintetizando Vozes via TTS'}
                      {montandoVideo && '🎬 Renderizando Vídeo Final'}
                      {gerandoRoteiro && '📝 Gerando Roteiro de Cenas'}
                      {!gerandoImagens && !gerandoVozes && !montandoVideo && !gerandoRoteiro && `Processamento (${jobEtapa})`}
                    </span>
                    <span style={{ fontSize: '13px', color: '#fff', marginLeft: '12px' }}>
                      {job?.msg || 'Executando…'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={cancelarJob}
                  style={{ color: 'var(--erro)', border: '1px solid var(--erro)', borderRadius: '6px', fontSize: '12px', padding: '4px 12px' }}
                >
                  ✕ Cancelar
                </button>
              </div>

              {/* Barra de Progresso Percentual */}
              <div style={{ width: '100%', height: '8px', background: 'rgba(0,0,0,0.5)', borderRadius: '99px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${percentualJob != null ? percentualJob : 25}%`,
                    background: 'linear-gradient(90deg, #e0b45a 0%, #f5b041 100%)',
                    borderRadius: '99px',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}

          {carregandoDetalhes ? (
            <p style={{ color: 'var(--texto-3)' }}>Carregando dados da tela única…</p>
          ) : !dadosTestemunho ? (
            <p style={{ color: 'var(--erro)' }}>Não foi possível carregar os dados deste testemunho.</p>
          ) : (
            <div>
              {/* Destaque do Hook dos Primeiros 3 Segundos */}
              <div
                style={{
                  background: 'rgba(224, 180, 90, 0.08)',
                  border: '1px solid var(--borda-forte)',
                  borderRadius: 'var(--raio)',
                  padding: '16px 20px',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <span style={{ fontSize: '26px' }}>⚡</span>
                <div>
                  <strong style={{ color: 'var(--ouro)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Gancho de Impacto (Primeiros 3 Segundos)
                  </strong>
                  <p style={{ color: '#fff', fontSize: '15px', marginTop: '4px', fontStyle: 'italic' }}>
                    "{dadosTestemunho.roteiro?.hook_3s}"
                  </p>
                </div>
              </div>

              {/* Linha do Tempo das Cenas Integradas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '36px' }}>
                {dadosTestemunho.cenas?.map((c, idx) => {
                  const vertical = dadosTestemunho.roteiro?.formato === '9:16';
                  const thumbW = vertical ? '58px' : '96px';
                  const cenaGerandoImg = isCenaGerandoImagem(c.id);
                  const cenaGerandoAud = isCenaGerandoAudio(c.id);

                  return (
                    <div
                      key={c.id}
                      className="card"
                      style={{
                        background: 'var(--painel)',
                        border: cenaGerandoImg || cenaGerandoAud ? '1px solid var(--ouro)' : '1px solid var(--borda)',
                        borderRadius: 'var(--raio)',
                        padding: '18px 20px',
                        display: 'grid',
                        gridTemplateColumns: `minmax(300px, 1fr) 340px 250px`,
                        gap: '20px',
                        alignItems: 'start',
                        boxShadow: cenaGerandoImg || cenaGerandoAud ? '0 0 16px rgba(224, 180, 90, 0.2)' : 'none',
                        transition: 'border-color 0.3s, box-shadow 0.3s',
                      }}
                    >
                      {/* Coluna 1: Caixa de Texto da Narração */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--ouro)', fontSize: '14px' }}>
                            {idx === 0 ? '⚡ Cena 1 (Abertura / Hook)' : idx === dadosTestemunho.cenas.length - 1 ? '🕊️ Cena Final (Fechamento / CTA)' : `Cena ${idx + 1}`}
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--texto-3)' }}>
                            {(edicoes[c.id]?.narracao || '').split(/\s+/).filter(Boolean).length} palavras
                          </span>
                        </div>
                        <textarea
                          rows={4}
                          disabled={jobRodando}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: 'var(--painel-2)',
                            border: '1px solid var(--borda)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '14px',
                            lineHeight: '1.5',
                            resize: 'vertical',
                          }}
                          value={edicoes[c.id]?.narracao ?? c.narracao}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEdicoes((prev) => ({
                              ...prev,
                              [c.id]: { ...prev[c.id], narracao: val },
                            }));
                          }}
                        />
                      </div>

                      {/* Coluna 2: Galeria de Imagens da Cena (várias ilustrações) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', color: 'var(--texto-2)', fontWeight: '500' }}>
                            🖼️ Imagens da Cena
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--texto-3)' }}>
                            {(c.imagens || []).filter((i) => i.existe).length}/{promptsDaCena(c).length} prontas
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {promptsDaCena(c).map((prompt, j) => {
                            const info = c.imagens?.[j];
                            const arquivo = info?.arquivo || `${c.id}-img-${String(j + 1).padStart(2, '0')}.png`;
                            const gerando = isImagemGerando(arquivo);
                            const chavePrompt = `${c.id}:${arquivo}`;
                            const promptAberto = !!promptsAbertos[chavePrompt] || !String(prompt || '').trim();

                            return (
                              <div
                                key={arquivo}
                                style={{
                                  display: 'flex',
                                  gap: '10px',
                                  padding: '8px',
                                  background: 'rgba(0,0,0,0.18)',
                                  border: gerando ? '1px solid var(--ouro)' : '1px solid var(--borda)',
                                  borderRadius: '8px',
                                }}
                              >
                                {/* Thumbnail */}
                                <div
                                  style={{
                                    width: thumbW,
                                    flexShrink: 0,
                                    aspectRatio: vertical ? '9 / 16' : '16 / 9',
                                    borderRadius: '6px',
                                    overflow: 'hidden',
                                    background: '#070d17',
                                    border: '1px solid var(--borda)',
                                    cursor: info?.existe && !gerando ? 'pointer' : 'default',
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                  onClick={() => {
                                    if (info?.existe && !gerando) {
                                      const pos = galeria.findIndex((g) => g.url === info.url);
                                      setLightboxIdx(pos >= 0 ? pos : null);
                                    }
                                  }}
                                  title={gerando ? 'Gerando imagem...' : info?.existe ? 'Clique para ver maior' : 'Imagem não gerada'}
                                >
                                  {info?.existe && (
                                    <img src={info.url} alt={arquivo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                  )}

                                  {gerando && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        inset: 0,
                                        background: 'rgba(11, 19, 32, 0.88)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '4px',
                                        textAlign: 'center',
                                      }}
                                    >
                                      <span style={{ fontSize: '16px', animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>🎨</span>
                                      <span style={{ fontSize: '10px', color: 'var(--ouro)', fontWeight: 'bold' }}>Gerando…</span>
                                    </div>
                                  )}

                                  {!info?.existe && !gerando && (
                                    <span style={{ fontSize: '11px', color: 'var(--texto-3)', textAlign: 'center', padding: '4px' }}>
                                      Sem imagem
                                    </span>
                                  )}
                                </div>

                                {/* Prompt + ações da imagem */}
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '11px', color: 'var(--texto-3)' }}>
                                      Imagem {j + 1}
                                      {info?.existe ? '' : ' · pendente'}
                                    </span>
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                      <button
                                        type="button"
                                        className="btn btn-ghost"
                                        disabled={jobRodando}
                                        title={info?.existe ? 'Regerar esta imagem' : 'Gerar esta imagem'}
                                        style={{ fontSize: '11px', padding: '2px 6px', border: '1px solid var(--borda)', borderRadius: '5px', opacity: jobRodando ? 0.6 : 1 }}
                                        onClick={() => gerarImagemCena(c.id, arquivo)}
                                      >
                                        {gerando ? '⏳' : '↻'}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost"
                                        title="Ver/editar prompt em inglês"
                                        style={{ fontSize: '11px', padding: '2px 6px', border: '1px solid var(--borda)', borderRadius: '5px' }}
                                        onClick={() => setPromptsAbertos((prev) => ({ ...prev, [chavePrompt]: !prev[chavePrompt] }))}
                                      >
                                        {promptAberto ? '▲' : '▼'}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost"
                                        title="Remover esta imagem da cena"
                                        style={{ fontSize: '11px', padding: '2px 6px', border: '1px solid var(--borda)', borderRadius: '5px', color: 'var(--erro)' }}
                                        disabled={jobRodando || promptsDaCena(c).length <= 1}
                                        onClick={() => removerImagem(c.id, arquivo)}
                                      >
                                        🗑
                                      </button>
                                    </div>
                                  </div>

                                  {promptAberto && (
                                    <textarea
                                      rows={2}
                                      disabled={jobRodando}
                                      placeholder="Prompt em inglês (ex.: close-up of clasped hands in warm light, minimalist, no text)"
                                      style={{
                                        width: '100%',
                                        padding: '6px 8px',
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px dashed var(--borda)',
                                        borderRadius: '6px',
                                        color: 'var(--texto-2)',
                                        fontSize: '11px',
                                        lineHeight: 1.4,
                                        resize: 'vertical',
                                      }}
                                      value={prompt ?? ''}
                                      onChange={(e) => setPromptImagem(c.id, j, e.target.value)}
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={jobRodando}
                          style={{
                            fontSize: '11px',
                            padding: '6px 8px',
                            border: '1px dashed var(--borda)',
                            borderRadius: '6px',
                            color: 'var(--ouro)',
                            opacity: jobRodando ? 0.6 : 1,
                          }}
                          onClick={() => adicionarImagem(c.id)}
                          title="Acrescenta mais uma ilustração a esta cena"
                        >
                          ＋ Adicionar imagem à cena
                        </button>
                      </div>

                      {/* Coluna 3: Áudio da Narração com Status */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', color: 'var(--texto-2)', fontWeight: '500' }}>
                            🔊 Áudio da Narração
                          </span>
                          {cenaGerandoAud && (
                            <span style={{ fontSize: '11px', color: 'var(--ouro)', animation: 'pulse 1.2s infinite' }}>
                              🎙️ Gravando…
                            </span>
                          )}
                        </div>

                        {c.audio.existe && !cenaGerandoAud ? (
                          <audio
                            controls
                            src={c.audio.url}
                            style={{ width: '100%', height: '36px', borderRadius: '4px' }}
                          />
                        ) : (
                          <div
                            style={{
                              padding: '10px',
                              background: cenaGerandoAud ? 'rgba(224, 180, 90, 0.12)' : 'var(--painel-2)',
                              border: cenaGerandoAud ? '1px solid var(--ouro)' : 'none',
                              borderRadius: '6px',
                              textAlign: 'center',
                              fontSize: '12px',
                              color: cenaGerandoAud ? 'var(--ouro)' : 'var(--texto-3)',
                            }}
                          >
                            {cenaGerandoAud ? '🎙️ Sintetizando áudio desta cena…' : 'Áudio pendente'}
                          </div>
                        )}

                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={jobRodando}
                          style={{
                            fontSize: '12px',
                            padding: '6px 12px',
                            border: '1px solid var(--borda)',
                            borderRadius: '6px',
                            opacity: jobRodando ? 0.6 : 1,
                          }}
                          onClick={() => gerarVozCena(c.id)}
                        >
                          {cenaGerandoAud ? '⏳ Gravando…' : `↻ ${c.audio.existe ? 'Regravar Áudio' : 'Gravar Áudio'}`}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Rodapé: Vídeo Final Concluído com Status de Renderização */}
              <div
                className="card"
                style={{
                  background: 'var(--painel)',
                  border: montandoVideo ? '1px solid var(--ouro)' : '1px solid var(--borda-forte)',
                  borderRadius: 'var(--raio)',
                  padding: '24px',
                  textAlign: 'center',
                }}
              >
                <h3 style={{ fontSize: '20px', color: 'var(--ouro)', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <span>🎬</span> Vídeo Final do Testemunho
                </h3>

                {montandoVideo ? (
                  /* Feedback Visual quando o vídeo estiver sendo montado */
                  <div style={{ padding: '24px', maxWidth: '600px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '14px' }}>
                      <span style={{ fontSize: '24px', animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>🎬</span>
                      <strong style={{ fontSize: '16px', color: 'var(--ouro)' }}>
                        Renderizando vídeo final ({percentualJob != null ? `${percentualJob}%` : 'em andamento'})
                      </strong>
                    </div>
                    <p style={{ color: 'var(--texto-2)', fontSize: '13px', marginBottom: '14px' }}>
                      {job?.msg || 'Sincronizando cenas, aplicando dimensões e mixando trilha reflexiva...'}
                    </p>
                    <div style={{ width: '100%', height: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '99px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${percentualJob != null ? percentualJob : 40}%`,
                          background: 'linear-gradient(90deg, #e0b45a 0%, #58d68d 100%)',
                          borderRadius: '99px',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>
                ) : dadosTestemunho.video?.existe ? (
                  <div style={{ maxWidth: dadosTestemunho.roteiro?.formato === '9:16' ? '360px' : '720px', margin: '0 auto' }}>
                    <video
                      controls
                      src={dadosTestemunho.video.url}
                      style={{
                        width: '100%',
                        borderRadius: '10px',
                        boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
                        background: '#000',
                        marginBottom: '16px',
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '14px' }}>
                      <a
                        href={dadosTestemunho.video.url}
                        download={dadosTestemunho.video.arquivo}
                        className="btn btn-primary"
                        style={{ background: 'var(--ouro)', color: '#0b1320', fontWeight: 'bold', padding: '10px 20px', borderRadius: '8px', textDecoration: 'none' }}
                      >
                        📥 Baixar MP4
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={jobRodando}
                        onClick={montarVideoFinal}
                        style={{ border: '1px solid var(--borda)', borderRadius: '8px', padding: '10px 20px' }}
                      >
                        ↻ Remontar Vídeo
                      </button>
                    </div>

                    <BlocoDescricaoYouTube onCopiar={copiarDescricaoProjeto} />
                  </div>
                ) : (
                  <div style={{ padding: '24px', color: 'var(--texto-3)' }}>
                    <p style={{ marginBottom: '14px' }}>
                      O vídeo final ainda não foi renderizado. Quando todas as imagens e áudios estiverem aprovados nas cenas acima, clique no botão para montar.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={jobRodando}
                      onClick={montarVideoFinal}
                      style={{ background: 'var(--ouro)', color: '#0b1320', fontWeight: 'bold', padding: '10px 24px', borderRadius: '8px', border: 'none', opacity: jobRodando ? 0.6 : 1 }}
                    >
                      🎬 Montar Vídeo Final
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
