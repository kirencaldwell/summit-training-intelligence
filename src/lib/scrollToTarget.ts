/**
 * After a tab switch the target may not be on the page yet: wait for it, scroll it to the middle of the screen and
 * ring it briefly so it is clear what the link meant.
 */
export function scrollToTarget(id: string, timeoutMs = 2000) {
  const started = Date.now();
  const find = () => {
    const el = document.getElementById(id);
    // Hidden because a collapsed card holds it: open that card and look again
    if (el && el.offsetParent === null) {
      const toggle = el.closest('article')?.querySelector<HTMLButtonElement>('[data-expand][aria-expanded="false"]');
      toggle?.click();
    } else if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const ring = ['ring-2', 'ring-cyan-400', 'ring-offset-2', 'ring-offset-slate-950'];
      el.classList.add(...ring);
      window.setTimeout(() => el.classList.remove(...ring), 2800);
      return;
    }
    if (Date.now() - started < timeoutMs) window.setTimeout(find, 80);
  };
  window.setTimeout(find, 60);
}
