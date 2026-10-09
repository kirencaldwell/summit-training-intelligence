import React, { useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Key, Loader2, RefreshCw, Waypoints } from 'lucide-react';
import type { Activity } from '../types';
import {
  IntervalsError,
  clearIntervalsSettings,
  describeSync,
  getIntervalsSettings,
  isIntervalsSyncRunning,
  saveIntervalsSettings,
  syncFromIntervals,
  testIntervalsKey,
  type IntervalsSettings,
  type SyncProgress,
} from '../lib/intervals';

interface IntervalsTabProps {
  onActivitiesImported: (activities: Activity[]) => void;
}

const HISTORY_OPTIONS = [
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last year', days: 365 },
  { id: 'all', label: 'Everything', days: 0 },
] as const;

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const IntervalsTab: React.FC<IntervalsTabProps> = ({ onActivitiesImported }) => {
  const [settings, setSettings] = useState<IntervalsSettings | null>(() => getIntervalsSettings());
  const [keyInput, setKeyInput] = useState('');
  const [history, setHistory] = useState<(typeof HISTORY_OPTIONS)[number]['id']>('90');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const connect = async () => {
    const apiKey = keyInput.trim();
    if (!apiKey) {
      setError('Paste your Intervals.icu API key first.');
      return;
    }
    setIsConnecting(true);
    setError('');
    setMessage('');
    try {
      await testIntervalsKey(apiKey);
      const next: IntervalsSettings = { apiKey, auto: true };
      saveIntervalsSettings(next);
      setSettings(next);
      setKeyInput('');
      setMessage('Connected. New activities will be imported automatically when you open the app.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to Intervals.icu.');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    clearIntervalsSettings();
    setSettings(null);
    setMessage('');
    setError('');
  };

  const setAuto = (auto: boolean) => {
    if (!settings) return;
    const next = { ...settings, auto };
    saveIntervalsSettings(next);
    setSettings(next);
  };

  const sync = async (days: number) => {
    if (!settings) return;
    if (isIntervalsSyncRunning()) {
      setError('A sync is already running. Try again in a moment.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSyncing(true);
    setProgress(null);
    setError('');
    setMessage('');
    try {
      const oldest = days > 0 ? isoDate(new Date(Date.now() - days * 24 * 3600 * 1000)) : '2000-01-01';
      const result = await syncFromIntervals({ apiKey: settings.apiKey, oldest, onProgress: setProgress, signal: controller.signal });
      if (result.imported.length > 0) onActivitiesImported(result.imported);
      // Only a full run counts as caught up; a stopped one will be picked up again next time
      if (!result.cancelled) {
        const next = { ...settings, lastSyncAt: new Date().toISOString() };
        saveIntervalsSettings(next);
        setSettings(next);
      }
      setMessage(describeSync(result));
      if (result.failed.length) setError(`Could not import: ${result.failed.slice(0, 3).map((f) => `${f.name} (${f.error})`).join('; ')}${result.failed.length > 3 ? '…' : ''}`);
    } catch (err) {
      if (err instanceof IntervalsError && err.status === 401) {
        setError(`${err.message} Disconnect and paste a fresh key.`);
      } else {
        setError(err instanceof Error ? err.message : 'The sync failed.');
      }
    } finally {
      setIsSyncing(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const chosen = HISTORY_OPTIONS.find((o) => o.id === history)!;

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 p-3.5 rounded-xl border ${settings ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900 border-white/5'}`}>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${settings ? 'bg-emerald-500/20' : 'bg-slate-800'}`}>
          <Waypoints className={`w-4 h-4 ${settings ? 'text-emerald-400' : 'text-slate-500'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{settings ? 'Intervals.icu connected' : 'Intervals.icu not connected'}</p>
          <p className="text-xs text-slate-400">
            {settings
              ? settings.lastSyncAt ? `Last synced ${new Date(settings.lastSyncAt).toLocaleString()}` : 'Not synced yet'
              : 'Free. Collects your Garmin, COROS and Zwift activities in one place.'}
          </p>
        </div>
      </div>

      {!settings ? (
        <>
          <div className="p-3.5 rounded-xl bg-slate-900 border border-white/5 text-xs text-slate-400 space-y-1.5">
            <p className="font-semibold text-white">Set it up once:</p>
            <ol className="list-decimal list-inside space-y-1 leading-relaxed">
              <li>
                In <a href="https://intervals.icu" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline inline-flex items-center">Intervals.icu <ExternalLink className="w-3 h-3 ml-0.5" /></a>,
                open <strong className="text-slate-200">Settings</strong> and connect Garmin Connect, COROS and Zwift.
              </li>
              <li>Further down the same Settings page, find your <strong className="text-slate-200">API key</strong> and copy it.</li>
              <li>Paste it below. It stays in this browser, so enter it once on each device.</li>
            </ol>
            <p className="text-slate-500 pt-1">If a workout comes from both a Garmin and a COROS, the Garmin recording is kept.</p>
          </div>
          <div>
            <label htmlFor="intervals-key" className="text-xs font-semibold text-slate-300 flex items-center mb-1">
              <Key className="w-3.5 h-3.5 mr-1.5 text-cyan-400" /> Intervals.icu API key
            </label>
            <input
              id="intervals-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your API key"
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void connect(); }}
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={isConnecting}
            className="w-full min-h-11 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-slate-950 font-bold text-sm hover:opacity-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {isConnecting ? 'Checking the key…' : 'Connect'}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <label className="flex items-start gap-3 p-3 rounded-xl border border-white/10 bg-slate-900/50 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={settings.auto} onChange={(e) => setAuto(e.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-500" />
            <span>
              <span className="font-semibold text-white">Import automatically</span>
              <span className="block text-slate-400">When the app opens or you return to it, new activities from Intervals.icu are added.</span>
            </span>
          </label>

          <div className="flex flex-col sm:flex-row gap-2">
            <select
              aria-label="How far back to import"
              value={history}
              onChange={(e) => setHistory(e.target.value as typeof history)}
              disabled={isSyncing}
              className="min-h-11 rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white focus:border-cyan-500 focus:outline-none"
            >
              {HISTORY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => void sync(chosen.days)}
              disabled={isSyncing}
              className="flex-1 min-h-11 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-slate-950 font-bold text-sm hover:opacity-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isSyncing ? 'Importing…' : 'Import now'}
            </button>
          </div>

          {isSyncing && (
            <div className="space-y-1.5">
              <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={progress?.total ?? 0} aria-valuenow={progress?.done ?? 0} className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-[width] duration-150" style={{ width: `${percent}%` }} />
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                <span className="truncate">
                  {progress && progress.total > 0
                    ? `Importing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${progress.name ? ` · ${progress.name}` : ''}`
                    : 'Looking for new activities…'}
                </span>
                <button type="button" onClick={() => abortRef.current?.abort()} className="shrink-0 font-semibold text-slate-300 hover:text-white">Stop</button>
              </div>
            </div>
          )}

          <button type="button" onClick={disconnect} className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-medium transition-all">
            Disconnect Intervals.icu
          </button>
        </div>
      )}

      {message && <p className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200">{message}</p>}
      {error && <p role="alert" className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</p>}
    </div>
  );
};
