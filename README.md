# Estúdio de Videoaulas de Teologia

Pipeline local que transforma um **tópico de teologia** em uma **videoaula narrada** (MP4): `roteiro.json` → imagens dos slides → narração (MP3) → vídeo final. Sem `package.json`, sem npm, sem build, sem testes. Scripts Node ESM puros executados com `node`; dependências de terceiros são vendored em `node_modules/`.

## Índice

- [Como funciona](#como-funciona)
- [Pré-requisitos (serviços externos)](#pré-requisitos-serviços-externos)
- [Início rápido](#início-rápido)
- [Interface web (recomendada)](#interface-web-recomendada)
- [Pipeline por linha de comando](#pipeline-por-linha-de-comando)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Contrato do `roteiro.json`](#contrato-do-roteirojson)
- [Layout de saída e idempotência](#layout-de-saída-e-idempotência)
- [Renderizador de vídeo (local)](#renderizador-de-vídeo-local)
- [Variáveis de ambiente / configuração](#variáveis-de-ambiente--configuração)
- [Pontos de atenção (gotchas)](#pontos-de-atenção-gotchas)

## Como funciona

Quatro etapas encadeadas, cada uma consumindo o resultado da anterior:

1. **`gerar_roteiro.mjs`** — chama o **llama-server** (OpenAI-compatible) com um prompt de professor de teologia bíblica e gera o `roteiro.json` (título, introdução, ≥15 slides com pontos/narração/referência bíblica/prompt de imagem, conclusão).
2. **`gerar_imagens.mjs`** — envia cada `imagem_prompt` ao **ComfyUI** (workflow Z-Image Turbo) e salva `slide-NN.png`.
3. **`gerar_narracao.mjs`** — usa o **Qwen3-TTS** (clone de voz local, padrão `TTS=qwen`) para gerar os MP3s de narração (introdução, cada slide, conclusão) com fallback para `edge-tts` (voz `pt-BR-AntonioNeural`, env `VOZ`).
4. **`montar_video.mjs`** — consome o `roteiro.json` + PNGs + MP3s e renderiza o MP4 final via **html-video** (Chromium headless + ffmpeg), com frames animados, marca d'água "TEOLOGIA PRA TODOS" e áudio mixado.

Cada etapa imprime seu resultado JSON no stdout; linhas de progresso/log vão para o stderr.

## Pré-requisitos (serviços externos)

O pipeline depende de quatro serviços, todos locais e específicos da máquina:

| Serviço | Endereço | Função |
|---|---|---|
| **llama-server** (llama.cpp, OpenAI-compatible) | `http://127.0.0.1:8091` | Gera o roteiro (env `LLAMA_URL`) |
| **ComfyUI** | `http://127.0.0.1:8188` | Gera as imagens dos slides (env `COMFY_URL`) |
| **Qwen3-TTS** (engine GGUF + onnxruntime) | local (`E:\llama.cpp\qwen3-tts-gguf`, env `QWEN_ROOT`) | Narração via clone de voz (env `TTS=qwen` padrão; fallback `edge-tts`) |
| **ffmpeg / ffprobe** (no PATH) | — | Usados pelo `montar_video.mjs` |

### Workflow Z-Image Turbo (ComfyUI)

As imagens usam o workflow **Z-Image Turbo**:

- `UnetLoaderGGUFAdvanced` com `z-image\z_image_turbo-Q4_K_M.gguf`
- `CLIPLoader` tipo `lumina2` com `qwen\qwen3_4b_fp8_scaled.safetensors`
- LoRA `z-image\z-image-anime-01.safetensors` (strength 0.8)
- `ModelSamplingAuraFlow` (shift 7)
- VAE `FLUX-Anime-VAE-B2.safetensors`
- `KSampler`: 9 passos, cfg 1.0, euler/normal, 1152x640

O diretório de saída do ComfyUI é fixo em `D:\ComfyUI_windows_portable\ComfyUI\output` (env `COMFY_OUTPUT_DIR`).

> **Gotcha conhecido**: o custom node `ComfyUI-GGUF-FantasyTalking` sobrescreve `UnetLoaderGGUF` e `CLIPLoaderGGUF` com retornos quebrados (tipo `WANVIDEOMODEL` e lista de arquiteturas antiga sem `qwen3`). Por isso o pipeline usa `UnetLoaderGGUFAdvanced` + `CLIPLoader` (safetensors), que não são afetados.

## Início rápido

Se você tem todos os serviços de pé, basta:

```sh
node scripts/pipeline.mjs "O que é Teologia? Uma introdução"
```

O vídeo sai em `output/<slug>/<slug>-1920x1080.mp4`.

Para iniciar os serviços (llama-server, ComfyUI e servidor web) com um único comando, use o controlador:

```sh
iniciar.bat
```

Ele verifica/sobe os 3 serviços, mostra o status, abre a interface no navegador e encerra tudo ao fechar a janela. Os caminhos dos executáveis são lidos do `.config.json` (chaves `LLAMA_EXE`, `LLAMA_MODEL`, `COMFY_DIR`, `PORTA`), com fallback para os padrões fixos dentro do script — basta configurar na interface web (botão ⚙) e o `iniciar.bat` passa a usar. No encerramento, o script só mata processos na porta se o nome do processo bater com o esperado (`node`, `llama-server`, `python`), para não derrubar algo não relacionado.

## Interface web (recomendada)

Orquestra as 4 etapas em **loop** (editar/regenerar qualquer etapa a qualquer momento), com progresso ao vivo:

```sh
node scripts/servidor.mjs
# abra http://localhost:5176
```

- **Backend** Node zero-dependência (`node:http` + SSE) em `scripts/servidor.mjs`; **frontend** é uma SPA pura em `web/` (`index.html`, `style.css`, `app.js`). Sem npm/build.
- Porta padrão `5176` — o env `PORTA` tem precedência sobre `.config.json` (persistido pela UI em "Configurações").
- As etapas rodam via `child_process.spawn` reutilizando os mesmos scripts; o progresso (stderr) chega ao navegador por SSE em `/api/progresso`. Só **um job ativo por vez** (evita escrita concorrente).
- `GET/PUT /api/roteiro/:slug` edita o roteiro; `POST /api/imagens|narracao|video/:slug` regenera tudo ou um item (`{slideId}` apaga só o PNG/MP3 e re-roda a etapa, que pula os existentes). Vídeo exige imagem + áudio de todos os slides (retorna 400 com diagnóstico).
- `manifesto.json` (em `output/<slug>/`) guarda hashes do texto/prompt por item para marcar itens "desatualizados" na UI.
- `/media/<slug>/...` serve PNGs/MP3s/MP4s da saída.
- Botão **"◉ Serviços"** no topo mostra o status dos pré-requisitos (via `GET /api/health`): llama-server, ComfyUI, **Qwen3-TTS**, ffmpeg, ffprobe e Chromium. A UI bloqueia/avisa antes de uma etapa cujo serviço está fora (ex.: roteiro sem llama-server, imagens sem ComfyUI, narração sem Qwen3-TTS, vídeo sem ffmpeg/Chromium).
- Estado de job: `GET /api/job` (job ativo + último resultado) e `POST /api/cancelar-job`. A UI mostra um indicador "🔄 etapa em andamento" no topo, banner com tempo decorrido e botão "✕ Cancelar", e sonda `/api/job` a cada 5s — o status **sobrevive a recarregar a página** (o SSE não re-apresenta jobs já iniciados).

### API do servidor

| Método/rota | Função |
|---|---|
| `GET /` + estáticos | Serve a SPA |
| `GET /api/aulas` | Lista `output/*` com `roteiro.json` + status de artefatos por slide |
| `POST /api/roteiro` `{topico}` | Roda `gerar_roteiro` e retorna o roteiro |
| `GET/PUT /api/roteiro/:slug` | Lê/salva edições do `roteiro.json` |
| `POST /api/imagens/:slug` `{slideId?}` | Gera todas ou 1 imagem (regeneração usa seed aleatório) |
| `POST /api/narracao/:slug` `{slideId?, todos?}` | Narração: só o item, todos (forçado) ou apenas os faltantes/desatualizados (padrão — pula MP3 cujo hash do texto já consta no `manifesto.json`) |
| `POST /api/video/:slug` `{fps,width,height,padding}` | Monta o vídeo; retorna `output_path` |
| `GET /api/artefatos/:slug` | Status por slide: PNG? MP3? desatualizado? duração? |
| `GET/PUT /api/config` | Knobs de ambiente (ver [variáveis](#variáveis-de-ambiente--configuração)) |
| `GET /api/health` | Status dos pré-requisitos: llama-server, ComfyUI, **Qwen3-TTS**, ffmpeg, ffprobe, Chromium |
| `GET /api/job` | Estado do job: `{ativo, etapa, jobId, iniciadoEm, ultimo}` (sobrevive a refresh da página) |
| `POST /api/cancelar-job` | Encerra o job ativo (mata o processo; a requisição do job responde 499 `JOB_CANCELADO`) |
| `DELETE /api/aulas/:slug` | Exclui a aula: apaga `output/<slug>/`, `pdfs/<slug>-estudo.pdf` e os projetos de render correspondentes em `.html-video/projects/` |
| `GET /api/progresso` | **SSE** — eventos `{jobId, etapa, percent, linha, tipo}` |

## Pipeline por linha de comando

Cada etapa pode rodar isolada contra um `roteiro.json` existente:

```sh
node scripts/gerar_imagens.mjs output/<slug>/roteiro.json
node scripts/gerar_narracao.mjs output/<slug>/roteiro.json            # pula MP3 já atualizados (manifesto)
node scripts/gerar_narracao.mjs output/<slug>/roteiro.json --todos    # regenera tudo
node scripts/gerar_narracao.mjs output/<slug>/roteiro.json --apenas slide-03
node scripts/montar_video.mjs output/<slug>/roteiro.json
node scripts/gerar_pdf.mjs output/<slug>/roteiro.json            # PDF de estudo
node scripts/gerar_pdf.mjs output/<slug>/roteiro.json --regenerar-enriquecimento  # novo conteúdo complementar
node scripts/smoke.mjs                                          # diagnóstico de sintaxe/binários/serviços
```

O PDF de estudo é enriquecido via **llama-server**: cada slide ganha notas complementares ("Compreendendo melhor") e referências bíblicas adicionais, preenchendo uma página inteira por tema. O conteúdo fica em cache em `output/<slug>/enriquecimento.json`; `PULAR_ENRIQUECIMENTO=1` pula o complemento e o PDF usa só o texto da narração. Se o llama-server estiver indisponível, o PDF é gerado mesmo assim com o conteúdo atual.

## Estrutura do projeto

```
videoaulas-teologia/
├─ scripts/
│  ├─ pipeline.mjs          # orquestra as 4 etapas em sequência (CLI)
│  ├─ gerar_roteiro.mjs     # [1/4] roteiro via llama-server
│  ├─ gerar_imagens.mjs     # [2/4] slides via ComfyUI (Z-Image Turbo)
│  ├─ gerar_narracao.mjs    # [3/4] MP3s via Qwen3-TTS (clone de voz, fallback edge-tts)
│  ├─ montar_video.mjs      # [4/4] MP4 via html-video (Chromium + ffmpeg)
│  ├─ gerar_pdf.mjs         # [5/5] PDF de estudo enriquecido (llama-server + Playwright)
│  ├─ servidor.mjs          # backend web (HTTP + SSE) da interface
│  ├─ util.mjs              # helpers compartilhados (slugDe, hashDe, esc, MIME, prefixoNarracao, itensDoRoteiro)
│  ├─ smoke.mjs             # diagnóstico de sintaxe/binários/serviços (exit 0/1)
│  └─ comfy_test.json       # workflow de teste com outros modelos (não usado no pipeline)
├─ web/
│  ├─ index.html            # SPA (estrutura)
│  ├─ style.css             # tema escuro navy/gold
│  └─ app.js                # lógica da UI (fetch + EventSource)
├─ node_modules/            # deps vendored (html-video core, yaml, playwright)
├─ output/<slug>/           # artefatos por aula (roteiro, PNGs, MP3s, MP4)
├─ .html-video/             # cache de render (seguro apagar)
├─ .config.json             # config persistida pela UI
├─ iniciar.bat              # sobe/encerra llama-server + ComfyUI + web
├─ AGENTS.md                # instruções para agentes de IA (dev)
└─ README.md
```

## Contrato do `roteiro.json`

Modelo de dados compartilhado — escrito pelo `gerar_roteiro.mjs` e consumido por todas as etapas seguintes:

```
titulo_aula, introducao, conclusao    (strings de narração)
slides[]: {
  id,                                (ex.: "slide-01")
  titulo,                            (≤ 8 palavras)
  pontos[],                          (lista de pontos-chave)
  narracao,                          (60–90 palavras)
  referencia_biblica,                (ex.: "João 3:16")
  imagem_prompt                      (EN, flat illustration, sem texto)
}
slug, topico                         (adicionados pelo script)
```

O `gerar_roteiro.mjs` valida o que o modelo retornou antes de salvar: a resposta do LLM passa por `extrairJson` (remove code fences, prosa ao redor) e `repararJsonTruncado` (fecha string aberta, remove vírgula/objeto final, deduplica) antes do parse; depois `repararRoteiro` normaliza `id`/`titulo`/`pontos` e `validarRoteiro` valida o contrato — campos vazios, `narracao` fora de 60–90 palavras, `referencia_biblica` ausente e `imagem_prompt` curto viram **avisos** (não bloqueiam); estrutura quebrada, menos de 15 slides, `narracao`/`imagem_prompt` vazios ou ids inválidos são **erros** que disparam nova tentativa de geração (máx. 3). Erros e avisos aparecem no log da etapa.

## Layout de saída e idempotência

Tudo sai em `output/<slug>/`, onde `slug` = tópico em minúsculas, sem acentos, não-alfanuméricos → `-`. Arquivos:

- `roteiro.json`
- `slide-01.png` … `slide-NN.png`
- `00-intro-narracao.mp3`, `01-narracao.mp3` …, `NN-conclusao-narracao.mp3`
- `narracao-full.mp3` (narração concatenada)
- `<slug>-<LARGURA>x<ALTURA>.mp4` (ex.: `o-que-e-teologia-1920x1080.mp4`; o formato vai no nome para 16:9 e 9:16 coexistirem)

Os PDFs de estudo vão centralizados em `pdfs/` (fora de `output/`), apenas com PDFs: `<slug>-estudo.pdf`. O cache do conteúdo complementar (`enriquecimento.json`) fica em `output/<slug>/` junto do roteiro.

Regras de idempotência:

- Imagens dos slides são **puladas** se `slide-NN.png` já existe.
- O roteiro só é pulado se `PULAR_ROTEIRO=1` e `roteiro.json` existe.
- A narração **pula** MP3 cujo hash do texto já consta no `manifesto.json` (re-rodar sem editar custa 0 TTS); `--todos` ou `POST /api/narracao/:slug {todos:true}` força tudo, `--apenas <id>` força um item.

## Renderizador de vídeo (local)

`scripts/montar_video.mjs` é local (copiado do projeto html-video). Ele consome o contrato `roteiro.json`, lê `slide-NN.png` + `NN-narracao.mp3` do diretório de saída e renderiza com o núcleo do html-video vendored:

- `@html-video/{core,content-graph,adapter-hyperframes}` — dist compilado + `package.json` (copiado de `F:\codigos\html-video\packages\*`; sem fonte, sem build).
- `yaml` — usado pelo `TemplateRegistry` do core.
- `playwright` + `playwright-core` — gravação via Chromium headless. Os binários do navegador **não** são vendored; precisam estar no cache padrão do Playwright (`%LOCALAPPDATA%\ms-playwright`).
- `montar_video.mjs` define `HTML_VIDEO_ROOT` apontando para a raiz deste repositório, então o estado do render vai para `.html-video/` (cache, seguro apagar).

**Não reinstale/altere `node_modules/` via npm** — é um snapshot do output compilado do monorepo html-video. Atualize recopiando de `F:\codigos\html-video\packages\{core,content-graph,adapter-hyperframes}\dist` e do seu `.pnpm`.

Se uma máquina nova não tiver os binários do navegador:

```sh
npx playwright-core install chromium   # a partir de node_modules/playwright-core
```

## Variáveis de ambiente / configuração

| Variável | Uso | Padrão |
|---|---|---|
| `LLAMA_URL` | URL do llama-server | `http://127.0.0.1:8091` |
| `LLAMA_MODEL` | Caminho do GGUF (usado pelo `iniciar.bat`; o nome na API é o basename) | `E:\llama.cpp\models\Qwen3.5-9B-Q4_K_M.gguf` |
| `LLAMA_MODELO` | Nome do modelo (`model`) enviado nas chamadas de roteiro/enriquecimento (precede o basename de `LLAMA_MODEL`) | `Qwen3.5-9B-Q4_K_M.gguf` |
| `COMFY_URL` | URL do ComfyUI | `http://127.0.0.1:8188` |
| `COMFY_OUTPUT_DIR` | Saída de imagens do ComfyUI | `D:\ComfyUI_windows_portable\ComfyUI\output` |
| `ZIMAGE_UNET` | GGUF do UNet Z-Image Turbo | `z-image\z_image_turbo-Q4_K_M.gguf` |
| `ZIMAGE_CLIP` | CLIP do Z-Image | `qwen\qwen3_4b_fp8_scaled.safetensors` |
| `ZIMAGE_VAE` | VAE | `FLUX-Anime-VAE-B2.safetensors` |
| `ZIMAGE_LORA` | LoRA de estilo | `z-image\z-image-anime-01.safetensors` |
| `TTS` | Seletor de TTS: `qwen` (clone de voz, padrão) | `edge-tts` (fallback) | `qwen` |
| `QWEN_ROOT` | Raiz do engine Qwen3-TTS | `E:/llama.cpp/qwen3-tts-gguf` |
| `QWEN_MODEL` | Subpasta do modelo GGUF | `model-base` |
| `QWEN_REF` | WAV da voz de referência | `<root>/voz-base/fernando.wav` |
| `QWEN_REF_START` / `QWEN_REF_END` | Trecho da referência (s) | `30` / `45` |
| `QWEN_REF_TEXTO` | Transcrição exata do trecho de referência | (transcrição do Fernando) |
| `QWEN_MAX_STEPS` | Máx. códigos de áudio (300 ≈ 24s) | `600` |
| `QWEN_TEMP` | Temperatura de amostragem | `0.6` |
| `QWEN_SEED` / `QWEN_SUB_SEED` | Seeds para reprodução | `42` / `45` |
| `QWEN_ZERO_SHOT` | `1` = zero-shot (sem clone, robótico) | `0` |
| `QWEN_ONNX_PROVIDER` | Provider onnxruntime | `CUDA` |
| `VOZ` | Voz do edge-tts (fallback) | `pt-BR-AntonioNeural` |
| `PULAR_ROTEIRO` | `1` pula a geração do roteiro | — |
| `PULAR_ENRIQUECIMENTO` | `1` pula o conteúdo complementar do PDF (usa só a narração) | — |
| `PORTA` | Porta do servidor web (precede `.config.json`) | `5176` |
| `LLAMA_EXE` | Executável do llama-server (usado pelo `iniciar.bat`) | `E:\llama.cpp\llama-server.exe` |
| `COMFY_DIR` | Raiz do ComfyUI portable (usado pelo `iniciar.bat`) | `D:\ComfyUI_windows_portable` |
| `KREA2_SEED_BASE` | Seed base das imagens (regeneração usa seed aleatório) | `1000` |
| `VIDEO_FPS` | FPS do vídeo | `24` |
| `VIDEO_WIDTH` | Largura do vídeo | `1920` |
| `VIDEO_HEIGHT` | Altura do vídeo | `1080` |
| `VIDEO_PADDING` | Pausa (s) entre slides/frames | `0.3` |

## Pontos de atenção (gotchas)

- Não renomeie `.mjs` nem adicione `"type": "module"` — os scripts são ESM puros rodados direto. Todos guardam `main()` (comparando `process.argv[1]` com `import.meta.url`) para permitir import sem efeito colateral.
- Conteúdo em pt-BR; prompts para o LLM em português; `imagem_prompt` sempre em inglês.
- O servidor web reutiliza os scripts via spawn; `montar_video.mjs` **sempre** via spawn.
- A porta padrão é `5176` justamente para não colidir com a convenção `5173` do Vite. Se o navegador abrir o servidor errado (outro projeto na mesma porta), confira com `netstat -ano | findstr :5176` e use `http://127.0.0.1:5176/`.
- Leitura de JSON via PowerShell pode distorcer acentos; os arquivos são UTF-8.
- `scripts/smoke.mjs` valida sintaxe, binários (ffmpeg/ffprobe), cache do Chromium, **Qwen3-TTS** (engine + voz + import python) e serviços (llama `/v1/models`, Comfy `/system_stats`); exit 0/1.
