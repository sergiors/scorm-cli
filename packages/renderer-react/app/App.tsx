import type { ContentPackage } from './types'
import type { ContentProvider } from './lib/content-loader'
import { PackageView } from './components/PackageView'
import { PlayerI18nProvider } from './lib/player-i18n'

export interface PackageAppProps {
  contentPackage: ContentPackage
  /**
   * The single runtime source of each page/item's authored content, supplied by
   * the Vite package-data module. Every generated package lazy-loads its page and
   * item bodies through it, so no content is embedded in the initial bundle.
   */
  contentProvider: ContentProvider
}

/**
 * The learner-facing player shell: provides the localized catalog and renders
 * the authored package.
 *
 * Dev-only preview surfaces — the `scorm preview` error overlay and the SCORM
 * dev-tools toolbar — are mounted separately in `main.tsx` behind
 * `import.meta.hot`, so this component stays free of any dev dependency and
 * neither surface can ship to learners.
 */
export function PackageApp({ contentPackage, contentProvider }: PackageAppProps) {
  return (
    <PlayerI18nProvider lang={contentPackage.metadata.lang}>
      <PackageView contentPackage={contentPackage} contentProvider={contentProvider} />
    </PlayerI18nProvider>
  )
}
