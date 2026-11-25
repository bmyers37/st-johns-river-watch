// Used by the launcher's --screenshot and --self-test options.
//   node scripts/capture.mjs screenshot <file.png>
//   node scripts/capture.mjs self-test <file.json>
// Starts the server on a spare port, opens the app in headless Chrome/Edge (no window, never takes
// focus), waits for live data, then either saves a picture or drives the app and records results.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [mode, outArg] = process.argv.slice(2);
if (!['screenshot', 'self-test'].includes(mode) || !outArg) {
  console.error('usage: node scripts/capture.mjs screenshot|self-test <file>');
  process.exit(2);
}
const out = path.resolve(outArg);
fs.mkdirSync(path.dirname(out), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].find((p) => p && fs.existsSync(p));

const PORT = await freePort();
const base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(root, 'dist-server', 'index.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });

const steps = [];
const step = (name, passed, detail) => steps.push({ step: name, passed, detail });
let browser;
let code = 0;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await sleep(250);
  }
  if (!browserPath) throw new Error('Chrome or Edge is needed to render the app');
  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--window-size=1600,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars', '--mute-audio'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // first visit should show the default Titusville / Lake Harney / Cocoa view
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  // live data: wait for station markers and the end of the loading notice (sources can be slow)
  await page.waitForFunction(() => document.querySelectorAll('.stn').length > 10 && !document.body.innerText.includes('Loading live river data'), { timeout: 150000, polling: 500 }).catch(() => {});
  await page.waitForFunction(() => window.__map?.loaded(), { timeout: 20000, polling: 500 }).catch(() => {});
  await sleep(2500);

  if (mode === 'screenshot') {
    await page.screenshot({ path: out });
    console.log(`saved ${out}`);
  } else {
    // move: pan the map by dragging, like a person would
    const before = await page.evaluate(() => window.__map.getCenter().toArray());
    const box = await page.$eval('main', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width * 0.55, y: r.y + r.height * 0.6 };
    });
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x - i * 18, box.y - i * 8, { steps: 2 });
    await page.mouse.up();
    await sleep(1200);
    await page.click('.maplibregl-ctrl-zoom-in').catch(() => {});
    await sleep(800);
    const after = await page.evaluate(() => ({ c: window.__map.getCenter().toArray(), z: window.__map.getZoom() }));
    const movedKm = Math.hypot((after.c[0] - before[0]) * 97.7, (after.c[1] - before[1]) * 111.2);
    step('move', movedKm > 1, `dragged the map ${movedKm.toFixed(1)} km and zoomed to ${after.z.toFixed(1)}`);

    // act: select a station from the map and see its details, chart and official thresholds
    const markerCount = await page.$$eval('.stn', (els) => els.length);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.maplibregl-marker')].find((m) => m.textContent?.includes('ft'));
      el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const opened = await page
      .waitForSelector('[aria-label="Water level chart with flood stage bands"] canvas', { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    await sleep(1500);
    const panel = await page.evaluate(() => document.querySelector('section[aria-label="Details panel"]')?.innerText ?? '');
    const name = panel.split('\n')[0];
    step('act', opened && /Current stage/i.test(panel), `${markerCount} station markers; clicked one and opened "${name}" with its water-level chart`);

    // hud: dashboard numbers, refresh countdown and legend are on screen
    const hud = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        active: /Active stations\s*\n?\s*\d+/i.test(t),
        flood: /Above flood stage\s*\n?\s*\d+/i.test(t),
        refresh: /Last successful refresh/i.test(t) && !!document.querySelector('[role="timer"]'),
        legend: /Major flooding/.test(t),
        rows: document.querySelectorAll('tbody tr').length,
      };
    });
    step('hud', hud.active && hud.flood && hud.refresh && hud.legend && hud.rows > 5, `stations/flood counters ${hud.active && hud.flood ? 'shown' : 'missing'}, refresh countdown ${hud.refresh ? 'shown' : 'missing'}, legend ${hud.legend ? 'shown' : 'missing'}, ${hud.rows} table rows`);
    step('no-errors', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'no page errors');
    fs.writeFileSync(out, JSON.stringify({ version: 1, steps }, null, 2));
    console.log(JSON.stringify({ version: 1, steps }, null, 2));
    if (steps.some((s) => !s.passed)) code = 1;
  }
} catch (e) {
  console.error(e.message);
  if (mode === 'self-test') {
    step('run', false, e.message);
    fs.writeFileSync(out, JSON.stringify({ version: 1, steps }, null, 2));
  }
  code = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  process.exit(code);
}
