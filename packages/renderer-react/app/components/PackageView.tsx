import { FormattedMessage } from 'react-intl'
import type { ContentPackage } from '../types'
import type { ContentProvider } from '../lib/content-loader'
import { usePlayerSession } from '../lib/use-player-session'
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
 * or progress/completion UI. The learner session — restore, state transitions,
 * persistence and completion reporting — is owned by {@link usePlayerSession};
 * this component only selects a presentation and forwards the session's state
 * and handlers to it, so completion is tracked but never rendered. Which nodes
 * may be accessed is decided by the shared sequential progression policy; each
 * presentation decides how it exposes that decision.
 */
export function PackageView({ contentPackage, contentProvider }: PackageViewProps) {
  const { presentation } = contentPackage
  const {
    state,
    markSeen,
    markCompleted,
    setAnswer,
    markQuestionnaireSubmitted,
    setVideoPosition
  } = usePlayerSession(contentPackage)

  if (presentation.type === 'tiles') {
    if (presentation.items.length === 0) {
      return <EmptyPackage />
    }

    return (
      <TilesPresentation
        items={presentation.items}
        contentProvider={contentProvider}
        columns={presentation.columns}
        pageStates={state.pages}
        initialItemId={state.location}
        onItemOpened={markSeen}
        onAnswer={setAnswer}
        onQuestionnaireSubmitted={markQuestionnaireSubmitted}
        onVideoPosition={setVideoPosition}
      />
    )
  }

  if (presentation.pages.length === 0) {
    return <EmptyPackage />
  }

  if (presentation.type === 'slides') {
    const initialIndex = Math.max(
      0,
      presentation.pages.findIndex((page) => page.id === state.location)
    )

    return (
      <SlidesPresentation
        pages={presentation.pages}
        contentProvider={contentProvider}
        initialIndex={initialIndex}
        pageStates={state.pages}
        onPageSeen={markSeen}
        onPageCompleted={markCompleted}
        onAnswer={setAnswer}
        onQuestionnaireSubmitted={markQuestionnaireSubmitted}
        onVideoPosition={setVideoPosition}
      />
    )
  }

  return (
    <ScrollPresentation
      pages={presentation.pages}
      contentProvider={contentProvider}
      pageStates={state.pages}
      initialPageId={state.location}
      onPageSeen={markSeen}
      onPageCompleted={markCompleted}
      onAnswer={setAnswer}
      onQuestionnaireSubmitted={markQuestionnaireSubmitted}
      onVideoPosition={setVideoPosition}
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
