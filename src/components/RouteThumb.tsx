import React, { useEffect, useRef, useState } from 'react';
import type { Activity } from '../types';
import { dataService } from '../lib/supabase';
import { decodePolyline, routeOutline } from '../lib/routePreview';

const COLORS: Record<string, string> = {
  cycling: '#34D399', zwift: '#2DD4BF', skimo: '#38BDF8', backcountry_skiing: '#60A5FA',
  resort_skiing: '#F472B6', scrambling: '#A78BFA', weighted_hiking: '#FBBF24',
};

// Older activities have no stored outline yet: work them out a couple at a time as their cards come into view
const MAX_PARALLEL = 2;
let running = 0;
const waiting: (() => void)[] = [];
const inQueue = new Set<string>();
function enqueue(id: string, job: () => Promise<void>) {
  if (inQueue.has(id)) return;
  inQueue.add(id);
  const start = () => {
    running++;
    job().finally(() => {
      running--;
      inQueue.delete(id);
      waiting.shift()?.();
    });
  };
  if (running < MAX_PARALLEL) start();
  else waiting.push(start);
}

interface RouteThumbProps {
  activity: Activity;
  /** Called once an outline has been worked out for an activity that had none, so it can be saved */
  onResolved?: (id: string, outline: string) => void;
}

/** The route drawn as a simple line (north up), for activity cards. Nothing is shown for activities without GPS. */
export const RouteThumb: React.FC<RouteThumbProps> = ({ activity, onResolved }) => {
  const stored = activity.map_summary_polyline;
  const ref = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<string | null | undefined>(stored);
  useEffect(() => setOutline(stored), [stored]);

  useEffect(() => {
    if (outline !== undefined && outline !== null) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      enqueue(activity.id, async () => {
        try {
          const stream = activity.streams_data?.length ? activity.streams_data : (await dataService.getActivityById(activity.id))?.streams_data;
          const result = routeOutline(stream);
          setOutline(result);
          onResolved?.(activity.id, result);
        } catch (err) {
          console.warn('Route preview failed:', err);
        }
      });
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activity.id, activity.streams_data, outline, onResolved]);

  if (outline === '') return null;
  const pts = outline ? decodePolyline(outline) : [];
  if (pts.length < 2) {
    // Still loading: keep the space so the card does not jump when the route arrives
    return <div ref={ref} className="h-24 rounded-xl bg-slate-900/60 border border-white/5 animate-pulse" aria-hidden />;
  }

  const W = 300;
  const H = 96;
  const pad = 8;
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const xs = pts.map(([, lng]) => lng * k);
  const ys = pts.map(([lat]) => -lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1e-9;
  const spanY = Math.max(...ys) - minY || 1e-9;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = (W - spanX * scale) / 2;
  const oy = (H - spanY * scale) / 2;
  const coords = xs.map((x, i) => [ox + (x - minX) * scale, oy + (ys[i] - minY) * scale]);
  const d = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const color = COLORS[activity.sport_type] ?? '#38BDF8';
  const [sx, sy] = coords[0];
  const [ex, ey] = coords[coords.length - 1];

  return (
    <div ref={ref} className="h-24 rounded-xl bg-slate-900/60 border border-white/5 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Route of ${activity.title}`}>
        <path d={d} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx} cy={sy} r={3.5} fill="#10B981" stroke="#0F172A" strokeWidth={1.5} />
        <circle cx={ex} cy={ey} r={3.5} fill="#F43F5E" stroke="#0F172A" strokeWidth={1.5} />
      </svg>
    </div>
  );
};
