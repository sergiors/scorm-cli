/**
 * Turns off the browser's native scroll restoration so a reload (or a
 * back/forward navigation) never replays a stale pixel offset. The reading
 * position is restored deliberately by the presentation itself, from the saved
 * lesson location (`PlayerState.location`); leaving native restoration on would
 * let the browser's remembered offset compete with that restore. Persisted
 * learner state — location, answers, submissions, progress — is unaffected; only
 * the native restoration is disabled.
 *
 * Guarded for a host without the History API (SSR, an older webview), so it is
 * an inert no-op rather than a throw.
 */
export function disableNativeScrollRestoration(): void {
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual'
  }
}
