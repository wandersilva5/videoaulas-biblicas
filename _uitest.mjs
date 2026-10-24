import { chromium } from 'playwright-core';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
page.on('dialog', (d) => d.accept());
const erros = [];
page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));

const audios = () => page.$$eval('.item-audio-quiz audio', (els) => els.map((e) => (e.getAttribute('src') ? 'src-ok' : 'SEM-SRC')));
const tocar = () => page.evaluate(async () => {
  const r = [];
  for (const el of document.querySelectorAll('.item-audio-quiz audio')) {
    try { await el.play(); el.pause(); r.push(el.getAttribute('src') ? 'tocou' : 'falhou(no-src)'); }
    catch (e) { r.push(el.getAttribute('src') ? 'falhou(src-ok): ' + e.message : 'falhou(no-src)'); }
  }
  return r;
});

await page.goto('http://localhost:5176/#/aula/teste-quiz-ui/8', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.item-audio-quiz', { timeout: 20000 });

const srcInicial = await page.locator('.item-audio-quiz audio').first().getAttribute('src');
console.log('1) audios/carregados:', (await page.$$('.item-audio-quiz audio')).length, JSON.stringify(await audios()));

// --- Regenera o áudio da Pergunta 1 (job real de TTS) ---
await page.locator('.item-audio-quiz').nth(0).locator('button:has-text("regenerar")').click();
console.log('2) botao regenerar cliq, job em curso...');

// Espera o novo mtime (cache-buster) no primeiro item => refetch após o SQL/job.
await page.waitForFunction(
  (inicial) => (document.querySelector('.item-audio-quiz audio')?.getAttribute('src') ?? '') !== inicial,
  srcInicial,
  { timeout: 180000 },
);
await page.waitForTimeout(2500); // dá tempo do refetch propagar aos demais cards

console.log('3) apos regenerar    :', (await page.$$('.item-audio-quiz audio')).length, 'audios');
console.log('4) src de todos      :', JSON.stringify(await audios()));
console.log('5) tocar todos (NADA precisa de F5):', JSON.stringify(await tocar()));
console.log('6) job terminou      :', await page.locator('#status-job:visible').count(), '(0 = banner finalizado)');

// Prova de que é o MESMO elemento React vivo remontado (monitório interno ao card)
console.log('7) card q1 ainda ativo:', await page.locator('.cartao:has-text("Tema um")').count());
await page.screenshot({ path: 'C:\\Users\\FAMLIA~1\\AppData\\Local\\Temp\\opencode\\etapa8-regen.png', fullPage: true });
console.log('erros console:', JSON.stringify(erros));
await browser.close();