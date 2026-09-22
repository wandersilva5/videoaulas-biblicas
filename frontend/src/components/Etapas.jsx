import React, { useState } from 'react';
import { api, contarPalavras, itensImagem, itensNarracao, servicoOk, urlImagem } from '../lib.js';
import { useStudio } from '../store.jsx';

function Topo({ titulo, children }) {
  return (
    <div className="etapa-topo">
      <h3>{titulo}</h3>
      <div className="etapa-acoes">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 1 — Roteiro
// ---------------------------------------------------------------------------
export function EtapaRoteiro() {
  const { roteiro, setRoteiro, jobAtivo, salvarRoteiro, regenerarRoteiro, toast } = useStudio();
  const [dragIdx, setDragIdx] = useState(null);

  if (!roteiro) return null;
  const set = (fn) => setRoteiro((r) => fn(structuredClone(r)));
  const desabilitado = jobAtivo;

  const mudarSlide = (i, campo, valor) =>
    set((r) => { r.slides[i][campo] = valor; return r; });
  const mudarPonto = (i, j, valor) =>
    set((r) => { r.slides[i].pontos[j] = valor; return r; });

  const soltar = (from, to) => {
    if (from == null || to == null || from === to) return;
    set((r) => {
      const [item] = r.slides.splice(from, 1);
      r.slides.splice(to, 0, item);
      r.slides.forEach((s, k) => { s.id = `slide-${String(k + 1).padStart(2, '0')}`; });
      return r;
    });
  };

  return (
    <>
      <Topo titulo="Roteiro">
        <button className="btn btn-perigo" disabled={desabilitado} onClick={() => regenerarRoteiro()}>↺ Regenerar roteiro</button>
        <button className="btn btn-primario" disabled={desabilitado} onClick={() => salvarRoteiro()}>💾 Salvar alterações</button>
      </Topo>
      <div className="cartao campo-texto">
        <label>Título da aula</label>
        <input value={roteiro.titulo_aula} placeholder="Título da videoaula" disabled={desabilitado}
          onChange={(e) => set((r) => { r.titulo_aula = e.target.value; return r; })} />
      </div>
      <div className="cartao campo-texto">
        <label>Introdução (narrada)</label>
        <textarea rows="3" value={roteiro.introducao} disabled={desabilitado}
          onChange={(e) => set((r) => { r.introducao = e.target.value; return r; })} />
      </div>
      <div className="cartao campo-texto">
        <label>Introdução — prompt da imagem de capa (EN)</label>
        <textarea rows="2" value={roteiro.introducao_imagem_prompt || ''} disabled={desabilitado}
          onChange={(e) => set((r) => { r.introducao_imagem_prompt = e.target.value; return r; })} />
      </div>
      <div className="cartao campo-texto">
        <label>Conclusão (narrada)</label>
        <textarea rows="3" value={roteiro.conclusao} disabled={desabilitado}
          onChange={(e) => set((r) => { r.conclusao = e.target.value; return r; })} />
      </div>
      <div className="cartao campo-texto">
        <label>Conclusão — prompt da imagem de capa (EN)</label>
        <textarea rows="2" value={roteiro.conclusao_imagem_prompt || ''} disabled={desabilitado}
          onChange={(e) => set((r) => { r.conclusao_imagem_prompt = e.target.value; return r; })} />
      </div>
      <div className="etapa-topo" style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 16 }}>Slides</h3>
        <button
          className="btn"
          disabled={desabilitado}
          onClick={() => set((r) => {
            r.slides.push({
              id: `slide-${String(r.slides.length + 1).padStart(2, '0')}`,
              titulo: 'Novo slide',
              pontos: ['Ponto 1', 'Ponto 2'],
              narracao: '',
              referencia_biblica: '',
              imagem_prompt: 'flat illustration, educational minimal style, no text',
            });
            return r;
          })}
        >
          + novo slide
        </button>
      </div>
      <div id="lista-slides">
        {roteiro.slides.map((s, i) => {
          const n = contarPalavras(s.narracao);
          return (
            <div
              key={s.id + '-' + i}
              className={`slide-card${dragIdx === i ? ' dragging' : ''}`}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnd={() => setDragIdx(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); soltar(dragIdx, i); setDragIdx(null); }}
            >
              <div className="cabeca">
                <span className="alça" title="Arrastar para reordenar">⠿</span>
                <span className="num-slide">SLIDE {String(i + 1).padStart(2, '0')}</span>
                <input value={s.titulo} placeholder="Título (máx 8 palavras)" disabled={desabilitado}
                  onChange={(e) => mudarSlide(i, 'titulo', e.target.value)} />
                <button
                  className="lixeira"
                  title="Remover slide"
                  disabled={desabilitado}
                  onClick={() => {
                    if (!confirm(`Remover o slide ${i + 1}?`)) return;
                    set((r) => {
                      r.slides.splice(i, 1);
                      r.slides.forEach((x, k) => { x.id = `slide-${String(k + 1).padStart(2, '0')}`; });
                      return r;
                    });
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="pontos-editor">
                {s.pontos.map((p, j) => (
                  <div className="ponto-linha" key={j}>
                    <span>▸</span>
                    <input value={p} placeholder="Ponto-chave" disabled={desabilitado}
                      onChange={(e) => mudarPonto(i, j, e.target.value)} />
                    <button
                      title="Remover ponto"
                      disabled={desabilitado}
                      onClick={() => set((r) => { r.slides[i].pontos.splice(j, 1); return r; })}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn-adicionar-ponto"
                disabled={desabilitado}
                onClick={() => set((r) => { r.slides[i].pontos.push('Novo ponto'); return r; })}
              >
                + ponto
              </button>
              <div className="campo-texto" style={{ marginTop: 12 }}>
                <label>Narração <span className={`contador ${n >= 60 && n <= 90 ? 'dentro' : 'fora'}`}>{n} palavras</span></label>
                <textarea value={s.narracao} disabled={desabilitado}
                  onChange={(e) => mudarSlide(i, 'narracao', e.target.value)} />
              </div>
              <div className="campo-texto">
                <label>Referência bíblica</label>
                <input value={s.referencia_biblica || ''} placeholder="Livro capítulo:versículo (ex.: João 3:16)" disabled={desabilitado}
                  onChange={(e) => mudarSlide(i, 'referencia_biblica', e.target.value)} />
              </div>
              <div className="campo-texto">
                <label>Prompt da imagem (EN)</label>
                <input value={s.imagem_prompt} disabled={desabilitado}
                  onChange={(e) => mudarSlide(i, 'imagem_prompt', e.target.value)} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Etapa 2 — Imagens
// ---------------------------------------------------------------------------
export function EtapaImagens() {
  const { artefatos, slug, jobAtivo, servicos, rodarJob, toast, setModalSlideIdx } = useStudio();
  const itens = itensImagem(artefatos);

  const checarComfy = () => {
    if (servicos && !servicoOk(servicos, 'comfy')) {
      toast('ComfyUI indisponível — não é possível gerar imagens.', true);
      return false;
    }
    return true;
  };

  return (
    <>
      <Topo titulo="Imagens">
        <button
          className="btn btn-perigo"
          title="Apaga as atuais e gera todas de novo (capas + slides)"
          disabled={jobAtivo}
          onClick={() => {
            if (!checarComfy()) return;
            if (!confirm('Apagar todas as imagens atuais e gerar do zero? Isso pode levar vários minutos.')) return;
            rodarJob(api(`/api/imagens/${slug}`, { method: 'POST', body: JSON.stringify({ recriarTodos: true, variar: true }) }), 'Todas as imagens foram recriadas.');
          }}
        >
          ↺ Recriar todas
        </button>
        <button
          className="btn btn-primario"
          disabled={jobAtivo}
          onClick={() => {
            if (!checarComfy()) return;
            rodarJob(api(`/api/imagens/${slug}`, { method: 'POST', body: JSON.stringify({}) }), 'Imagens atualizadas.');
          }}
        >
          Gerar as que faltam
        </button>
      </Topo>
      <p className="msg-progresso">Capas de abertura/encerramento + slides. Geração via ComfyUI local (≈30s por imagem). "↻" regenera uma imagem com seed aleatório.</p>
      <div className="grid-imagens">
        {itens.map((s, i) => (
          <div key={s.id} className={`img-card${s.imagem.existe ? '' : ' faltando'}`}>
            {s.imagem.existe && (
              <img src={urlImagem(slug, s.arquivo, s.imagem.mtime)} loading="lazy" onClick={() => setModalSlideIdx(i)} />
            )}
            {s.imagem.existe && (
              <button
                className="regen"
                title="Regenerar imagem (novo seed)"
                disabled={jobAtivo}
                onClick={() => {
                  if (!checarComfy()) return;
                  rodarJob(api(`/api/imagens/${slug}`, { method: 'POST', body: JSON.stringify({ slideId: s.id, variar: true }) }), 'Imagem regenerada.');
                }}
              >
                ↻
              </button>
            )}
            <div className="img-info">
              <span>{s.titulo}</span>
              {s.imagem.existe
                ? (s.imagem.desatualizado
                  ? <span className="badge alerta">prompt alterado</span>
                  : <span className="badge ok">ok</span>)
                : <span className="badge erro">pendente</span>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Etapa 3 — Narração
// ---------------------------------------------------------------------------
export function EtapaNarracao() {
  const { artefatos, slug, config, jobAtivo, servicos, rodarJob, toast } = useStudio();
  const itens = itensNarracao(artefatos);

  const checarQwen = () => {
    if (servicos && !servicoOk(servicos, 'qwen')) {
      toast('Qwen3-TTS indisponível — não é possível gerar narração.', true);
      return false;
    }
    return true;
  };

  return (
    <>
      <Topo titulo="Narrações">
        <button
          className="btn"
          title="Gera só os itens sem áudio ou com o texto alterado"
          disabled={jobAtivo}
          onClick={() => {
            if (!checarQwen()) return;
            rodarJob(api(`/api/narracao/${slug}`, { method: 'POST', body: JSON.stringify({}) }), 'Narrações atualizadas.');
          }}
        >
          ↻ Regenerar desatualizados
        </button>
        <button
          className="btn btn-primario"
          title="Regenera todos os MP3, mesmo os já atualizados"
          disabled={jobAtivo}
          onClick={() => {
            if (!checarQwen()) return;
            if (!confirm('Regenerar TODOS os MP3 de narração (inclusive os atualizados)? Custa tempo de TTS.')) return;
            rodarJob(api(`/api/narracao/${slug}`, { method: 'POST', body: JSON.stringify({ todos: true }) }), 'Todas as narrações foram recriadas.');
          }}
        >
          🎙 Gerar todos
        </button>
      </Topo>
      <p className="msg-progresso">Voz: <strong>{config?.VOZ || 'pt-BR-AntonioNeural'}</strong>. Textos inalterados são pulados (manifesto). Edite o texto na etapa Roteiro e use "↻ regenerar" para atualizar só o item.</p>
      {itens.map((it) => (
        <div className="item-audio" key={it.id}>
          <span className="rotulo">{it.rotulo}</span>
          {it.audio.existe
            ? <audio controls preload="none" src={`/media/${slug}/${it.prefix}-narracao.mp3`} />
            : <span className="msg-progresso">sem áudio ainda</span>}
          {it.audio.existe
            ? (it.audio.desatualizado
              ? <span className="badge alerta">texto alterado</span>
              : <span className="badge ok">ok</span>)
            : <span className="badge erro">pendente</span>}
          {it.audio.existe && (
            <a className="btn btn-mini" href={`/media/${slug}/${it.prefix}-narracao.mp3`} download title="Baixar MP3">⬇</a>
          )}
          <button
            className="btn btn-mini regen"
            disabled={jobAtivo}
            onClick={() => {
              if (!checarQwen()) return;
              rodarJob(api(`/api/narracao/${slug}`, { method: 'POST', body: JSON.stringify({ slideId: it.id }) }), 'Narração regenerada.');
            }}
          >
            ↻ regenerar
          </button>
          {it.audio.existe && (
            <button
              className="btn btn-mini btn-perigo"
              title="Apagar este MP3"
              disabled={jobAtivo}
              onClick={() => {
                const mapa = { intro: 'Introdução', conclusao: 'Conclusão' };
                  const slide = (artefatos?.slides || []).find((s) => s.id === it.id);
                const rotulo = slide?.titulo || mapa[it.id] || it.id;
                if (!confirm(`Apagar o áudio de "${rotulo}"?`)) return;
                rodarJob(api(`/api/narracao/${slug}`, { method: 'DELETE', body: JSON.stringify({ slideId: it.id }) }), 'Áudio apagado.');
              }}
            >
              🗑
            </button>
          )}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Etapa 4 — Vídeo
// ---------------------------------------------------------------------------
function VideoConfig({ prefixo, fps, setFps, res, setRes, width, setWidth, height, setHeight, padding, setPadding, vertical = false }) {
  const p = (id) => `${prefixo}-${id}`;
  return (
    <div className="video-config">
      <label>FPS
        <select id={p('fps')} value={fps} onChange={(e) => setFps(e.target.value)}>
          <option>24</option><option>30</option><option>60</option>
        </select>
      </label>
      <label>{vertical ? 'Resolução (vertical 9:16)' : 'Resolução'}
        <select id={p('res')} value={res} onChange={(e) => setRes(e.target.value)}>
          {vertical ? (
            <>
              <option value="1080,1920">1080×1920 · Full HD</option>
              <option value="720,1280">720×1280 · HD</option>
              <option value="2160,3840">2160×3840 · 4K vertical</option>
            </>
          ) : (
            <>
              <optgroup label="Horizontal 16:9">
                <option value="3840,2160">3840×2160 · 4K</option>
                <option value="1920,1080">1920×1080 · Full HD</option>
                <option value="1280,720">1280×720 · HD</option>
              </optgroup>
              <optgroup label="Vertical 9:16 (Reels/TikTok)">
                <option value="2160,3840">2160×3840 · 4K vertical</option>
                <option value="1080,1920">1080×1920 · Full HD vertical</option>
                <option value="720,1280">720×1280 · HD vertical</option>
              </optgroup>
            </>
          )}
          <option value="custom">Personalizado…</option>
        </select>
      </label>
      <label>Largura (custom) <input id={p('width')} type="number" value={width} min="320" step="16" onChange={(e) => setWidth(e.target.value)} /></label>
      <label>Altura (custom) <input id={p('height')} type="number" value={height} min="240" step="16" onChange={(e) => setHeight(e.target.value)} /></label>
      <label>Segundos de margem/slide <input id={p('padding')} type="number" value={padding} min="0" step="0.1" onChange={(e) => setPadding(e.target.value)} /></label>
    </div>
  );
}

export function EtapaVideo() {
  const { artefatos, slug, jobAtivo, servicos, rodarJob, toast, progresso, setProgressoArea } = useStudio();
  const [fps, setFps] = useState('24');
  const [res, setRes] = useState('1920,1080');
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [padding, setPadding] = useState('0.3');

  const problemas = [];
  if (!artefatos.imagensCompletas) problemas.push('faltam imagens (etapa 2)');
  if (!artefatos.audioCompleto) problemas.push('faltam narrações (etapa 3)');
  const pode = problemas.length === 0;
  const prog = progresso.video;

  return (
    <>
      <Topo titulo="Montagem do vídeo">
        <button
          className="btn btn-primario"
          disabled={!pode || jobAtivo}
          onClick={() => {
            if (servicos && (!servicoOk(servicos, 'ffmpeg') || !servicoOk(servicos, 'ffprobe') || !servicoOk(servicos, 'chromium'))) {
              toast('Falta ffmpeg/ffprobe ou Chromium — não é possível montar o vídeo.', true);
              return;
            }
            const [w, h] = res === 'custom' ? [width, height] : res.split(',');
            setProgressoArea('video', 0, 'Iniciando montagem…');
            rodarJob(
              api(`/api/video/${slug}`, { method: 'POST', body: JSON.stringify({ fps: Number(fps), width: Number(w), height: Number(h), padding: Number(padding) }) }),
              'Vídeo montado com sucesso!',
            );
          }}
        >
          🎬 Montar vídeo
        </button>
      </Topo>
      {!pode && <p className="msg-progresso" style={{ color: 'var(--alerta)' }}>⚠ {problemas.join(' · ')}</p>}
      <div className="cartao">
        <VideoConfig prefixo="cfg" fps={fps} setFps={setFps} res={res} setRes={setRes} width={width} setWidth={setWidth} height={height} setHeight={setHeight} padding={padding} setPadding={setPadding} />
        <p className="msg-progresso">O vídeo sai como <strong>&lt;slug&gt;-&lt;largura&gt;x&lt;altura&gt;.mp4</strong> — formatos diferentes não se sobrescrevem.</p>
        {prog && (
          <div id="area-progresso-video">
            <div className="msg-progresso" id="msg-progresso-video">{prog.texto || '…'}</div>
            <div className="barra-progresso"><div id="barra-progresso-video" style={{ width: `${Math.max(0, Math.min(100, prog.pct ?? 0))}%` }} /></div>
          </div>
        )}
      </div>
      {(artefatos.videos || []).map((v) => (
        <div className="video-item" key={v.arquivo}>
          <div className="video-rotulo">
            <span>{v.arquivo}</span>
            <a className="btn btn-mini" href={`/media/${slug}/${v.arquivo}?v=${v.mtime ?? ''}`} download title="Baixar MP4">⬇ download</a>
          </div>
          <video className="player-video" controls src={`/media/${slug}/${v.arquivo}?v=${v.mtime ?? ''}`} />
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Etapa 5 — Roteiro Short
// ---------------------------------------------------------------------------
export function EtapaRoteiroShort() {
  const { artefatos, slug, jobAtivo, servicos, rodarJob, toast } = useStudio();
  const shortRoteiro = artefatos.roteiro_short;

  const problemas = [];
  if (!artefatos.video?.existe) problemas.push('vídeo principal não gerado (etapa 4)');
  const pode = problemas.length === 0;

  return (
    <>
      <Topo titulo="Roteiro do Short (Promocional)">
        <button
          className="btn btn-primario"
          disabled={!pode || jobAtivo}
          onClick={() => {
            if (servicos && !servicoOk(servicos, 'llama')) {
              toast('llama-server indisponível — não é possível gerar roteiro do Short.', true);
              return;
            }
            if (!confirm('Gerar roteiro promocional do Short via LLM? O modelo vai criar um texto otimizado com hook, valor e CTA para o canal.')) return;
            rodarJob(api(`/api/roteiro-short/${slug}`, { method: 'POST' }), 'Roteiro do Short gerado com sucesso!');
          }}
        >
          🤖 Gerar via LLM
        </button>
      </Topo>
      {!pode && <p className="msg-progresso" style={{ color: 'var(--alerta)' }}>⚠ {problemas.join(' · ')}</p>}
      <p className="msg-progresso">Gera um roteiro promocional otimizado para Shorts (hook → problema → valor → autoridade → CTA) via llama-server. O texto tem ~150 palavras para ~55s de narração.</p>
      {shortRoteiro?.existe ? (
        <div className="cartao">
          <h4 style={{ color: 'var(--dourado)', marginBottom: 10 }}>Roteiro promocional do Short</h4>
          <textarea readOnly style={{ width: '100%', minHeight: 150, fontFamily: 'monospace', fontSize: 14, background: '#0d1b2a', color: '#dce5ef', border: '1px solid rgba(224,180,90,0.3)', borderRadius: 8, padding: 12, resize: 'vertical' }}
            value={shortRoteiro.narracao || shortRoteiro.introducao || ''} />
          <p className="msg-progresso" style={{ marginTop: 10 }}>Gerado em {new Date(shortRoteiro.mtime).toLocaleString('pt-BR')}</p>
        </div>
      ) : (
        <p className="msg-progresso" style={{ color: 'var(--alerta)' }}>Roteiro do Short ainda não gerado.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Etapa 6 — YouTube Short
// ---------------------------------------------------------------------------
export function EtapaShort() {
  const { artefatos, slug, jobAtivo, servicos, rodarJob, toast, progresso, setProgressoArea } = useStudio();
  const [fps, setFps] = useState('24');
  const [res, setRes] = useState('1080,1920');
  const [width, setWidth] = useState('1080');
  const [height, setHeight] = useState('1920');
  const [padding, setPadding] = useState('0.2');

  const short = artefatos.short;
  const prog = progresso.short;

  const problemas = [];
  if (!artefatos.imagensCompletas) problemas.push('faltam imagens (etapa 2)');
  if (!artefatos.audioCompleto) problemas.push('faltam narrações (etapa 3)');
  const pode = problemas.length === 0;

  return (
    <>
      <Topo titulo="YouTube Short">
        <button
          className="btn btn-primario"
          disabled={!pode || jobAtivo}
          onClick={() => {
            if (servicos && (!servicoOk(servicos, 'ffmpeg') || !servicoOk(servicos, 'ffprobe') || !servicoOk(servicos, 'chromium'))) {
              toast('Falta ffmpeg/ffprobe ou Chromium — não é possível montar o Short.', true);
              return;
            }
            const [w, h] = res === 'custom' ? [width, height] : res.split(',');
            setProgressoArea('short', 0, 'Iniciando montagem do Short…');
            rodarJob(
              api(`/api/short/${slug}`, { method: 'POST', body: JSON.stringify({ fps: Number(fps), width: Number(w), height: Number(h), padding: Number(padding) }) }),
              'YouTube Short gerado com sucesso!',
            );
          }}
        >
          📱 Gerar Short
        </button>
      </Topo>
      {!pode && <p className="msg-progresso" style={{ color: 'var(--alerta)' }}>⚠ {problemas.join(' · ')}</p>}
      <div className="cartao">
        <VideoConfig prefixo="cfg-short" vertical fps={fps} setFps={setFps} res={res} setRes={setRes} width={width} setWidth={setWidth} height={height} setHeight={setHeight} padding={padding} setPadding={setPadding} />
        <p className="msg-progresso">O Short sai como <strong>&lt;slug&gt;-short-&lt;largura&gt;x&lt;altura&gt;.mp4</strong> — formato vertical 9:16, ≤60s. Usa intro + até 4 slides + conclusão da aula principal.</p>
        {prog && (
          <div id="area-progresso-short">
            <div className="msg-progresso" id="msg-progresso-short">{prog.texto || '…'}</div>
            <div className="barra-progresso"><div id="barra-progresso-short" style={{ width: `${Math.max(0, Math.min(100, prog.pct ?? 0))}%` }} /></div>
          </div>
        )}
      </div>
      {short?.existe ? (
        <div className="cartao">
          <div className="video-item">
            <div className="video-rotulo">
              <span>{short.arquivo}</span>
              <a className="btn btn-mini" href={`/media/${slug}/${short.arquivo}?v=${short.mtime ?? ''}`} download title="Baixar YouTube Short">⬇ download</a>
            </div>
            <video className="player-video" controls src={`/media/${slug}/${short.arquivo}?v=${short.mtime ?? ''}`} />
          </div>
          <p className="msg-progresso" style={{ marginTop: 10 }}>Gerado em {new Date(short.mtime).toLocaleString('pt-BR')} · {(short.tamanho / (1024 * 1024)).toFixed(1)} MB</p>
        </div>
      ) : (
        <p className="msg-progresso" style={{ color: 'var(--alerta)' }}>YouTube Short ainda não gerado.</p>
      )}
      {(artefatos.shorts || [])
        .filter((v) => v.arquivo !== short?.arquivo)
        .map((v) => (
          <div className="video-item" key={v.arquivo}>
            <div className="video-rotulo">
              <span>{v.arquivo}</span>
              <a className="btn btn-mini" href={`/media/${slug}/${v.arquivo}?v=${v.mtime ?? ''}`} download title="Baixar MP4">⬇ download</a>
            </div>
            <video className="player-video" controls src={`/media/${slug}/${v.arquivo}?v=${v.mtime ?? ''}`} />
          </div>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Etapa 7 — PDF de estudo
// ---------------------------------------------------------------------------
export function EtapaPdf() {
  const { artefatos, slug, jobAtivo, servicos, rodarJob, toast } = useStudio();
  const pdf = artefatos.pdf;

  return (
    <>
      <Topo titulo="PDF de estudo">
        <button
          className="btn"
          disabled={jobAtivo}
          onClick={() => {
            if (servicos && !servicoOk(servicos, 'llama')) {
              toast('llama-server indisponível — não é possível regenerar o conteúdo complementar.', true);
              return;
            }
            if (!confirm('Gerar novo conteúdo complementar (notas e referências) via llama-server e regenerar o PDF? Pode levar alguns minutos.')) return;
            rodarJob(api(`/api/pdf/${slug}`, { method: 'POST', body: JSON.stringify({ regenerarEnriquecimento: true }) }), 'PDF regenerado com novo conteúdo complementar!');
          }}
        >
          ↻ Regenerar conteúdo complementar
        </button>
        <button
          className="btn btn-primario"
          disabled={jobAtivo}
          onClick={() => {
            if (servicos && !servicoOk(servicos, 'llama')) {
              toast('llama-server indisponível — o PDF será gerado sem o conteúdo complementar.', true);
            }
            rodarJob(api(`/api/pdf/${slug}`, { method: 'POST', body: JSON.stringify({}) }), 'PDF de estudo gerado!');
          }}
        >
          📄 Gerar PDF
        </button>
      </Topo>
      <p className="msg-progresso">Material de estudo gerado a partir do <strong>texto da narração</strong>. Cada slide é aprofundado com notas complementares e referências bíblicas adicionais (via llama-server) para preencher uma página inteira. Não depende de imagens nem áudio.</p>
      {pdf?.existe ? (
        <div className="cartao">
          <div className="pdf-acoes">
            <a className="btn btn-primario" href={`/pdfs/${pdf.arquivo}`} target="_blank" rel="noopener">📄 Abrir <strong>{pdf.arquivo}</strong></a>
            <a className="btn" href={`/pdfs/${pdf.arquivo}`} download>⬇ download</a>
          </div>
          <p className="msg-progresso" style={{ marginTop: 10 }}>Gerado em {new Date(pdf.mtime).toLocaleString('pt-BR')} · {(pdf.tamanho / 1024).toFixed(0)} KB · {artefatos.slides.length} slides</p>
        </div>
      ) : (
        <p className="msg-progresso" style={{ color: 'var(--alerta)' }}>PDF ainda não gerado.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Etapa 8 — Vídeo de Questionário
// ---------------------------------------------------------------------------
export function EtapaQuestionario() {
  const { artefatos, slug, jobAtivo, servicos, rodarJob, toast } = useStudio();
  const quiz = artefatos.questionario;

  const checarQwen = () => {
    if (servicos && !servicoOk(servicos, 'qwen')) {
      toast('Qwen3-TTS indisponível — não é possível gerar narração.', true);
      return false;
    }
    return true;
  };

  const playerAudio = (a, rotulo) => (
    <div className="item-audio" key={a.id}>
      <span className="rotulo">{rotulo}</span>
      {a.existe
        ? <audio controls preload="none" src={`/media/${slug}/${a.id}-narracao.mp3`} />
        : <span className="msg-progresso">sem áudio ainda</span>}
      {a.existe && (
        <a className="btn btn-mini" href={`/media/${slug}/${a.id}-narracao.mp3`} download title="Baixar MP3">⬇</a>
      )}
      <button
        className="btn btn-mini regen"
        title="Regenera com novo seed de voz (tenta corrigir pronúncia)"
        disabled={jobAtivo}
        onClick={() => {
          if (!checarQwen()) return;
          rodarJob(api(`/api/narracao-questionario/${slug}`, { method: 'POST', body: JSON.stringify({ itemId: a.id, variar: true }) }), `Áudio ${a.id} regenerado.`);
        }}
      >
        ↻ regenerar
      </button>
      {a.existe && (
        <button
          className="btn btn-mini btn-perigo"
          title="Apagar este MP3"
          disabled={jobAtivo}
          onClick={() => {
            if (!confirm(`Apagar o áudio ${a.id}?`)) return;
            rodarJob(api(`/api/narracao-questionario/${slug}`, { method: 'DELETE', body: JSON.stringify({ itemId: a.id }) }), 'Áudio apagado.');
          }}
        >
          🗑
        </button>
      )}
    </div>
  );

  return (
    <>
      <Topo titulo="Vídeo de Questionário">
        <button
          className="btn"
          title="Regenera todos os MP3 do questionário, mesmo os já existentes"
          disabled={jobAtivo}
          onClick={() => {
            if (!checarQwen()) return;
            if (!confirm('Regenerar TODOS os áudios do questionário (pergunta + resposta de cada)? Custa tempo de TTS.')) return;
            rodarJob(api(`/api/narracao-questionario/${slug}`, { method: 'POST', body: JSON.stringify({ todos: true, variar: true }) }), 'Todos os áudios do questionário foram regenerados.');
          }}
        >
          🎙 Regenerar todos os áudios
        </button>
        <button
          className="btn"
          title="Monta o vídeo de novo com os áudios atuais, sem regenerar perguntas nem narração"
          disabled={jobAtivo}
          onClick={() => {
            if (servicos && (!servicoOk(servicos, 'ffmpeg') || !servicoOk(servicos, 'ffprobe') || !servicoOk(servicos, 'chromium'))) {
              toast('Falta ffmpeg/ffprobe ou Chromium — não é possível montar o vídeo.', true);
              return;
            }
            if (!confirm('Remontar o vídeo do questionário com os áudios atuais? As perguntas e narrações não serão regeneradas.')) return;
            rodarJob(api(`/api/video-questionario/${slug}`, { method: 'POST' }), 'Vídeo do questionário remontado!');
          }}
        >
          🎬 Remontar vídeo
        </button>
        <button
          className="btn btn-primario"
          disabled={jobAtivo}
          onClick={() => {
            if (servicos && (!servicoOk(servicos, 'llama') || !servicoOk(servicos, 'qwen') || !servicoOk(servicos, 'ffmpeg') || !servicoOk(servicos, 'chromium'))) {
              const faltam = [];
              if (!servicoOk(servicos, 'llama')) faltam.push('llama-server');
              if (!servicoOk(servicos, 'qwen')) faltam.push('Qwen3-TTS');
              if (!servicoOk(servicos, 'ffmpeg')) faltam.push('ffmpeg');
              if (!servicoOk(servicos, 'chromium')) faltam.push('Chromium');
              toast(`Serviços indisponíveis: ${faltam.join(', ')}`, true);
              return;
            }
            if (!confirm('Gerar o vídeo de questionário? O modelo vai criar 5 perguntas de múltipla escolha e gerar a narração e o vídeo. Isso pode levar alguns minutos.')) return;
            rodarJob(api(`/api/questionario/${slug}`, { method: 'POST' }), 'Vídeo de questionário gerado com sucesso!');
          }}
        >
          🧠 Gerar vídeo de questionário
        </button>
      </Topo>
      <p className="msg-progresso">O modelo formula <strong>5 perguntas de múltipla escolha</strong> com base no conteúdo da aula. Cada pergunta tem <strong>10 segundos</strong> para o espectador responder antes de a resposta correta ser revelada e narrada. Este vídeo é separado da videoaula principal. Use <strong>🎬 Remontar vídeo</strong> depois de regenerar algum áudio.</p>
      <div className="cartao" style={{ padding: '16px 20px', background: 'rgba(224,180,90,0.07)', borderColor: 'rgba(224,180,90,0.3)' }}>
        <strong style={{ color: 'var(--dourado)' }}>Formato do vídeo:</strong>
        <ul style={{ marginTop: 8, paddingLeft: 20, color: 'var(--texto-2)', fontSize: 14, lineHeight: 1.8 }}>
          <li>Tema da pergunta + número + texto da pergunta</li>
          <li>3 opções de resposta (A, B, C)</li>
          <li>10 segundos de espera com a tela congelada</li>
          <li>A voz lê a pergunta + opções antes do timer</li>
          <li>Após o timer, a opção correta é destacada e narrada</li>
        </ul>
      </div>
      {quiz?.existe ? (
        <div className="cartao">
          <div className="video-item">
            <div className="video-rotulo">
              <span>{quiz.arquivo}</span>
              <a className="btn btn-mini" href={`/media/${slug}/${quiz.arquivo}?v=${quiz.mtime ?? ''}`} download title="Baixar vídeo do questionário">⬇ download</a>
            </div>
            <video className="player-video" controls src={`/media/${slug}/${quiz.arquivo}?v=${quiz.mtime ?? ''}`} />
          </div>
          <p className="msg-progresso" style={{ marginTop: 10 }}>Gerado em {new Date(quiz.mtime).toLocaleString('pt-BR')} · {(quiz.tamanho / (1024 * 1024)).toFixed(1)} MB</p>
        </div>
      ) : (
        <p className="msg-progresso" style={{ color: 'var(--alerta)' }}>Vídeo do questionário ainda não gerado.</p>
      )}
      {(quiz?.perguntas || []).length > 0 && (
        <>
          <h4 style={{ marginTop: 18, color: 'var(--dourado)' }}>Áudios do questionário</h4>
          <p className="msg-progresso">Se alguma pronúncia não ficou boa, use "↻ regenerar" para refazer só aquele áudio (novo seed de voz). Depois monte o vídeo de novo.</p>
          {(quiz.perguntas || []).map((p) => (
            <div className="cartao" style={{ marginTop: 10, padding: '14px 18px' }} key={p.numero}>
              <strong style={{ color: 'var(--dourado)' }}>{p.numero}. {p.tema}</strong>
              {playerAudio(p.pergunta_audio, 'Pergunta')}
              {playerAudio(p.resposta_audio, 'Resposta')}
            </div>
          ))}
        </>
      )}
    </>
  );
}
