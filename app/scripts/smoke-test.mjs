// End-to-end check with real data: starts the server on a spare port, opens the app in headless
// Chrome/Edge, clicks through the main features, saves screenshots to shots/ and reports console
// errors. Stops the server when done.  Usage: npm run smoke  [-- --refresh]  (waits for a 2nd poll)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const base = `http://127.0.0.1:${PORT}`;
const shots = path.join(root, 'shots');
fs.mkdirSync(shots, { recursive: true });
const waitRefresh = process.argv.includes('--refresh');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// click the first button inside `scope` whose text matches
const clickButton = (page, scope, text, exact = false) =>
  page.evaluate(
    (scope, text, exact) => {
      const b = [...document.querySelectorAll(`${scope} button`)].find((x) => (exact ? x.textContent.trim() === text : x.textContent.includes(text)));
      b?.click();
      return !!b;
    },
    scope,
    text,
    exact,
  );

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p));

const server = spawn(process.execPath, [path.join(root, 'dist-server', 'index.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
server.stderr.on('data', (d) => process.stdout.write(`[server] ${d}`));

let browser;
try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    await sleep(500);
  }
  let t = Date.now();
  const snap = await (await fetch(`${base}/api/snapshot`)).json();
  ok('snapshot', Array.isArray(snap.stations) && snap.stations.length > 20, `${snap.stations?.length} stations, ${snap.rain?.length} rain gauges, ${snap.alerts?.length} NWS alerts in ${Date.now() - t} ms`);
  ok('USGS rainfall', snap.rain.some((g) => g.totals.h24 !== undefined), `${snap.rain.length} gauges`);
  const withStage = snap.stations.filter((s) => s.stage);
  ok('stations have timestamps', withStage.every((s) => s.stage.time && s.stage.source), `${withStage.length} with stage`);
  const cocoa = snap.stations.find((s) => s.lid === 'COCF1');
  ok('Cocoa gauge', !!cocoa?.stage, cocoa ? `${cocoa.stage?.value} ft ${cocoa.severity} (${cocoa.severityBasis}), flow ${cocoa.flow?.value} cfs, trend ${cocoa.trend}` : 'missing');
  const hist = await (await fetch(`${base}/api/station/NWPS:COCF1/history?hours=2160`)).json();
  ok('90-day history', (hist.stage?.points?.length ?? 0) > 100, `${hist.stage?.points?.length} pts from ${hist.stage?.source}; forecast ${hist.forecast?.points?.length ?? 0} pts`);
  for (const id of ['ditches', 'structures', 'nhdFlowlines']) {
    const r = await fetch(`${base}/api/layer/${id}?zoom=13&bbox=-80.95,28.6,-80.82,28.7`);
    const j = await r.json();
    ok(`layer ${id}`, r.ok && Array.isArray(j.features), `${j.features?.length} features`);
  }

  if (!browserPath) throw new Error('No Chrome or Edge found for the browser test');
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--window-size=1600,900', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  let snapshotRequests = 0;
  page.on('request', (r) => r.url().includes('/api/snapshot') && snapshotRequests++);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.stn', { timeout: 120000 });
  await sleep(6000);
  const markers = await page.$$eval('.stn', (els) => els.length);
  ok('map markers drawn', markers > 20, `${markers} station markers`);
  await page.screenshot({ path: path.join(shots, 'now.png') });

  // open the Cocoa station panel from the table
  const rows = await page.$$('tbody tr');
  let clicked = false;
  for (const r of rows) {
    const txt = await r.evaluate((el) => el.textContent);
    if (txt?.includes('Cocoa')) {
      await r.click();
      clicked = true;
      break;
    }
  }
  await page.waitForSelector('[aria-label="Water level chart with flood stage bands"] canvas', { timeout: 60000 });
  await sleep(2500);
  ok('station panel + chart', clicked, 'opened St. Johns River near Cocoa');
  for (const label of ['24 h', '90 d']) {
    await clickButton(page, 'section[aria-label="Details panel"]', label, true);
    await sleep(label === '90 d' ? 6000 : 1500);
  }
  await page.screenshot({ path: path.join(shots, 'station.png') });

  // layers panel
  await clickButton(page, 'main', 'Layers');
  await sleep(800);
  await page.screenshot({ path: path.join(shots, 'layers.png') });
  await clickButton(page, 'main', 'Layers');

  // Drop a pin near a known point in the basin without relying on a map shortcut.
  await page.click('button[aria-label="Close panel"]');
  await page.evaluate(() => window.__map.jumpTo({ center: [-80.895, 28.651], zoom: 13.2, padding: { top: 0, bottom: 0, left: 0, right: 0 } }));
  await page.click('button[aria-label="Drop an analysis pin"]');
  const box = await page.$eval('main', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w * 0.5 + 60, box.y + box.h * 0.5);
  await page.waitForFunction(() => document.body.innerText.includes('Local drainage analysis'), { timeout: 30000 });
  await page.waitForFunction(() => /ft NAVD88/.test(document.body.innerText), { timeout: 90000 }).catch(() => {});
  await sleep(8000);
  const pinText = await page.evaluate(() => document.querySelector('section[aria-label="Details panel"]')?.textContent ?? '');
  ok('pin analysis', /ft NAVD88/.test(pinText), pinText.match(/Joins the St\. Johns River[^.]*\./)?.[0] ?? pinText.slice(0, 160));
  await page.screenshot({ path: path.join(shots, 'pin.png') });

  // alerts panel
  await page.click('button[aria-label="Alerts"]');
  await sleep(1200);
  await page.screenshot({ path: path.join(shots, 'alerts.png') });

  // light theme
  await page.click('button[aria-label="Toggle light or dark theme"]');
  await page.click('button[aria-label="Close panel"]');
  await sleep(1500);
  await page.screenshot({ path: path.join(shots, 'light.png') });
  await page.click('button[aria-label="Toggle light or dark theme"]');

  // Exercise search and permission-based centering with a phone-sized screen.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await browser.defaultBrowserContext().overridePermissions(base, ['geolocation']);
  await page.setGeolocation({ latitude: 28.37, longitude: -80.88 });
  await page.evaluate(() => localStorage.removeItem('sjrw:dashboardOpen'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button::-p-text(Near me)', { visible: true });
  await clickButton(page, 'main', 'Near me', true);
  await page.type('input[aria-label="Search town or gauge"]', 'Cocoa');
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Nearby gauges"] button.card')]
    .some((button) => /cocoa/i.test(button.textContent)), { timeout: 60000 });
  ok('mobile gauge search', true);
  await clickButton(page, '[aria-label="Nearby gauges"]', 'Use my location', true);
  await page.waitForFunction(() => document.querySelector('[aria-label="Nearby gauges"] button.card')?.textContent.includes('Measured') &&
    Math.abs(window.__map.getCenter().lat - 28.37) < .01);
  await page.click('[aria-label="Nearby gauges"] button.card');
  await page.waitForSelector('[aria-label="Details panel"]');
  ok('mobile nearby gauges', true);

  if (waitRefresh) {
    const before = snapshotRequests;
    const center0 = await page.evaluate(() => localStorage.getItem('sjrw:basinView'));
    console.log('waiting 130 s for the automatic refresh…');
    await sleep(130000);
    const center1 = await page.evaluate(() => localStorage.getItem('sjrw:basinView'));
    ok('automatic refresh', snapshotRequests > before, `${snapshotRequests - before} snapshot request(s) in 130 s; map view unchanged: ${center0 === center1}`);
  }

  const relevant = errors.filter((e) => !/Failed to load resource|net::ERR|tile|404|AJAXError/i.test(e));
  ok('no console errors', relevant.length === 0, relevant.slice(0, 5).join(' | ') || `${errors.length} network-only messages ignored`);
  if (errors.length) console.log('console messages:', errors.slice(0, 10));
} catch (e) {
  ok('smoke test ran', false, e.message);
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  fs.writeFileSync(path.join(shots, 'smoke-results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
