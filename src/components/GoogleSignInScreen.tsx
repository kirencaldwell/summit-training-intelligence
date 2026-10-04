import React, { useState } from 'react';
import { LoaderCircle, LogIn, Mountain } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface GoogleSignInScreenProps {
  error?: string;
}

export const GoogleSignInScreen: React.FC<GoogleSignInScreenProps> = ({ error: authError }) => {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    if (!supabase) return;
    setIsSigningIn(true);
    setError('');

    try {
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in could not be started.');
      setIsSigningIn(false);
    }
  };

  const visibleError = error || authError;

  return (
    <main className="min-h-screen bg-summit-dark flex items-center justify-center px-4 py-10 text-slate-100">
      <section className="w-full max-w-md glass-panel rounded-2xl border border-cyan-500/20 p-7 sm:p-9 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Mountain className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <p className="text-lg font-extrabold text-white">SUMMIT</p>
            <p className="text-[10px] text-slate-400 uppercase">Training Intelligence</p>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white">Sign in to continue</h1>
        <p className="mt-2 mb-7 text-sm text-slate-400">Your training data is private to your Google account.</p>

        <button
          type="button"
          onClick={handleSignIn}
          disabled={isSigningIn || !supabase}
          className="w-full flex items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-60 transition-colors"
        >
          {isSigningIn ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          <span>{isSigningIn ? 'Redirecting to Google...' : 'Continue with Google'}</span>
        </button>

        {visibleError && (
          <p role="alert" className="mt-4 text-sm text-rose-300">{visibleError}</p>
        )}
      </section>
    </main>
  );
};
