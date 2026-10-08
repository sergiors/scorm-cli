import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import contentPackage from 'virtual:package-data';
import { PackageApp } from './App';
import { ScormRuntimeEventInspector } from './components/ScormRuntimeEventInspector';
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
 * Mounts the SCORM runtime event inspector only when Vite's HMR client is
 * present. Vite replaces `import.meta.hot` with `undefined` in production
 * builds, so this branch (and the inspector module it imports) is removed from
 * the SCORM output entirely.
 */
function DevInspector() {
  if (!import.meta.hot) {
    return null;
  }
  return <ScormRuntimeEventInspector />;
}
