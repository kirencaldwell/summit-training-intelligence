import { useEffect, useState } from 'react';

/** Whether a CSS media query currently matches, kept up to date (false where matchMedia is unavailable). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** The width where the app switches from the phone/tablet layout to the full desktop one (Tailwind xl). */
export const useIsDesktop = () => useMediaQuery('(min-width: 1280px)');
