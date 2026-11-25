// St. Johns River Watch server.
// Serves the built web app and a caching proxy API in front of the public data sources, so the
// browser never has to call dozens of upstream services itself.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import sea from 'node:sea';
import { DataEngine } from '../src/shared/engine';
import { REFRESH_SECONDS } from '../src/shared/config';

const PORT = Number(process.env.PORT ?? 5179);
const standalone = sea.isSea();
const HOST = standalone ? '127.0.0.1' : process.env.HOST ?? '127.0.0.1';
const embeddedAssets = standalone ? new Set(sea.getAssetKeys()) : null;
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '..', 'dist');
const engine = new DataEngine();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

function serveStatic(res: http.ServerResponse, pathname: string) {
  let file = path.resolve(DIST, '.' + pathname);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let asset = path.relative(DIST, file).split(path.sep).join('/');
  if (embeddedAssets) {
    if (!embeddedAssets.has(asset)) asset = 'index.html';
  } else if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  if (!embeddedAssets && !fs.existsSync(file)) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('The app has not been built yet. Run "npm run build" first.');
    return;
  }
  const ext = path.extname(embeddedAssets ? asset : file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  if (embeddedAssets) {
    res.end(Buffer.from(sea.getRawAsset(asset)));
    return;
  }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  let url: URL;
  let p: string;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
    p = decodeURIComponent(url.pathname);
    if (p.includes('\0')) return send(res, 400, { error: 'bad path' });
  } catch {
    return send(res, 400, { error: 'bad path' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, HEAD' });
  }
  try {
    if (!p.startsWith('/api/')) return serveStatic(res, p);
    if (p === '/api/health') return send(res, 200, { ok: true, name: 'St. Johns River Watch', refreshSeconds: REFRESH_SECONDS, time: new Date().toISOString() });
    if (p === '/api/snapshot') return send(res, 200, { ...(await engine.snapshot()), mode: 'server' });
    if (p === '/api/mainstem') return send(res, 200, await engine.mainStem(), { 'Cache-Control': 'public, max-age=3600' });
    let m = p.match(/^\/api\/station\/([^/]+)\/history$/);
    if (m) {
      const requestedHours = Number(url.searchParams.get('hours') ?? 48);
      if (!Number.isFinite(requestedHours)) return send(res, 400, { error: 'bad hours' });
      const hours = Math.min(24 * 92, Math.max(1, Math.round(requestedHours)));
      return send(res, 200, await engine.history(m[1], hours));
    }
    m = p.match(/^\/api\/station\/([^/]+)\/detail$/);
    if (m) return send(res, 200, await engine.stationDetail(m[1]));
    m = p.match(/^\/api\/layer\/([A-Za-z]+)$/);
    if (m) {
      const bboxParam = url.searchParams.get('bbox');
      const bbox = bboxParam ? (bboxParam.split(',').map(Number) as [number, number, number, number]) : null;
      if (bbox && (bbox.length !== 4 || bbox.some((n) => !isFinite(n)))) return send(res, 400, { error: 'bad bbox' });
      const zoom = Number(url.searchParams.get('zoom') ?? 12);
      if (!Number.isFinite(zoom)) return send(res, 400, { error: 'bad zoom' });
      return send(res, 200, await engine.layer(m[1], bbox, zoom));
    }
    if (p === '/api/point') {
      const lat = Number(url.searchParams.get('lat') ?? NaN);
      const lon = Number(url.searchParams.get('lon') ?? NaN);
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return send(res, 400, { error: 'bad coordinates' });
      return send(res, 200, await engine.point(lat, lon));
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(`[api] ${p}:`, (e as Error).message);
    return send(res, p.startsWith('/api/') ? 502 : 500, { error: 'request failed' });
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = address && typeof address !== 'string' ? address.port : PORT;
  console.log(`\n  St. Johns River Watch is listening on ${HOST}:${port}\n`);
  console.log('  Leave this window open. Close it (or press Ctrl+C) to stop the app.\n');
  if (standalone && !process.argv.includes('--no-browser')) {
    const url = `http://127.0.0.1:${port}`;
    execFile('cmd.exe', ['/d', '/c', 'start', url], { windowsHide: true }, (error) => {
      if (error) console.error(`  Open ${url} in your browser.`);
    });
  }
  // Warm the caches so the first page load is quick.
  engine.snapshot().then(
    (s) => console.log(`  Loaded ${s.stations.length} stations, ${s.rain.length} rain gauges, ${s.alerts.length} official alerts.`),
    (e) => console.error('  First data load failed:', e.message),
  );
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use - St. Johns River Watch may already be running. Open http://127.0.0.1:${PORT}`);
  else console.error(e);
  process.exit(1);
});
