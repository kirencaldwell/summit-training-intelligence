/**
 * ImportDataModal.tsx
 * The Import Data window: automatic import from Intervals.icu (which collects Garmin, COROS and Zwift), or
 * uploading FIT / GPX files and a Strava export.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  X, Upload, CheckCircle2, AlertCircle, Loader2, RefreshCw, CopyCheck, FileCode2, Waypoints,
} from 'lucide-react';
import type { Activity } from '../types';
import { parseActivityFiles, applyStravaCsvToExisting, type FitImportResult, type ImportProgress } from '../lib/fitParser';
import { parseStravaActivitiesCsv, type StravaMetaIndex } from '../lib/stravaCsv';
import { formatFeetFromMeters } from '../lib/units';
import { IntervalsTab } from './IntervalsTab';
import { getIntervalsSettings } from '../lib/intervals';

type Tab = 'intervals' | 'files';

interface DataSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActivitiesImported: (activities: Activity[]) => void;
  onActivitiesUpdated?: (activities: Activity[]) => void;
  /** New activities that shouldn't open a detail view (a bulk sync from Intervals.icu) */
  onActivitiesAdded?: (activities: Activity[]) => void;
}

// ─── FIT Upload Tab ────────────────────────────────────────────────────────────

const FitUploadTab: React.FC<{
  onActivitiesImported: (a: Activity[]) => void;
  onActivitiesUpdated?: (a: Activity[]) => void;
}> = ({
  onActivitiesImported,
  onActivitiesUpdated,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<FitImportResult[]>([]);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [csvNote, setCsvNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (files: File[]) => {
      const activityFiles = files.filter((file) => /\.(fit|fit\.gz|gpx)$/i.test(file.name));
      const csvFile = files.find((file) => /\.csv$/i.test(file.name));
      if (activityFiles.length === 0 && !csvFile) return;

      setIsProcessing(true);
      setResults([]);
      setCsvNote(null);
      setProgress(null);

      try {
        let stravaMeta: StravaMetaIndex | undefined;
        if (csvFile) {
          try {
            stravaMeta = parseStravaActivitiesCsv(await csvFile.text());
          } catch (err) {
            setCsvNote({ ok: false, text: err instanceof Error ? err.message : 'Could not read that CSV.' });
            if (activityFiles.length === 0) return;
          }
        }

        // A CSV on its own fills in activities that were imported earlier under their bare file names
        if (stravaMeta && activityFiles.length === 0) {
          const updated = await applyStravaCsvToExisting(stravaMeta, setProgress);
          if (updated.length > 0) onActivitiesUpdated?.(updated);
          setCsvNote({
            ok: true,
            text: updated.length > 0
              ? `Filled in names and types for ${updated.length} existing ${updated.length === 1 ? 'activity' : 'activities'}.`
              : 'No existing activities needed updating. Renamed activities are left alone.',
          });
          return;
        }

        const importResults = await parseActivityFiles(activityFiles, stravaMeta, setProgress);
        setResults(importResults);
        const successful = importResults
          .filter((r) => r.status === 'success' && r.activity)
          .map((r) => r.activity!);
        const updated = importResults
          .filter((r) => r.status === 'updated' && r.activity)
          .map((r) => r.activity!);
        if (successful.length > 0) onActivitiesImported(successful);
        if (updated.length > 0) onActivitiesUpdated?.(updated);
        if (stravaMeta) {
          setCsvNote({
            ok: true,
            text: `Applied Strava names and types to ${successful.length + updated.length} of ${importResults.length} files.`,
          });
        }
      } finally {
        setIsProcessing(false);
        setProgress(null);
      }
    },
    [onActivitiesImported, onActivitiesUpdated]
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
          accept=".fit,.fit.gz,.gz,.gpx,.csv,text/csv,application/gzip,application/octet-stream"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {isProcessing ? (
          <div className="flex flex-col items-center space-y-2">
            <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
            <p className="text-sm font-semibold text-white">
              {progress && progress.total > 0 ? `Importing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : 'Parsing activity files...'}
            </p>
            {progress && progress.total > 0 ? (
              <div className="w-full max-w-xs space-y-1.5">
                <div
                  role="progressbar"
                  aria-label="Import progress"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                  className="h-2 w-full rounded-full bg-slate-800 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-[width] duration-150"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {Math.round((progress.done / progress.total) * 100)}%{progress.file ? ` · ${progress.file}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Reading tracks and calculating training metrics...</p>
            )}
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
                {isDragOver ? 'Drop to import!' : 'Drop .fit, .fit.gz, or .gpx files here (plus Strava\'s activities.csv)'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">or click to browse — multiple files supported</p>
            </div>
          </div>
        )}
      </div>

      {/* Where the files come from: collapsed so the drop zone is the first thing you see */}
      <details className="group rounded-xl border border-white/5 bg-slate-900/60 text-xs">
        <summary className="cursor-pointer select-none list-none px-3.5 py-3 font-semibold text-slate-200 flex items-center justify-between gap-2 min-h-11">
          <span className="flex items-center"><FileCode2 className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />Where do I get these files?</span>
          <span className="text-slate-500 group-open:rotate-180 transition-transform" aria-hidden="true">▾</span>
        </summary>
        <div className="space-y-3 px-3.5 pb-3.5 text-slate-300">
      <div className="p-3.5 rounded-xl bg-slate-900 border border-white/5 text-xs text-slate-300 space-y-2">
        <p className="font-semibold text-white flex items-center">
          <FileCode2 className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
          Works with Garmin, COROS, Wahoo, Polar, Suunto — any FIT-compatible device
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-400">
          <div>
            <p className="font-semibold text-slate-300">📲 From Garmin Connect:</p>
            <p>Activities → select activity → ⋯ → Export Original (.fit). Gzip-compressed .fit.gz files are also supported.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-300">📲 From COROS App:</p>
            <p>Activities → select → Share → Export Data → FIT</p>
          </div>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-orange-500/10 border border-orange-500/25 text-xs space-y-2">
        <p className="font-semibold text-orange-300 flex items-center gap-1.5">
          <span>📦</span> Import your full Strava history (free, one-time)
        </p>
        <p className="text-slate-300 leading-relaxed">
          Strava lets you export <strong className="text-white">every activity you've ever recorded</strong> as .fit.gz files — no paid subscription needed for the export. GPX and uncompressed FIT files are supported too.
        </p>
        <ol className="text-slate-400 space-y-0.5 list-decimal list-inside leading-relaxed">
          <li>Go to <a href="https://www.strava.com/athlete/delete_your_account" target="_blank" rel="noreferrer" className="text-orange-400 hover:underline">strava.com/athlete/delete_your_account</a> <span className="text-slate-500">(you're not deleting anything)</span></li>
          <li>Click <strong className="text-slate-200">"Get Started"</strong> under <em>Request your archive</em></li>
          <li>Strava emails you a .zip — usually within a few hours</li>
          <li>Unzip it, then select or drag the <strong className="text-slate-200">.fit.gz, .fit, or .gpx files</strong> from the activities folder onto the drop zone above</li>
          <li>Also add <strong className="text-slate-200">activities.csv</strong> from the same zip, in the same drop, to bring in your Strava activity names, types and descriptions. Dropped on its own, it fills in activities you already imported.</li>
        </ol>
      </div>

        </div>
      </details>

      {csvNote && (
        <p className={`p-3 rounded-xl border text-xs ${csvNote.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
          {csvNote.text}
        </p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Import Results</p>
          {results.map((r) => (
            <div
              key={r.file}
              className={`flex items-start space-x-3 p-3 rounded-xl border text-xs ${
                r.status === 'success' || r.status === 'updated'
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : r.status === 'duplicate'
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-rose-500/10 border-rose-500/30'
              }`}
            >
              {r.status === 'success' || r.status === 'updated' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : r.status === 'duplicate' ? (
                <CopyCheck className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{r.file}</p>
                {(r.status === 'success' || r.status === 'updated') && r.activity ? (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {r.status === 'updated' && <span className="text-emerald-300 break-all">Updated from Strava CSV: {r.activity.title}</span>}
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
                        ↑ {formatFeetFromMeters(r.activity.total_elevation_gain_m)}
                      </span>
                    )}
                  </div>
                ) : r.status === 'duplicate' ? (
                  <p className="text-amber-200 mt-0.5 break-words">Already imported; skipped{r.activity ? ` (matches ${r.activity.title})` : ''}.</p>
                ) : (
                  <p className="text-rose-300 mt-0.5 break-words">{r.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Main Modal ────────────────────────────────────────────────────────────────

export const DataSyncModal: React.FC<DataSyncModalProps> = ({
  isOpen,
  onClose,
  onActivitiesImported,
  onActivitiesUpdated,
  onActivitiesAdded,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('intervals');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'intervals',
      label: 'Intervals.icu',
      icon: <Waypoints className="w-3.5 h-3.5" />,
      badge: getIntervalsSettings() ? '●' : 'Recommended',
    },
    {
      id: 'files',
      label: 'Upload files',
      icon: <Upload className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-sources-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto glass-panel rounded-2xl sm:rounded-3xl border border-cyan-500/20 p-4 sm:p-6 shadow-2xl space-y-5"
      >

        {/* Header */}
        <div className="sticky top-0 z-20 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 backdrop-blur-md">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <RefreshCw className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 id="data-sources-title" className="text-lg font-bold text-white">Data Sources</h2>
              <p className="text-xs text-slate-400">Import activities from your devices</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import data window"
            title="Close"
            className="min-h-11 min-w-11 shrink-0 flex items-center justify-center rounded-lg border border-white/15 bg-slate-800 text-slate-100 hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1 bg-slate-900/80 rounded-xl p-1 border border-white/5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-11 flex-1 flex items-center justify-center gap-1.5 py-2 px-2 sm:px-3 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
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
          {activeTab === 'intervals' && (
            <IntervalsTab onActivitiesImported={onActivitiesAdded ?? onActivitiesImported} onActivitiesUpdated={onActivitiesUpdated} />
          )}
          {activeTab === 'files' && (
            <FitUploadTab
              onActivitiesImported={onActivitiesImported}
              onActivitiesUpdated={onActivitiesUpdated}
            />
          )}
        </div>
      </div>
    </div>
  );
};

