/**
 * Turns off the browser's native scroll restoration so a reload (or a
 * back/forward navigation) always opens the reading at the top of the document
 * instead of a previously saved scroll offset. Persisted learner state —
 * location, answers, submissions, progress — is unaffected; only the native
 * restoration is disabled.
 *
 * Guarded for a host without the History API (SSR, an older webview), so it is
 * an inert no-op rather than a throw.
 */
export function disableNativeScrollRestoration(): void {
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual'
  }
}
