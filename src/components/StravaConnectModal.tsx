/**
 * DataSyncModal.tsx
 * Unified Data Sources hub — FIT file import, COROS OAuth, and legacy Strava.
 * Replaces the old StravaConnectModal.
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  X, Upload, CheckCircle2, AlertCircle, Loader2, Watch, RefreshCw,
  Key, ExternalLink, Mountain, Zap, ChevronRight, FileCode2,
} from 'lucide-react';
import type { Activity } from '../types';
import { parseFitFiles, type FitImportResult } from '../lib/fitParser';
import {
  getCorosAuthUrl,
  getStoredCorosClientId,
  setStoredCorosClientId,
  isCorosConnected,
  clearCorosTokens,
  getCorosAccessToken,
  syncCorosActivities,
} from '../lib/coros';
import { getStoredStravaClientId, setStoredStravaClientId, getStravaAuthUrl } from '../lib/strava';

type Tab = 'fit' | 'coros' | 'strava';

interface DataSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivitiesImported: (activities: Activity[]) => void;
  isSyncing: boolean;
}

// ─── FIT Upload Tab ────────────────────────────────────────────────────────────

const FitUploadTab: React.FC<{ onActivitiesImported: (a: Activity[]) => void }> = ({
  onActivitiesImported,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<FitImportResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (files: File[]) => {
      const fitFiles = files.filter((f) => f.name.toLowerCase().endsWith('.fit'));
      if (fitFiles.length === 0) return;

      setIsProcessing(true);
      setResults([]);

      try {
        const importResults = await parseFitFiles(fitFiles);
        setResults(importResults);
        const successful = importResults
          .filter((r) => r.status === 'success' && r.activity)
          .map((r) => r.activity!);
        if (successful.length > 0) onActivitiesImported(successful);
      } finally {
        setIsProcessing(false);
      }
    },
    [onActivitiesImported]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    },
    [processFiles]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Instructions */}
      <div className="p-3.5 rounded-xl bg-slate-900 border border-white/5 text-xs text-slate-300 space-y-2">
        <p className="font-semibold text-white flex items-center">
          <FileCode2 className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
          Works with Garmin, COROS, Wahoo, Polar, Suunto — any FIT-compatible device
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-400">
          <div>
            <p className="font-semibold text-slate-300">📲 From Garmin Connect:</p>
            <p>Activities → select activity → ⋯ → Export as Original (.fit)</p>
          </div>
          <div>
            <p className="font-semibold text-slate-300">📲 From COROS App:</p>
            <p>Activities → select → Share → Export Data → FIT</p>
          </div>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
          isDragOver
            ? 'border-cyan-400 bg-cyan-500/10 scale-[1.01]'
            : 'border-white/20 hover:border-cyan-500/50 hover:bg-cyan-500/5'
        } ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".fit"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {isProcessing ? (
          <div className="flex flex-col items-center space-y-2">
            <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
            <p className="text-sm font-semibold text-white">Parsing FIT files...</p>
            <p className="text-xs text-slate-400">Calculating NP, TSS, zones...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-3">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${
              isDragOver ? 'bg-cyan-500/20' : 'bg-white/5'
            }`}>
              <Upload className={`w-7 h-7 transition-colors ${isDragOver ? 'text-cyan-400' : 'text-slate-400'}`} />
            </div>
            <div>
              <p className="text-sm font-bold text-white">
                {isDragOver ? 'Drop to import!' : 'Drop .fit files here'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">or click to browse — multiple files supported</p>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Import Results</p>
          {results.map((r) => (
            <div
              key={r.file}
              className={`flex items-start space-x-3 p-3 rounded-xl border text-xs ${
                r.status === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-rose-500/10 border-rose-500/30'
              }`}
            >
              {r.status === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{r.file}</p>
                {r.status === 'success' && r.activity ? (
                  <div className="flex flex-wrap gap-2 mt-1">
                    <span className="text-slate-400">
                      🏔 {r.activity.sport_type.replace('_', ' ')}
                    </span>
                    <span className="text-slate-400">
                      ⏱ {Math.round(r.activity.duration_seconds / 60)}min
                    </span>
                    {r.activity.training_stress_score && (
                      <span className="text-amber-400 font-semibold">
                        TSS {r.activity.training_stress_score}
                      </span>
                    )}
                    {r.activity.total_elevation_gain_m > 0 && (
                      <span className="text-cyan-400">
                        ↑ {r.activity.total_elevation_gain_m}m
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-rose-300 mt-0.5">{r.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── COROS Tab ─────────────────────────────────────────────────────────────────

const CorosTab: React.FC<{ onActivitiesImported: (a: Activity[]) => void }> = ({
  onActivitiesImported,
}) => {
  const [clientIdInput, setClientIdInput] = useState(getStoredCorosClientId());
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const connected = isCorosConnected();

  const handleConnect = () => {
    if (!clientIdInput.trim()) {
      setErrorMsg('Enter your COROS Client ID from developer.coros.com');
      return;
    }
    setStoredCorosClientId(clientIdInput.trim());
    window.location.href = getCorosAuthUrl(clientIdInput.trim());
  };

  const handleSync = async () => {
    const token = getCorosAccessToken();
    if (!token) return;
    setIsSyncing(true);
    setSyncStatus('');
    setErrorMsg('');
    try {
      const activities = await syncCorosActivities(token);
      setSyncStatus(`✓ Synced ${activities.length} activities from COROS`);
      onActivitiesImported(activities);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = () => {
    clearCorosTokens();
    setSyncStatus('');
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={`flex items-center space-x-3 p-3.5 rounded-xl border ${
        connected
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-slate-900 border-white/5'
      }`}>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
          connected ? 'bg-emerald-500/20' : 'bg-slate-800'
        }`}>
          <Watch className={`w-4 h-4 ${connected ? 'text-emerald-400' : 'text-slate-500'}`} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-white">
            {connected ? 'COROS Account Connected' : 'COROS Not Connected'}
          </p>
          <p className="text-xs text-slate-400">
            {connected ? 'Ready to sync activities from your COROS watch' : 'Connect via OAuth2 below'}
          </p>
        </div>
        {connected && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        )}
      </div>

      {!connected ? (
        <>
          {/* Setup Instructions */}
          <div className="p-3.5 rounded-xl bg-slate-900 border border-white/5 text-xs text-slate-400 space-y-1.5">
            <p className="font-semibold text-white">How to get your COROS Client ID:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Visit{' '}
                <a
                  href="https://developer.coros.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:underline inline-flex items-center"
                >
                  developer.coros.com <ExternalLink className="w-3 h-3 ml-0.5" />
                </a>
              </li>
              <li>Create a Developer App (free, no approval needed)</li>
              <li>Set Redirect URI to: <code className="text-cyan-300 bg-slate-800 px-1 rounded">{window.location.origin}/</code></li>
              <li>Copy your Client ID below</li>
            </ol>
          </div>

          {/* Client ID Input */}
          <div>
            <label className="text-xs font-semibold text-slate-300 flex items-center mb-1">
              <Key className="w-3.5 h-3.5 mr-1.5 text-cyan-400" /> COROS Client ID
            </label>
            <input
              type="text"
              placeholder="e.g. abc123def456"
              value={clientIdInput}
              onChange={(e) => { setClientIdInput(e.target.value); setErrorMsg(''); }}
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            {errorMsg && <p className="text-xs text-rose-400 mt-1">{errorMsg}</p>}
          </div>

          <button
            onClick={handleConnect}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-slate-950 font-bold text-sm hover:opacity-95 transition-all flex items-center justify-center space-x-2 shadow-lg shadow-cyan-500/20"
          >
            <Watch className="w-4 h-4" />
            <span>Authorize COROS via OAuth</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </>
      ) : (
        /* Connected State */
        <div className="space-y-3">
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-slate-950 font-bold text-sm hover:opacity-95 disabled:opacity-50 transition-all flex items-center justify-center space-x-2 shadow-lg shadow-cyan-500/20"
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{isSyncing ? 'Syncing from COROS...' : 'Sync Recent Activities'}</span>
          </button>

          {syncStatus && (
            <p className="text-xs text-emerald-400 text-center font-semibold">{syncStatus}</p>
          )}
          {errorMsg && (
            <p className="text-xs text-rose-400 text-center">{errorMsg}</p>
          )}

          <button
            onClick={handleDisconnect}
            className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-medium transition-all"
          >
            Disconnect COROS Account
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Strava Tab (legacy) ───────────────────────────────────────────────────────

const StravaTab: React.FC<{ onImportSample: () => void; isSyncing: boolean }> = ({
  onImportSample,
  isSyncing,
}) => {
  const [clientIdInput, setClientIdInput] = useState(getStoredStravaClientId());
  const [errorMsg, setErrorMsg] = useState('');

  const handleAuthorize = () => {
    if (!clientIdInput.trim()) {
      setErrorMsg('Enter your Strava Client ID');
      return;
    }
    setStoredStravaClientId(clientIdInput.trim());
    const url = getStravaAuthUrl(clientIdInput.trim());
    if (!url) { setErrorMsg('Invalid Client ID format.'); return; }
    window.location.href = url;
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 leading-relaxed">
        <p className="font-semibold text-amber-300 mb-1">⚠️ Strava API Changes (June 2026)</p>
        Strava now requires an active Strava subscription for API access. If you have a paid Strava account, this still works. Otherwise use FIT upload or COROS sync above.
      </div>

      <div>
        <label className="text-xs font-semibold text-slate-300 flex items-center mb-1">
          <Key className="w-3.5 h-3.5 mr-1.5 text-orange-400" /> Strava Client ID
        </label>
        <input
          type="text"
          placeholder="e.g. 123456"
          value={clientIdInput}
          onChange={(e) => { setClientIdInput(e.target.value); setErrorMsg(''); }}
          className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500"
        />
        {errorMsg && <p className="text-xs text-rose-400 mt-1">{errorMsg}</p>}
        <p className="text-[11px] text-slate-500 mt-1">
          Find at{' '}
          <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer" className="text-orange-400 hover:underline">
            strava.com/settings/api
          </a>
        </p>
      </div>

      <button
        onClick={handleAuthorize}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 text-white font-bold text-sm hover:opacity-95 flex items-center justify-center space-x-2 shadow-lg shadow-orange-600/30"
      >
        <RefreshCw className="w-4 h-4" />
        <span>Authorize Strava OAuth</span>
      </button>

      <div className="relative flex py-1 items-center">
        <div className="flex-grow border-t border-white/10" />
        <span className="flex-shrink mx-3 text-[11px] text-slate-500 font-mono uppercase">or test pipeline</span>
        <div className="flex-grow border-t border-white/10" />
      </div>

      <button
        onClick={onImportSample}
        disabled={isSyncing}
        className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-cyan-400 font-bold text-xs flex items-center justify-center space-x-2"
      >
        <Zap className="w-4 h-4" />
        <span>{isSyncing ? 'Ingesting...' : 'Import Sample Activity (No Auth)'}</span>
      </button>
    </div>
  );
};

// ─── Main Modal ────────────────────────────────────────────────────────────────

export const DataSyncModal: React.FC<DataSyncModalProps> = ({
  isOpen,
  onClose,
  onActivitiesImported,
  isSyncing,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('fit');

  if (!isOpen) return null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'fit',
      label: 'FIT Upload',
      icon: <Upload className="w-3.5 h-3.5" />,
      badge: 'Recommended',
    },
    {
      id: 'coros',
      label: 'COROS Sync',
      icon: <Watch className="w-3.5 h-3.5" />,
      badge: isCorosConnected() ? '●' : undefined,
    },
    {
      id: 'strava',
      label: 'Strava',
      icon: <Mountain className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-lg glass-panel rounded-3xl border border-cyan-500/20 p-6 shadow-2xl space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <RefreshCw className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Data Sources</h2>
              <p className="text-xs text-slate-400">Import activities from your devices</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center bg-slate-900/80 rounded-xl p-1 border border-white/5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge && tab.badge !== '●' && (
                <span className="text-[9px] bg-cyan-500/30 text-cyan-300 px-1.5 py-0.5 rounded-full font-bold">
                  {tab.badge}
                </span>
              )}
              {tab.badge === '●' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'fit' && (
            <FitUploadTab
              onActivitiesImported={(activities) => {
                onActivitiesImported(activities);
              }}
            />
          )}
          {activeTab === 'coros' && (
            <CorosTab onActivitiesImported={onActivitiesImported} />
          )}
          {activeTab === 'strava' && (
            <StravaTab
              onImportSample={() => { onActivitiesImported([]); onClose(); }}
              isSyncing={isSyncing}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// Keep old export name for backward compatibility during transition
export { DataSyncModal as StravaConnectModal };
