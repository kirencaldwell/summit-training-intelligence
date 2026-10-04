import React, { useState } from 'react';
import { X, ExternalLink, Zap, RefreshCw, Key } from 'lucide-react';
import { getStoredStravaClientId, setStoredStravaClientId, getStravaAuthUrl } from '../lib/strava';

interface StravaConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSample: () => void;
  isSyncing: boolean;
}

export const StravaConnectModal: React.FC<StravaConnectModalProps> = ({
  isOpen,
  onClose,
  onImportSample,
  isSyncing,
}) => {
  if (!isOpen) return null;

  const [clientIdInput, setClientIdInput] = useState<string>(getStoredStravaClientId());
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleAuthorize = () => {
    if (!clientIdInput.trim()) {
      setErrorMsg('Please enter your Strava Client ID from strava.com/settings/api');
      return;
    }

    setStoredStravaClientId(clientIdInput.trim());
    const authUrl = getStravaAuthUrl(clientIdInput.trim());

    if (!authUrl) {
      setErrorMsg('Invalid Client ID format.');
      return;
    }

    // Redirect to Strava OAuth
    window.location.href = authUrl;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-lg glass-panel rounded-3xl border border-orange-500/30 p-6 shadow-2xl space-y-6">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-600/30">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Connect Strava API</h2>
              <p className="text-xs text-slate-400">OAuth2 Live Sync & Stream Ingestion</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input Form */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 flex items-center mb-1">
              <Key className="w-4 h-4 mr-1.5 text-orange-400" /> Strava API Client ID
            </label>
            <input
              type="text"
              placeholder="e.g. 123456"
              value={clientIdInput}
              onChange={(e) => {
                setClientIdInput(e.target.value);
                setErrorMsg('');
              }}
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder-slate-500 focus:outline-none focus:border-orange-500"
            />
            {errorMsg && <p className="text-xs text-rose-400 mt-1">{errorMsg}</p>}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-white/5 space-y-1.5 text-xs text-slate-300">
            <div className="font-semibold text-white flex items-center justify-between">
              <span>Where do I get my Strava Client ID?</span>
              <a
                href="https://www.strava.com/settings/api"
                target="_blank"
                rel="noreferrer"
                className="text-orange-400 hover:underline flex items-center"
              >
                <span>strava.com/settings/api</span>
                <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              1. Log into your Strava account and visit API settings.<br />
              2. Copy your <strong>Client ID</strong> (numbers only, e.g. 142859).<br />
              3. Set Authorization Domain to <code>localhost</code> or your Vercel URL.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          <button
            onClick={handleAuthorize}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 hover:opacity-95 text-white font-bold text-xs shadow-lg shadow-orange-600/30 flex items-center justify-center space-x-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Authorize with Strava OAuth</span>
          </button>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-white/10"></div>
            <span className="flex-shrink mx-3 text-[11px] text-slate-500 font-mono uppercase">or test live pipeline</span>
            <div className="flex-grow border-t border-white/10"></div>
          </div>

          <button
            onClick={() => {
              onImportSample();
              onClose();
            }}
            disabled={isSyncing}
            className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-white/10 text-cyan-400 font-bold text-xs flex items-center justify-center space-x-2"
          >
            <Zap className="w-4 h-4 text-cyan-400" />
            <span>{isSyncing ? 'Ingesting Streams...' : 'Import Live Activity Payload'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
