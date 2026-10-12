import type { ContentPackage } from './types';
import { PackageView } from './components/PackageView';
import { PlayerI18nProvider } from './lib/player-i18n';

export interface PackageAppProps {
  contentPackage: ContentPackage;
}

/**
 * The learner-facing player shell: provides the localized catalog and renders
 * the authored package.
 *
 * Dev-only preview surfaces — the `scorm dev` error overlay and the SCORM
 * dev-tools toolbar — are mounted separately in `main.tsx` behind
 * `import.meta.hot`, so this component stays free of any dev dependency and
 * neither surface can ship to learners.
 */
export function PackageApp({ contentPackage }: PackageAppProps) {
  return (
    <PlayerI18nProvider lang={contentPackage.metadata.lang}>
      <PackageView contentPackage={contentPackage} />
    </PlayerI18nProvider>
  );
}
