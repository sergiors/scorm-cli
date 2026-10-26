import { FormattedMessage } from 'react-intl'
import type { ContentPackage } from '../types'
import type { ContentProvider } from '../lib/content-loader'
import { PlayerProvider } from '../lib/player-context'
import { ScrollPresentation } from './ScrollPresentation'
import { SlidesPresentation } from './SlidesPresentation'
import { TilesPresentation } from './TilesPresentation'

export interface PackageViewProps {
  contentPackage: ContentPackage
  /**
   * The single runtime source of each page/item's authored content, supplied by
   * the Vite package-data module. Every generated package lazily loads its page
   * and item bodies through it, so no content is embedded in the initial bundle.
   */
  contentProvider: ContentProvider
}

/**
 * Dispatches on the authored root presentation and renders it.
 *
 * There is no package chrome: no header, sidebar, breadcrumb, global navigation
 * or progress/completion UI. Session restoration, transitions, persistence and
 * completion reporting are provided once by {@link PlayerProvider}; presentations
 * consume only the semantic state/actions they need. Which nodes may be accessed
 * is decided by the shared sequential progression policy; each presentation
 * decides how it exposes that decision.
 */
export function PackageView({ contentPackage, contentProvider }: PackageViewProps) {
  return (
    <PlayerProvider contentPackage={contentPackage}>
      <PackagePresentation contentPackage={contentPackage} contentProvider={contentProvider} />
    </PlayerProvider>
  )
}

function PackagePresentation({ contentPackage, contentProvider }: PackageViewProps) {
  const { presentation } = contentPackage

  if (presentation.type === 'tiles') {
    if (presentation.items.length === 0) {
      return <EmptyPackage />
    }

    return (
      <TilesPresentation
        items={presentation.items}
        contentProvider={contentProvider}
        columns={presentation.columns}
      />
    )
  }

  if (presentation.pages.length === 0) {
    return <EmptyPackage />
  }

  if (presentation.type === 'slides') {
    return (
      <SlidesPresentation
        pages={presentation.pages}
        contentProvider={contentProvider}
      />
    )
  }

  return (
    <ScrollPresentation
      pages={presentation.pages}
      contentProvider={contentProvider}
    />
  )
}

function EmptyPackage() {
  return (
    <p className="p-6 text-sm text-muted-foreground">
      <FormattedMessage id="package.empty" />
    </p>
  )
}
