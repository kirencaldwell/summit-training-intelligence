import type { MetricStreamPoint } from '../types';

/**
 * Small route outlines for activity cards. The outline is stored in `map_summary_polyline` (part of the list
 * query) in the Google encoded-polyline format, the same one Strava uses for its summary maps, so a card can draw
 * the route without loading the activity's full track.
 */

type LatLng = [number, number];

function encodeNumber(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  for (const [lat, lng] of points) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += encodeNumber(la - lastLat) + encodeNumber(ln - lastLng);
    lastLat = la;
    lastLng = ln;
  }
  return out;
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < encoded.length + 1);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    if (index > encoded.length) break;
    lng += next();
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/** Douglas-Peucker on flat x/y (longitude scaled by the cosine of the latitude), keeping the route's shape. */
function simplify(points: LatLng[], tolerance: number): LatLng[] {
  if (points.length < 3) return points;
  const k = Math.cos((points[0][0] * Math.PI) / 180);
  const xy = points.map(([la, ln]) => [ln * k, la]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; at = i; }
    }
    if (at >= 0 && maxD > tolerance * tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * The outline to store for an activity's track: simplified to about 120 points at most. An empty string means
 * "no route" (indoor, or no GPS), so the card does not keep trying to load one.
 */
export function routeOutline(stream: MetricStreamPoint[] | undefined): string {
  const pts: LatLng[] = (stream ?? [])
    .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
      && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180 && !(p.lat === 0 && p.lng === 0))
    .map((p) => [p.lat!, p.lng!]);
  if (pts.length < 5) return '';
  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const k = Math.cos((lats[0] * Math.PI) / 180);
  const extent = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lngs) - Math.min(...lngs)) * k);
  if (extent < 0.0005) return ''; // under ~50 m across: a trainer ride or a GPS glitch, nothing to draw
  let tolerance = extent * 0.004;
  let out = simplify(pts, tolerance);
  while (out.length > 120) {
    tolerance *= 1.6;
    out = simplify(pts, tolerance);
  }
  return encodePolyline(out);
}
