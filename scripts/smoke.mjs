/**
 * smoke.mjs — Diagnóstico rápido de regressões sintaxe/ambiente.
 *
 *   node scripts/smoke.mjs            # relatório humano
 *   node scripts/smoke.mjs --json     # relatório em JSON (exit 0/1)
 *
 * Verifica:
 *   1. sintaxe (node --check) de todos os scripts/*.mjs
 *   2. binários: edge-tts, ffmpeg, ffprobe
 *   3. Chromium do Playwright (cache)
 *   4. conectividade: llama-server (/v1/models) e ComfyUI (/system_stats)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modeloLLama } from './util.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS_DIR, '..');
const JSON_SAIDA = process.argv.includes('--json');

function config() {
  let doArquivo = {};
  try {
    doArquivo = JSON.parse(readFileSync(join(ROOT, '.config.json'), 'utf8'));
  } catch {
    /* sem .config.json */
  }
  if (!process.env.LLAMA_MODEL && doArquivo.LLAMA_MODEL) process.env.LLAMA_MODEL = doArquivo.LLAMA_MODEL;
  return {
    LLAMA_URL: (process.env.LLAMA_URL || doArquivo.LLAMA_URL || 'http://127.0.0.1:8091').replace(/\/+$/, ''),
    COMFY_URL: (process.env.COMFY_URL || doArquivo.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/+$/, ''),
    modelo: modeloLLama(),
  };
}

function checarComando(nome, args = [], maxMs = 8000) {
  const r = spawnSync(nome, args, { encoding: 'utf8', timeout: maxMs, windowsHide: true });
  if (r.error) return { ok: false, versao: null, erro: r.error.code || r.error.message };
  const primeira = (r.stdout || '').trim().split(/\r?\n/)[0] || null;
  return { ok: r.status === 0, versao: primeira, erro: r.status === 0 ? null : `exit ${r.status}` };
}

async function checarHttp(url, timeoutMs = 3000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      return { ok: r.status < 500, versao: null, erro: r.ok ? null : `HTTP ${r.status}` };
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    return { ok: false, versao: null, erro: e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message };
  }
}

async function checarLlama(url, modeloEsperado) {
  const base = await checarHttp(url);
  if (!base.ok) return base;
  try {
    const r = await fetch(url);
    const data = await r.json();
    const nome = data?.models?.[0]?.model ?? data?.data?.[0]?.id ?? null;
    if (!nome) return { ok: false, versao: null, erro: 'llama respondeu, mas sem lista de modelos' };
    const ok = String(nome) === modeloEsperado;
    return { ok, versao: nome, erro: ok ? null : `modelo carregado '${nome}' ≠ esperado '${modeloEsperado}'` };
  } catch (e) {
    return { ok: false, versao: null, erro: e.message };
  }
}

async function checarChromium() {
  try {
    const { chromium } = await import('playwright');
    const exe = chromium.executablePath();
    if (!exe || !existsSync(exe)) return { ok: false, versao: null, erro: 'chromium não instalado no cache do Playwright' };
    return { ok: true, versao: basenameDir(exe), erro: null };
  } catch (e) {
    return { ok: false, versao: null, erro: e.message };
  }
}

function basenameDir(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 2];
}

function checarSintaxe() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .map((f) => {
      const r = spawnSync(process.execPath, ['--check', join(SCRIPTS_DIR, f)], { encoding: 'utf8', windowsHide: true });
      const detalhe = r.status === 0 ? 'ok' : (r.stderr || r.stdout || '').trim().split(/\r?\n/)[0] || `exit ${r.status}`;
      return { nome: f, ok: r.status === 0, versao: null, erro: r.status === 0 ? null : detalhe };
    });
}

async function main() {
  const cfg = config();
  const resultados = {
    sintaxe: checarSintaxe(),
    edge_tts: checarComando('edge-tts', ['--version']),
    ffmpeg: checarComando('ffmpeg', ['-version']),
    ffprobe: checarComando('ffprobe', ['-version']),
    chromium: await checarChromium(),
    llama: await checarLlama(`${cfg.LLAMA_URL}/v1/models`, cfg.modelo),
    comfy: await checarHttp(`${cfg.COMFY_URL}/system_stats`),
  };
  const todas = [
    ...resultados.sintaxe,
    ...Object.entries(resultados)
      .filter(([k]) => k !== 'sintaxe')
      .map(([k, v]) => ({ nome: k, ...v })),
  ];
  const ok = todas.every((r) => r.ok);

  if (JSON_SAIDA) {
    console.log(JSON.stringify({ ok, cfg, resultados }, null, 2));
  } else {
    console.log('Smoke test — Estúdio de Videoaulas');
    console.log('='.repeat(50));
    for (const r of todas) {
      const marca = r.ok ? '✓' : '✕';
      const detalhe = r.ok ? (r.versao || 'ok') : (r.erro || 'falhou');
      console.log(`  ${marca} ${r.nome.padEnd(16)} ${detalhe}`);
    }
    console.log('='.repeat(50));
    console.log(ok ? 'Tudo OK.' : 'Há problemas — veja as linhas com ✕.');
  }
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1]) {
  const scriptPath = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  const argPath = process.argv[1].replace(/\\/g, '/');
  if (scriptPath === argPath) {
    main().catch((e) => {
      console.error('ERRO no smoke test:', e.message);
      process.exit(1);
    });
  }
}
