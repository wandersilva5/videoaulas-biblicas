import React, { useRef, useState } from 'react';
import { api, slugDe, servicoOk } from '../lib.js';
import { useStudio } from '../store.jsx';

function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '');
    fr.onerror = () => reject(fr.error || new Error('Falha ao ler o arquivo'));
    fr.readAsDataURL(arquivo);
  });
}

function NovaAula() {
  const { toast, abrirAula, servicos } = useStudio();
  const [titulo, setTitulo] = useState('');
  const [aba, setAba] = useState('assunto');
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [pdfNome, setPdfNome] = useState(null);
  const pdfInput = useRef(null);
  const [criando, setCriando] = useState(false);

  const setPdfArquivo = (arquivo) => {
    if (arquivo && /\.pdf$/i.test(arquivo.name)) {
      setPdfNome(arquivo.name);
      const dt = new DataTransfer();
      dt.items.add(arquivo);
      pdfInput.current.files = dt.files;
    }
  };

  const criarAula = async () => {
    const t = titulo.trim();
    if (!t) {
      toast('Informe o título da aula.', true);
      return;
    }
    const slug = slugDe(t);
    try {
      const aulas = await api('/api/aulas');
      if (aulas.some((a) => a.slug === slug)) {
        toast(`Já existe uma aula com este título ("${slug}").`, true);
        return;
      }
    } catch {
      /* segue sem a checagem */
    }
    if (servicos && !servicoOk(servicos, 'llama')) {
      toast('llama-server indisponível — o roteiro não será gerado. Inicie-o antes.', true);
      return;
    }
    const payload = { topico: t };
    if (aba === 'assunto') {
      if (assunto.trim()) payload.material = assunto.trim();
    } else if (aba === 'pdf') {
      const arquivo = pdfInput.current?.files?.[0];
      if (!arquivo) {
        toast('Selecione um arquivo PDF.', true);
        return;
      }
      if (!/\.pdf$/i.test(arquivo.name)) {
        toast('O arquivo precisa ter extensão .pdf.', true);
        return;
      }
      try {
        payload.pdf = { nome: arquivo.name, base64: await arquivoParaBase64(arquivo) };
      } catch (e) {
        toast(`Erro ao ler o PDF: ${e.message}`, true);
        return;
      }
    } else if (aba === 'texto') {
      if (texto.trim()) payload.material = texto.trim();
    }
    setCriando(true);
    try {
      const res = await api('/api/roteiro', { method: 'POST', body: JSON.stringify(payload) });
      setTitulo('');
      setAssunto('');
      setTexto('');
      setPdfNome(null);
      if (pdfInput.current) pdfInput.current.value = '';
      setAba('assunto');
      await abrirAula(res.slug);
      if (res.pdf) {
        toast(`PDF importado (${res.pdf.paginas} páginas) — roteiro gerado a partir do material!`);
      } else {
        toast('Roteiro gerado! Revise o texto na etapa Roteiro.');
      }
    } catch (e) {
      toast(e.message, true);
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="form-nova-aula" id="form-nova-aula">
      <div className="form-nova-aula-campos">
        <div className="form-campo">
          <label className="form-label" htmlFor="input-titulo">Título da aula</label>
          <input
            id="input-titulo"
            type="text"
            className="form-input"
            placeholder='Ex.: "A doutrina da Trindade"'
            autoComplete="off"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') criarAula(); }}
          />
        </div>
        <div className="form-campo">
          <div className="form-label-row">
            <label className="form-label">Contexto <span className="form-label-opcional">(opcional)</span></label>
            <div className="ctx-tabs" id="ctx-tabs">
              {[
                ['assunto', 'Assunto'],
                ['pdf', '📄 PDF'],
                ['texto', 'Texto'],
              ].map(([id, rotulo]) => (
                <button
                  key={id}
                  className={`ctx-tab${aba === id ? ' ativa' : ''}`}
                  data-tab={id}
                  type="button"
                  onClick={() => setAba(id)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          {aba === 'assunto' && (
            <div className="ctx-painel" id="ctx-assunto">
              <input
                id="input-assunto"
                type="text"
                className="form-input"
                placeholder='Ex.: "Foco em Calvino e a predestinação"'
                value={assunto}
                onChange={(e) => setAssunto(e.target.value)}
              />
            </div>
          )}
          {aba === 'pdf' && (
            <div className="ctx-painel" id="ctx-pdf">
              <div
                className="pdf-drop-area"
                id="pdf-drop-area"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const arquivo = e.dataTransfer?.files?.[0];
                  if (arquivo) setPdfArquivo(arquivo);
                }}
                onClick={() => pdfInput.current?.click()}
              >
                <span className="pdf-drop-icone">📄</span>
                <span className="pdf-drop-texto" id="pdf-drop-texto">
                  {pdfNome ? `📎 ${pdfNome}` : 'Clique ou arraste um PDF aqui'}
                </span>
                <input
                  id="input-pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="pdf-input-real"
                  ref={pdfInput}
                  onChange={() => {
                    const arquivo = pdfInput.current?.files?.[0];
                    if (arquivo) setPdfArquivo(arquivo);
                  }}
                />
              </div>
            </div>
          )}
          {aba === 'texto' && (
            <div className="ctx-painel" id="ctx-texto">
              <textarea
                id="input-texto-contexto"
                className="form-textarea"
                rows="5"
                placeholder="Cole aqui o texto de referência para a aula..."
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>
      <div className="form-nova-aula-rodape">
        <button className="btn btn-primario btn-criar-aula" id="btn-nova-aula" type="button" onClick={criarAula} disabled={criando}>
          ✦ Criar aula
        </button>
      </div>
    </div>
  );
}

function ListaAulas() {
  const { aulas, abrirAula, renomearAula, excluirAula } = useStudio();

  if (!aulas.length) {
    return <p style={{ color: 'var(--texto-3)' }}>Nenhuma aula ainda — crie uma acima.</p>;
  }
  return (
    <>
      {aulas.map((a) => {
        const badges = (
          <>
            {a.imagensCompletas
              ? <span className="badge ok">✓ imagens</span>
              : <span className="badge alerta">imagens</span>}
            {a.audioCompleto
              ? <span className="badge ok">✓ áudio</span>
              : <span className="badge alerta">áudio</span>}
            {a.videoPronto ? <span className="badge ok">✓ vídeo</span> : null}
            {a.shortPronto ? <span className="badge ok">✓ short</span> : null}
            {a.pdfPronto ? <span className="badge ok">✓ PDF</span> : null}
          </>
        );
        return (
          <div key={a.slug} className="card-aula" onClick={() => abrirAula(a.slug)}>
            <div className="card-thumb-wrap">
              {a.thumbnail
                ? <img className="card-thumb" src={a.thumbnail} alt="" loading="lazy" />
                : <div className="card-thumb card-thumb-placeholder">✦</div>}
              <button
                className="btn-renomear"
                data-slug={a.slug}
                title="Renomear título da aula"
                onClick={(e) => { e.stopPropagation(); renomearAula(a.slug, a.titulo_aula); }}
              >
                ✏️
              </button>
              <button
                className="btn-excluir"
                data-slug={a.slug}
                title="Excluir aula"
                onClick={(e) => { e.stopPropagation(); excluirAula(a.slug, a.titulo_aula); }}
              >
                🗑
              </button>
            </div>
            <h3>{a.titulo_aula}</h3>
            <div className="meta">{a.slides} slides</div>
            <div className="badges">{badges}</div>
          </div>
        );
      })}
    </>
  );
}

export default function Dashboard() {
  return (
    <div className="container">
      <h1 className="titulo-pagina">Aulas</h1>
      <NovaAula />
      <div id="lista-aulas" className="grid-aulas">
        <ListaAulas />
      </div>
    </div>
  );
}
