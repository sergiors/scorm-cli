import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { ContentPackage, PlayerState } from '../types'
import { usePlayerSession } from './use-player-session'
import type { PlayerSession } from './use-player-session'

type PlayerActions = Omit<PlayerSession, 'state'>

const PlayerStateContext = createContext<PlayerState | null>(null)
const PlayerActionsContext = createContext<PlayerActions | null>(null)
const PageIdContext = createContext<string | undefined>(undefined)

/** Owns the runtime learner session and exposes its semantic state and actions separately. */
export function PlayerProvider({
  contentPackage,
  children
}: {
  contentPackage: ContentPackage
  children: ReactNode
}) {
  const session = usePlayerSession(contentPackage)
  const actions = useMemo<PlayerActions>(
    () => ({
      markSeen: session.markSeen,
      markCompleted: session.markCompleted,
      setAnswer: session.setAnswer,
      markQuestionnaireSubmitted: session.markQuestionnaireSubmitted,
      retryQuestionnaire: session.retryQuestionnaire,
      finalizeQuestionnaire: session.finalizeQuestionnaire,
      setVideoPosition: session.setVideoPosition
    }),
    [
      session.markSeen,
      session.markCompleted,
      session.setAnswer,
      session.markQuestionnaireSubmitted,
      session.retryQuestionnaire,
      session.finalizeQuestionnaire,
      session.setVideoPosition
    ]
  )

  return (
    <PlayerStateContext.Provider value={session.state}>
      <PlayerActionsContext.Provider value={actions}>{children}</PlayerActionsContext.Provider>
    </PlayerStateContext.Provider>
  )
}

/** Semantic learner state, kept separate from the stable action context. */
export function usePlayerState(): PlayerState {
  const state = useContext(PlayerStateContext)
  if (state === null) {
    throw new Error('usePlayerState must be used within a PlayerProvider')
  }
  return state
}

/** Session transitions; consumers that only dispatch do not subscribe to state changes. */
export function usePlayerActions(): PlayerActions {
  const actions = useContext(PlayerActionsContext)
  if (actions === null) {
    throw new Error('usePlayerActions must be used within a PlayerProvider')
  }
  return actions
}

/** Associates nested authored content with its owning root page or tile item. */
export function PageProvider({ pageId, children }: { pageId: string; children: ReactNode }) {
  return <PageIdContext.Provider value={pageId}>{children}</PageIdContext.Provider>
}

/** Returns the content owner, or undefined for deliberately ownerless standalone content. */
export function usePageId(): string | undefined {
  return useContext(PageIdContext)
}
