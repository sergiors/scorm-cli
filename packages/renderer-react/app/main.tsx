import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import contentPackage from 'virtual:package-data';
import { PackageApp } from './App';
import { ScormDevToolsToolbar } from './components/ScormDevToolsToolbar';
import { I18nProvider } from './lib/use-i18n';
import './styles.css';

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(
    <StrictMode>
      <PackageApp contentPackage={contentPackage} />
      <DevInspector lang={contentPackage.metadata.lang} />
    </StrictMode>,
  );
}

/**
 * Mounts the SCORM dev-tools toolbar only when Vite's HMR client is present.
 * Vite replaces `import.meta.hot` with `undefined` in production builds, so
 * this branch (and the toolbar module it imports) is removed from the SCORM
 * output entirely.
 */
function DevInspector({ lang }: { lang?: string }) {
  if (!import.meta.hot) {
    return null;
  }
  return (
    <I18nProvider lang={lang}>
      <ScormDevToolsToolbar />
    </I18nProvider>
  );
}
