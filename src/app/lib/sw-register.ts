// Registers /sw.js in production builds. A new deploy activates at once (skipWaiting + claim in sw.ts);
// the page then reloads once so it runs the new code instead of a mix of old and new files.

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install takes control of a page that already runs the current code: no reload.
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      // An installed PWA can stay open for days: look for a new deploy whenever it comes back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
