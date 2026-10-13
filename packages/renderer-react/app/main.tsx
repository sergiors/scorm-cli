import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import contentPackage, { contentProvider } from 'virtual:package-data'
import { PackageApp } from './App'
import { DevPreviewOverlay } from './components/DevPreviewOverlay'
import { ScormDevToolsToolbar } from './components/ScormDevToolsToolbar'
import { disableNativeScrollRestoration } from './lib/scroll-restoration'
import './styles.css'

// The reading position is restored deliberately from the saved lesson location,
// so the browser must not also restore a remembered scroll offset on its own
// (reload, back/forward) — the two would compete. Persisted learner state —
// location, answers, submissions, progress — is unaffected; only the native
// restoration is off.
disableNativeScrollRestoration()

const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <StrictMode>
      <PackageApp contentPackage={contentPackage} contentProvider={contentProvider} />
      <DevInspector />
      <DevPreview />
    </StrictMode>
  )
}

/**
 * Mounts the SCORM dev-tools toolbar only when Vite's HMR client is present.
 * Vite replaces `import.meta.hot` with `undefined` in production builds, so
 * this branch (and the toolbar module it imports) is removed from the SCORM
 * output entirely.
 *
 * The toolbar is deliberately not wrapped in the player's `PlayerI18nProvider`:
 * it is a dev-only surface that ships English-only copy and never reaches
 * production. `PackageApp` still provides the localized catalog for the bundled
 * player.
 */
function DevInspector() {
  if (!import.meta.hot) {
    return null
  }
  return <ScormDevToolsToolbar />
}

/**
 * Mounts the preview-error overlay under the same HMR guard as the dev toolbar.
 * Moving it out of `PackageApp` keeps the learner shell free of any preview
 * dependency, and the guard lets the preview client be tree-shaken from the
 * production bundle while the dev preview behaves exactly as before.
 */
function DevPreview() {
  if (!import.meta.hot) {
    return null
  }
  return <DevPreviewOverlay />
}
