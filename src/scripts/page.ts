// With client-side navigation, a page's module script runs only once per full load,
// but its DOM is replaced on every visit. onPage() runs `setup` each time a page is
// shown and aborts `signal` when you navigate away, so listeners and loops clean up.
export function onPage(setup: (signal: AbortSignal) => void) {
  let ctrl: AbortController | null = null;
  document.addEventListener('astro:page-load', () => {
    ctrl?.abort();
    ctrl = new AbortController();
    setup(ctrl.signal);
  });
  document.addEventListener('astro:before-swap', () => { ctrl?.abort(); ctrl = null; });
}
