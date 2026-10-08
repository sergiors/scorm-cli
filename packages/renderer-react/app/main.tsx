import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import contentPackage from 'virtual:package-data';
import { PackageApp } from './App';
import { ScormDevToolsToolbar } from './components/ScormDevToolsToolbar';
import './styles.css';

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(
    <StrictMode>
      <PackageApp contentPackage={contentPackage} />
      <DevInspector />
    </StrictMode>,
  );
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
    return null;
  }
  return <ScormDevToolsToolbar />;
}
