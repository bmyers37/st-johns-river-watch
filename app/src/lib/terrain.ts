// Terrain-based ESTIMATE of where surface water would run from a point: steepest descent over a
// digital elevation model (AWS Open Data "Terrarium" tiles, built from USGS 3DEP in the US).
// This ignores culverts, pipes, pumps and ditches too narrow for the model, so it is labelled as
// an estimate everywhere it is shown.

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_ZOOM = 14;
const tileCache = new Map<string, Promise<Float32Array | null>>();

function loadTile(x: number, y: number, z: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  let p = tileCache.get(key);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, 256, 256).data;
        const out = new Float32Array(256 * 256);
        for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        resolve(out);
      };
      img.onerror = () => resolve(null);
      img.src = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    });
    tileCache.set(key, p);
  }
  return p;
}

const worldPx = (lat: number, lon: number, z: number) => {
  const n = 256 * 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y] as const;
};
const pxToLngLat = (x: number, y: number, z: number): [number, number] => {
  const n = 256 * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
};

async function elevPx(px: number, py: number, z: number): Promise<number | null> {
  const tx = Math.floor(px / 256);
  const ty = Math.floor(py / 256);
  const t = await loadTile(tx, ty, z);
  if (!t) return null;
  const v = t[(Math.floor(py) - ty * 256) * 256 + (Math.floor(px) - tx * 256)];
  return isFinite(v) ? v * 3.28084 : null; // metres -> feet
}

export async function demElevationFt(lat: number, lon: number): Promise<number | null> {
  const [x, y] = worldPx(lat, lon, DEM_ZOOM);
  return elevPx(x, y, DEM_ZOOM);
}

export interface DescentResult {
  path: [number, number][];
  elevations: number[];
  stopReason: string;
  lengthM: number;
}

/**
 * Follows the lowest neighbouring cell (radius grows when the ground is flat) until it reaches a
 * local low spot, the given stop elevation, or the step limit.
 */
export async function steepestDescent(lat: number, lon: number, stopAtFt?: number, maxSteps = 260): Promise<DescentResult> {
  const z = DEM_ZOOM;
  let [x, y] = worldPx(lat, lon, z);
  x = Math.floor(x) + 0.5;
  y = Math.floor(y) + 0.5;
  const path: [number, number][] = [pxToLngLat(x, y, z)];
  let cur = await elevPx(x, y, z);
  if (cur === null) return { path, elevations: [], stopReason: 'Elevation model unavailable here', lengthM: 0 };
  const elevations = [cur];
  const visited = new Set<string>([`${Math.floor(x)},${Math.floor(y)}`]);
  const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
  let lengthM = 0;
  let stopReason = 'Reached the step limit (about 10 km)';
  for (let step = 0; step < maxSteps; step++) {
    let best: { x: number; y: number; e: number; d: number } | null = null;
    for (const r of [1, 2, 4, 6]) {
      const cand: Promise<{ x: number; y: number; e: number | null; d: number }>[] = [];
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (visited.has(`${Math.floor(nx)},${Math.floor(ny)}`)) continue;
          cand.push(elevPx(nx, ny, z).then((e) => ({ x: nx, y: ny, e, d: Math.hypot(dx, dy) })));
        }
      for (const c of await Promise.all(cand)) {
        if (c.e === null) continue;
        const slope = (cur - c.e) / c.d;
        if (c.e < cur - 0.01 && (!best || slope > (cur - best.e) / best.d)) best = { x: c.x, y: c.y, e: c.e, d: c.d };
      }
      if (best) break;
    }
    if (!best) {
      stopReason = 'Path ends in a local low spot (pond, wetland, or a culvert/ditch the model cannot see)';
      break;
    }
    lengthM += best.d * mPerPx;
    x = best.x;
    y = best.y;
    cur = best.e;
    visited.add(`${Math.floor(x)},${Math.floor(y)}`);
    path.push(pxToLngLat(x, y, z));
    elevations.push(cur);
    if (stopAtFt !== undefined && cur <= stopAtFt) {
      stopReason = 'Reached ground at about the level of the nearby water surface';
      break;
    }
  }
  return { path, elevations, stopReason, lengthM };
}
