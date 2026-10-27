import { useCallback, useRef, useState } from 'react'
import type { AnswerValue, ContentPackage, PlayerState } from '../types'
import {
  getAggregateQuestionnaireScore,
  getDoneNodeIds,
  getPackageProgress,
  isPackageComplete
} from './content-helpers'
import {
  sanitizePlayerState,
  sameAnswer,
  updatePageState,
  withLocation,
  normalizeVideoPosition
} from './player-state'
import { restoreState, saveState, useScormBridge, useScormScore } from './use-scorm-bridge'

/**
 * The learner's owned progress plus the transitions that mutate it, as returned
 * by {@link usePlayerSession}. {@link PlayerProvider} exposes the semantic state
 * and these actions through separate contexts; presentations never persist
 * anything themselves.
 */
export interface PlayerSession {
  /** The in-memory resume state (lesson location plus per-node progress). */
  state: PlayerState
  /** Stores a node as the current location and marks it visited in one write. */
  markSeen(id: string): void
  /** Marks a node completed (scroll completion is gated on this). */
  markCompleted(id: string): void
  /** Persists a question answer for a node. */
  setAnswer(pageId: string, questionId: string, value: AnswerValue): void
  /**
   * Records a successful questionnaire submission: appends its correct-answer
   * count to the attempt history (never beyond `maxAttempts`), marks the
   * questionnaire submitted, and clears any active retry.
   */
  markQuestionnaireSubmitted(
    pageId: string,
    questionnaireId: string,
    correctCount: number,
    maxAttempts?: number
  ): void
  /**
   * Starts a retry for a submitted questionnaire whose history still has an
   * attempt left: clears only its answers, keeps the history and page
   * completion, removes the submitted status, and marks it actively retrying.
   */
  retryQuestionnaire(
    pageId: string,
    questionnaireId: string,
    questionIds: readonly string[],
    maxAttempts?: number
  ): void
  /**
   * Persists a video's semantic playback position in seconds, scoped to the
   * page/item that owns the video. Non-finite and negative positions are
   * ignored, values are normalized to tenths, and an unchanged position is a
   * no-op.
   */
  setVideoPosition(pageId: string, videoId: string, seconds: number): void
}

/** The effective attempt cap, falling back to one for older ASTs. */
function normalizeAttemptLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1
}

/**
 * Owns the whole learner session for a package: restoring, validating, mutating
 * and persisting the resume state, and reporting completion and the derived
 * aggregate score to the SCORM bridge. Presentation selection and rendering live
 * in the caller, so this hook is the single state/transition/persistence
 * boundary.
 *
 * All learner progress lives in a single in-memory {@link PlayerState} keyed by
 * stable authored ids and answer values, kept separate from the SCORM runtime's
 * compact encoding. The saved state is read once on mount through
 * `restoreState()`, validated against the current presentation, and from then on
 * the hook owns a plain state object. Every genuine change is written back
 * through `saveState(state, progress)` — the integer package progress is
 * computed with the canonical core helper. Side effects never run inside a React
 * state updater, and the ref below is the source of truth so StrictMode's doubled
 * effects cannot double write.
 *
 * Completion semantics differ by presentation:
 * - Scroll and Slides pages are visited as soon as they are displayed. A page
 *   completes once its own completion rule is met (for Scroll, its end boundary
 *   was reached; for Slides, it is simply displayed) and every questionnaire on
 *   the page has been submitted. The page being viewed is stored as the lesson
 *   location. Both resume on that page after a refresh: the location the runtime
 *   read back (SCORM 1.2 `cmi.core.lesson_location` / SCORM 2004 `cmi.location`,
 *   normalized to `PlayerState.location`) seeds the initial reading position,
 *   while restored answers, submissions and progress are unaffected. The package
 *   is complete once every page is completed.
 * - Tiles items are visited (and stored as the location) as they are opened;
 *   the package is complete once every item has been opened. A saved location
 *   reopens that item's dialog on mount.
 *
 * All three presentations share one sequential progression policy from the core
 * model: the completed (done) prefix and its immediate first not-done successor
 * are accessible, and every later node stays locked — even one whose stored
 * state inconsistently says it is done — so the learner can never skip forward
 * to fresh content.
 */
export function usePlayerSession(contentPackage: ContentPackage): PlayerSession {
  // Validate the saved state once, on first mount. Reading the bridge is a pure
  // lookup and sanitizing is pure, so StrictMode's doubled initializer yields
  // the same value.
  const [state, setState] = useState<PlayerState>(() =>
    sanitizePlayerState(contentPackage, restoreState())
  )
  const stateRef = useRef(state)

  // Applies a pure update to the owned state and persists the result. The ref
  // is updated synchronously so back-to-back interactions compose, and the
  // bridge write happens outside the updater — never as a side effect of it.
  // The readable state and its integer progress travel together; the runtime
  // owns encoding both, so the renderer never serializes suspend data.
  const applyState = useCallback(
    (updater: (previous: PlayerState) => PlayerState) => {
      const previous = stateRef.current
      const next = updater(previous)
      if (next === previous) {
        return
      }
      stateRef.current = next
      setState(next)
      saveState(next, getPackageProgress(contentPackage, next))
    },
    [contentPackage]
  )

  // Marks a page/item as seen and stores it as the current location in one
  // write, so a display never produces two bridge calls.
  const markSeen = useCallback(
    (id: string) => {
      applyState((previous) => {
        const visited = updatePageState(previous, id, (page) =>
          page.visited ? page : { ...page, visited: true }
        )
        return withLocation(visited, id)
      })
    },
    [applyState]
  )

  const markCompleted = useCallback(
    (id: string) => {
      applyState((previous) =>
        updatePageState(previous, id, (page) =>
          page.completed ? page : { ...page, completed: true }
        )
      )
    },
    [applyState]
  )

  const setAnswer = useCallback(
    (pageId: string, questionId: string, value: AnswerValue) => {
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          if (sameAnswer(page.answers?.[questionId], value)) {
            return page
          }
          return { ...page, answers: { ...page.answers, [questionId]: value } }
        })
      )
    },
    [applyState]
  )

  // A successful submission is the only thing that consumes an attempt. The
  // history append is capped here as well as in the UI, so a restored state at
  // the attempt limit can never grow past it. Submission and the attempt are
  // written together, and an active retry is cleared at the same time.
  const markQuestionnaireSubmitted = useCallback(
    (pageId: string, questionnaireId: string, correctCount: number, maxAttempts?: number) => {
      const attemptLimit = normalizeAttemptLimit(maxAttempts)
      const correct = Number.isSafeInteger(correctCount) && correctCount >= 0 ? correctCount : 0
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const submitted = page.submittedQuestionnaires ?? []
          if (submitted.includes(questionnaireId)) {
            return page
          }

          const history = page.questionnaireAttempts?.[questionnaireId] ?? []
          const nextHistory = history.length < attemptLimit ? [...history, correct] : history
          const nextPage = {
            ...page,
            submittedQuestionnaires: [...submitted, questionnaireId]
          }

          if (nextHistory !== history) {
            nextPage.questionnaireAttempts = {
              ...page.questionnaireAttempts,
              [questionnaireId]: nextHistory
            }
          }

          const retries = page.activeQuestionnaireRetries
          if (retries?.includes(questionnaireId)) {
            const nextRetries = retries.filter((id) => id !== questionnaireId)
            if (nextRetries.length > 0) {
              nextPage.activeQuestionnaireRetries = nextRetries
            } else {
              delete nextPage.activeQuestionnaireRetries
            }
          }

          return nextPage
        })
      )
    },
    [applyState]
  )

  // Starting a retry keeps the recorded attempts and the page's completion
  // flag intact, but clears the submitted status and that questionnaire's own
  // answers so both presentations render it editable again. The active retry
  // marker is separate from submission on purpose: a restored completed page
  // must not infer this questionnaire back to submitted.
  const retryQuestionnaire = useCallback(
    (
      pageId: string,
      questionnaireId: string,
      questionIds: readonly string[],
      maxAttempts?: number
    ) => {
      const attemptLimit = normalizeAttemptLimit(maxAttempts)
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const historyLength = page.questionnaireAttempts?.[questionnaireId]?.length ?? 0
          const retries = page.activeQuestionnaireRetries ?? []
          if (historyLength >= attemptLimit || retries.includes(questionnaireId)) {
            return page
          }

          const answers = { ...page.answers }
          for (const questionId of questionIds) {
            delete answers[questionId]
          }
          const submitted = (page.submittedQuestionnaires ?? []).filter(
            (id) => id !== questionnaireId
          )
          const nextPage: typeof page = {
            ...page,
            activeQuestionnaireRetries: [...retries, questionnaireId]
          }

          if (Object.keys(answers).length > 0) {
            nextPage.answers = answers
          } else {
            delete nextPage.answers
          }

          if (submitted.length > 0) {
            nextPage.submittedQuestionnaires = submitted
          } else {
            delete nextPage.submittedQuestionnaires
          }

          return nextPage
        })
      )
    },
    [applyState]
  )

  // Stores a video's semantic playback position under the page/item that owns
  // it. The value is validated here — the semantic persistence boundary — and
  // normalized to tenths, so neither an invalid provider reading nor sub-tenth
  // noise can reach the persisted state. Package progress never depends on video
  // playback, so the accompanying `saveState` write carries the unchanged
  // progress `applyState` computes.
  const setVideoPosition = useCallback(
    (pageId: string, videoId: string, seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        return
      }
      const normalized = normalizeVideoPosition(seconds)
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          if (page.videos?.[videoId] === normalized) {
            return page
          }
          return { ...page, videos: { ...page.videos, [videoId]: normalized } }
        })
      )
    },
    [applyState]
  )

  // Package completion reuses the canonical helper: done nodes count toward
  // it for every presentation, so the player and the CLI stay in agreement.
  useScormBridge(isPackageComplete(contentPackage, getDoneNodeIds(contentPackage, state)))

  // The score is derived from the authored AST and the owned state on every
  // render — never stored separately — so it always reflects the current
  // answers, independent of submission or completion. The reporting effect keys
  // off the point counts, so it fires on mount and on genuine score changes, not
  // on unrelated renders. No scored questions yields `undefined`, never a zero.
  useScormScore(getAggregateQuestionnaireScore(contentPackage, state))

  return {
    state,
    markSeen,
    markCompleted,
    setAnswer,
    markQuestionnaireSubmitted,
    retryQuestionnaire,
    setVideoPosition
  }
}
