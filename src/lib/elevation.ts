import type { MetricStreamPoint } from '../types';

/**
 * Elevation gain that ignores sensor noise: a rise only counts once the altitude has climbed `threshold` metres
 * above the last low point, then keeps counting while it keeps rising (a zigzag filter). Summing every positive
 * change instead adds up the jitter of a GPS altitude on every sample, which can double the real figure.
 */
export function hysteresisGain(elevations: number[], threshold: number): number {
  const e = elevations.filter((v) => Number.isFinite(v));
  if (e.length < 2) return 0;
  let dir = 0;
  let lo = e[0];
  let hi = e[0];
  let gain = 0;
  for (let i = 1; i < e.length; i++) {
    const x = e[i];
    if (dir === 1) {
      if (x > hi) { gain += x - hi; hi = x; }
      else if (hi - x >= threshold) { dir = -1; lo = x; }
    } else if (dir === -1) {
      if (x < lo) lo = x;
      else if (x - lo >= threshold) { dir = 1; gain += x - lo; hi = x; }
    } else {
      if (x > hi) hi = x;
      if (x < lo) lo = x;
      if (x - lo >= threshold) { dir = 1; gain += x - lo; hi = x; }
      else if (hi - x >= threshold) { dir = -1; lo = x; }
    }
  }
  return gain;
}

/** Running median, to knock out single-sample spikes before the gain is counted. */
export function medianFilter(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1)).sort((a, b) => a - b);
    return slice[Math.floor(slice.length / 2)];
  });
}

/** Moving average over `window` samples (odd, centred). */
function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return values.slice();
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) { sum += values[j]; n++; }
    return sum / n;
  });
}

/**
 * Elevation gain from a recorded altitude trace (GPS or barometer): spikes removed, about 15 seconds of smoothing,
 * then the zigzag filter. `sampleSeconds` is the time between samples, so a thinned recording is not over-smoothed.
 */
export function recordedGain(elevations: number[], sampleSeconds = 1, threshold = 5): number {
  const clean = elevations.filter((v) => Number.isFinite(v));
  const window = Math.max(1, Math.round(15 / Math.max(sampleSeconds, 0.5))) | 1;
  return hysteresisGain(movingAverage(medianFilter(clean, 5), window), threshold);
}

// ── Terrain model (Terrarium elevation tiles) ───────────────────────────────

const TILE = 256;

export type TileLoader = (z: number, x: number, y: number) => Promise<ArrayLike<number> | undefined>;

const worldPx = (lat: number, lng: number, z: number) => {
  const scale = TILE * 2 ** z;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
};

const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
};

interface LatLng { lat: number; lng: number }

/** The route as points about `stepM` metres apart, so the terrain is sampled evenly however the track was recorded. */
export function resampleRoute(points: LatLng[], stepM: number, maxPoints = 4000): LatLng[] {
  if (points.length < 2) return points.slice();
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  const step = Math.max(stepM, total / maxPoints);
  const out: LatLng[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = haversineM(a.lat, a.lng, b.lat, b.lng);
    if (seg === 0) continue;
    let at = step - carried;
    while (at <= seg) {
      const f = at / seg;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
      at += step;
    }
    carried = seg - (at - step);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Terrarium encoding: elevation in metres = R * 256 + G + B / 256 - 32768. `rgba` is a decoded 256x256 tile. */
const terrariumAt = (rgba: ArrayLike<number>, px: number, py: number) => {
  const i = (py * TILE + px) * 4;
  return rgba[i] * 256 + rgba[i + 1] + rgba[i + 2] / 256 - 32768;
};

/** The highest zoom (max 14, min 9) at which the route needs no more than `maxTiles` tiles. */
function chooseZoom(points: LatLng[], maxTiles: number): number {
  for (let z = 14; z >= 9; z--) {
    const tiles = new Set<string>();
    for (const p of points) {
      const { x, y } = worldPx(p.lat, p.lng, z);
      tiles.add(`${Math.floor(x / TILE)}/${Math.floor(y / TILE)}`);
      if (tiles.size > maxTiles) break;
    }
    if (tiles.size <= maxTiles) return z;
  }
  return 9;
}

/** Terrain elevation (metres) under each point, bilinearly interpolated between tile pixels. Undefined where a tile is missing. */
export async function terrainElevations(points: LatLng[], loadTile: TileLoader, maxTiles = 12): Promise<(number | undefined)[]> {
  const z = chooseZoom(points, maxTiles);
  const cache = new Map<string, ArrayLike<number> | undefined>();
  const tile = async (tx: number, ty: number) => {
    const key = `${tx}/${ty}`;
    if (!cache.has(key)) cache.set(key, await loadTile(z, tx, ty));
    return cache.get(key);
  };
  // Load every needed tile first, in parallel
  const needed = new Set<string>();
  for (const p of points) {
    const { x, y } = worldPx(p.lat, p.lng, z);
    for (const dx of [0, 1]) for (const dy of [0, 1]) needed.add(`${Math.floor((x - 0.5) / TILE) + dx}/${Math.floor((y - 0.5) / TILE) + dy}`);
  }
  await Promise.all([...needed].map((k) => { const [tx, ty] = k.split('/').map(Number); return tile(tx, ty); }));

  const pixel = (gx: number, gy: number): number | undefined => {
    const t = cache.get(`${Math.floor(gx / TILE)}/${Math.floor(gy / TILE)}`);
    if (!t) return undefined;
    return terrariumAt(t, ((Math.floor(gx) % TILE) + TILE) % TILE, ((Math.floor(gy) % TILE) + TILE) % TILE);
  };
  return points.map((p) => {
    const { x, y } = worldPx(p.lat, p.lng, z);
    const gx = x - 0.5;
    const gy = y - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const v00 = pixel(x0, y0);
    const v10 = pixel(x0 + 1, y0);
    const v01 = pixel(x0, y0 + 1);
    const v11 = pixel(x0 + 1, y0 + 1);
    if (v00 === undefined || v10 === undefined || v01 === undefined || v11 === undefined) return undefined;
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
  });
}

export interface TerrainGain {
  /** Gain along the route according to the terrain model, metres */
  gain_m: number;
  /** Gain from the activity's own recorded altitude, same filtering, for comparison; undefined without altitude */
  recorded_m?: number;
  /** Share of the route that had terrain data */
  coverage: number;
}

/** Elevation gain of a recorded route according to the terrain model rather than the device's altitude. */
export async function terrainGain(stream: MetricStreamPoint[] | undefined, loadTile: TileLoader): Promise<TerrainGain | undefined> {
  const route = (stream ?? [])
    .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180 && !(p.lat === 0 && p.lng === 0))
    .map((p) => ({ lat: p.lat!, lng: p.lng! }));
  if (route.length < 10) return undefined;
  const sampled = resampleRoute(route, 30);
  const elevations = await terrainElevations(sampled, loadTile);
  const known = elevations.filter((v): v is number => v !== undefined);
  const coverage = known.length / elevations.length;
  if (coverage < 0.9 || known.length < 10) return undefined;
  // The model is already smooth; a small threshold and a light median remove the pixel stair-stepping
  const gain = hysteresisGain(medianFilter(known, 3), 3);
  const recordedAlts = (stream ?? []).map((p) => p.alt).filter((v): v is number => typeof v === 'number');
  const times = (stream ?? []).map((p) => p.time).filter((t) => Number.isFinite(t));
  const spacing = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 1;
  return { gain_m: gain, recorded_m: recordedAlts.length > 10 ? recordedGain(recordedAlts, spacing) : undefined, coverage };
}

// ── Browser tile loader ─────────────────────────────────────────────────────

const TILE_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const tileCache = new Map<string, Promise<Uint8ClampedArray | undefined>>();

/** Fetches a Terrarium tile and decodes it to RGBA through a canvas (the tile server allows cross-origin reads). */
export const browserTileLoader: TileLoader = (z, x, y) => {
  const n = 2 ** z;
  if (y < 0 || y >= n) return Promise.resolve(undefined);
  const key = `${z}/${((x % n) + n) % n}/${y}`;
  let pending = tileCache.get(key);
  if (!pending) {
    pending = new Promise<Uint8ClampedArray | undefined>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = TILE;
          canvas.height = TILE;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(undefined);
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, TILE, TILE).data);
        } catch {
          resolve(undefined);
        }
      };
      img.onerror = () => resolve(undefined);
      img.src = TILE_URL(z, ((x % n) + n) % n, y);
    });
    tileCache.set(key, pending);
  }
  return pending;
};
