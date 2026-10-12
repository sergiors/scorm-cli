import { FormattedMessage } from 'react-intl'
import type { ContentPackage } from '../types'
import { usePlayerSession } from '../lib/use-player-session'
import { GridPresentation } from './GridPresentation'
import { ScrollPresentation } from './ScrollPresentation'

export interface PackageViewProps {
  contentPackage: ContentPackage
}

/**
 * Dispatches on the authored root presentation and renders its leaf content
 * directly, in document order.
 *
 * There is no package chrome: no header, sidebar, breadcrumb, global navigation
 * or progress/completion UI. The learner session — restore, state transitions,
 * persistence and completion reporting — is owned by {@link usePlayerSession};
 * this component only selects a presentation and forwards the session's state
 * and handlers to it, so completion is tracked but never rendered.
 */
export function PackageView({ contentPackage }: PackageViewProps) {
  const { presentation } = contentPackage
  const { state, markSeen, markCompleted, setAnswer, markQuestionnaireSubmitted } =
    usePlayerSession(contentPackage)

  if (presentation.type === 'scroll') {
    if (presentation.pages.length === 0) {
      return <EmptyPackage />
    }

    const initialIndex = Math.max(
      0,
      presentation.pages.findIndex((page) => page.id === state.location)
    )

    return (
      <ScrollPresentation
        pages={presentation.pages}
        initialIndex={initialIndex}
        pageStates={state.pages}
        onPageSeen={markSeen}
        onPageCompleted={markCompleted}
        onAnswer={setAnswer}
        onQuestionnaireSubmitted={markQuestionnaireSubmitted}
      />
    )
  }

  if (presentation.items.length === 0) {
    return <EmptyPackage />
  }

  return (
    <GridPresentation
      items={presentation.items}
      columns={presentation.columns}
      pageStates={state.pages}
      initialItemId={state.location}
      onItemOpened={markSeen}
      onAnswer={setAnswer}
      onQuestionnaireSubmitted={markQuestionnaireSubmitted}
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
