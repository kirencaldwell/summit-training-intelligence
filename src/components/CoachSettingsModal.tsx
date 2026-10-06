import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, KeyRound, Eye, EyeOff, CheckCircle2, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import {
  CLAUDE_MODEL_OPTIONS,
  getCoachSettings,
  saveCoachSettings,
  testAnthropicKey,
  type CoachProvider,
} from '../lib/coachSettings';

interface CoachSettingsModalProps {
  onClose: () => void;
  /** Called after settings are saved so the coach UI can refresh its labels */
  onSaved: () => void;
}

export const CoachSettingsModal: React.FC<CoachSettingsModalProps> = ({ onClose, onSaved }) => {
  const initial = getCoachSettings();
  const [provider, setProvider] = useState<CoachProvider>(initial.provider);
  const [claudeModel, setClaudeModel] = useState(initial.claudeModel);
  const [apiKey, setApiKey] = useState(initial.anthropicKey);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({ kind: 'idle' });

  const keyLooksValid = apiKey.trim().startsWith('sk-ant-');
  const canSave = provider === 'gemini' || keyLooksValid;

  const handleTest = async () => {
    setStatus({ kind: 'testing' });
    try {
      await testAnthropicKey({ provider: 'claude', claudeModel, anthropicKey: apiKey });
      setStatus({ kind: 'ok', message: 'Key works.' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not verify the key.' });
    }
  };

  const handleSave = () => {
    saveCoachSettings({ provider, claudeModel, anthropicKey: apiKey });
    onSaved();
    onClose();
  };

  const handleRemoveKey = () => {
    setApiKey('');
    setStatus({ kind: 'idle' });
    // Removing the key must not leave Claude selected with nothing to call it with
    saveCoachSettings({ provider: 'gemini', claudeModel, anthropicKey: '' });
    setProvider('gemini');
    onSaved();
  };

  // Portal to <body>: the coach panel has overflow-hidden and a backdrop filter, which would clip a fixed overlay
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-lg glass-panel rounded-3xl border border-cyan-500/30 p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h2 className="text-lg font-bold text-white flex items-center">
            <KeyRound className="w-5 h-5 mr-2 text-cyan-400" /> Coach Settings
          </h2>
          <button onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-slate-300 mb-1">Which AI answers as your coach?</legend>
          <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${provider === 'gemini' ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 bg-slate-900/50'}`}>
            <input type="radio" name="provider" checked={provider === 'gemini'} onChange={() => setProvider('gemini')} className="mt-1 accent-cyan-500" />
            <span>
              <span className="block text-sm font-semibold text-white">Gemini (app default)</span>
              <span className="block text-xs text-slate-400">Uses the server's shared Gemini key. Nothing to set up.</span>
            </span>
          </label>
          <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${provider === 'claude' ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 bg-slate-900/50'}`}>
            <input type="radio" name="provider" checked={provider === 'claude'} onChange={() => setProvider('claude')} className="mt-1 accent-cyan-500" />
            <span>
              <span className="block text-sm font-semibold text-white">Claude (your own API key)</span>
              <span className="block text-xs text-slate-400">Uses your Anthropic account, so usage is billed to you and nobody else can use it.</span>
            </span>
          </label>
        </fieldset>

        {provider === 'claude' && (
          <div className="space-y-4">
            <div>
              <label htmlFor="anthropic-key" className="text-xs font-semibold text-slate-300">Anthropic API key</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="anthropic-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setStatus({ kind: 'idle' }); }}
                  placeholder="sk-ant-..."
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide key' : 'Show key'} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {apiKey && !keyLooksValid && (
                <p className="mt-1 text-xs text-amber-300">Anthropic keys start with <code>sk-ant-</code>.</p>
              )}
              <p className="mt-1 text-[11px] text-slate-500">
                Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">console.anthropic.com</a>.
                A key made just for this app, with a monthly spend limit, is the safest choice.
              </p>
            </div>

            <div>
              <label htmlFor="claude-model" className="text-xs font-semibold text-slate-300">Model</label>
              <select
                id="claude-model"
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value)}
                className="mt-1 w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                {CLAUDE_MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}. {m.note}</option>)}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={!keyLooksValid || status.kind === 'testing'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 disabled:opacity-50"
              >
                {status.kind === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Test key
              </button>
              {apiKey && (
                <button type="button" onClick={handleRemoveKey} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-xs font-semibold text-rose-300 border border-rose-500/20">
                  <Trash2 className="w-3.5 h-3.5" /> Remove key
                </button>
              )}
              {status.kind === 'ok' && <span className="text-xs text-emerald-400">{status.message}</span>}
              {status.kind === 'error' && <span role="alert" className="text-xs text-rose-400">{status.message}</span>}
            </div>

            <p className="flex items-start gap-2 rounded-xl bg-slate-900/70 border border-white/5 p-3 text-[11px] text-slate-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 text-emerald-400 mt-0.5" />
              <span>
                Your key is stored only in this browser and sent with each coach request to this app's server, which forwards it to Anthropic.
                It is never saved on the server or in the database. Remove it on shared computers. It does not sync to your other devices.
              </span>
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white/5 text-xs font-semibold text-slate-300">Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="min-h-10 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 font-bold text-xs hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
