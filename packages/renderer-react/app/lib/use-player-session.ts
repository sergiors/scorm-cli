import { useCallback, useRef, useState } from 'react'
import type { AnswerValue, ContentPackage, PlayerState } from '../types'
import {
  getAggregateQuestionnaireScore,
  getDoneNodeIds,
  getPackageProgress,
  getPresentationNodes,
  isPackageComplete
} from './content-helpers'
import {
  arePageQuestionnairesComplete,
  areRetryQuestionnairesFinalized,
  findAuthoredQuestionnaire,
  questionnaireRequiresFinalization
} from './questionnaire-finalization'
import { getQuestionnaireResult } from './questionnaire'
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
   * Records a successful questionnaire submission from the latest page answers.
   * The canonical result is evaluated inside the state transition, so a stale
   * render-time score can never be recorded. Appends the correct-answer count to
   * the attempt history (never beyond the authored cap), marks the questionnaire
   * submitted, and clears any active retry. An explicitly retry-enabled
   * questionnaire finalizes automatically when perfect or at the cap; an
   * explicit single attempt finalizes immediately. An omitted cap keeps the
   * immediate-final behavior without a finalization marker.
   */
  markQuestionnaireSubmitted(pageId: string, questionnaireId: string): void
  /**
   * Starts a retry for a submitted questionnaire whose history still has an
   * attempt left: clears only its answers, keeps the history and page
   * completion, removes the submitted status, and marks it actively retrying.
   * A finalized questionnaire can never be retried.
   */
  retryQuestionnaire(
    pageId: string,
    questionnaireId: string,
    questionIds: readonly string[],
    maxAttempts?: number
  ): void
  /**
   * Finalizes a pending submitted result without recording another attempt.
   * Idempotent, and the only transition that makes a retry-enabled
   * questionnaire count toward page completion and the aggregate score.
   */
  finalizeQuestionnaire(pageId: string, questionnaireId: string): void
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
 *   the page has satisfied its gate: submitted, and finalized too when its
 *   authored attempt cap explicitly exceeds one. The page being viewed is
 *   stored as the lesson location. Both resume on that page after a refresh: the location the runtime
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

  // Completion is the single place a page can become done. Re-check the
  // authored questionnaire gate here as well as in the presentations, so a
  // pending retry assessment can never mark a page complete by any caller.
  const markCompleted = useCallback(
    (id: string) => {
      applyState((previous) => {
        const node = getPresentationNodes(contentPackage).find((candidate) => candidate.id === id)
        if (node && !arePageQuestionnairesComplete(node.content, previous.pages[id])) {
          return previous
        }
        return updatePageState(previous, id, (page) =>
          page.completed ? page : { ...page, completed: true }
        )
      })
    },
    [applyState, contentPackage]
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

  // A successful submission is the only thing that consumes an attempt. Its
  // canonical result is evaluated from the exact `page.answers` inside the
  // transition, so the recorded count and the perfect/cap decision can never
  // come from a stale render closure. The append is capped here as well as in
  // the UI, and an active retry is cleared in the same write.
  const markQuestionnaireSubmitted = useCallback(
    (pageId: string, questionnaireId: string) => {
      const authored = findAuthoredQuestionnaire(contentPackage, pageId, questionnaireId)
      const attemptLimit = normalizeAttemptLimit(authored?.maxAttempts)
      const requiresFinalization = authored ? questionnaireRequiresFinalization(authored) : false
      const explicitSingle = authored?.maxAttempts === 1

      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const submitted = page.submittedQuestionnaires ?? []
          if (submitted.includes(questionnaireId)) {
            return page
          }

          const correct = authored
            ? getQuestionnaireResult(authored, page.answers).correct
            : undefined
          const totalQuestions = authored?.questions.length
          const history = page.questionnaireAttempts?.[questionnaireId] ?? []
          const nextHistory =
            correct !== undefined && history.length < attemptLimit ? [...history, correct] : history
          const perfect =
            correct !== undefined &&
            totalQuestions !== undefined &&
            totalQuestions > 0 &&
            correct >= totalQuestions
          const shouldFinalize =
            explicitSingle ||
            (requiresFinalization && (perfect || nextHistory.length >= attemptLimit))
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

          if (shouldFinalize) {
            const finalized = page.finalizedQuestionnaires ?? []
            if (!finalized.includes(questionnaireId)) {
              nextPage.finalizedQuestionnaires = [...finalized, questionnaireId]
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
    [applyState, contentPackage]
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
          const finalized = page.finalizedQuestionnaires ?? []
          if (
            finalized.includes(questionnaireId) ||
            historyLength >= attemptLimit ||
            retries.includes(questionnaireId)
          ) {
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

  // Finalizing keeps the submitted attempt and its history exactly as they are;
  // it only records the learner's decision that the result is final. The write
  // is idempotent, and a finalized questionnaire is no longer eligible for a
  // retry.
  const finalizeQuestionnaire = useCallback(
    (pageId: string, questionnaireId: string) => {
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const submitted = page.submittedQuestionnaires ?? []
          const finalized = page.finalizedQuestionnaires ?? []
          if (!submitted.includes(questionnaireId) || finalized.includes(questionnaireId)) {
            return page
          }
          return {
            ...page,
            finalizedQuestionnaires: [...finalized, questionnaireId]
          }
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

  // Package completion reuses the canonical done-node rule for every
  // presentation, but additionally requires every authored explicitly
  // retry-enabled questionnaire to be finalized. Tiles mark an item done as soon
  // as it is opened, so without this gate an open tile with a pending retry
  // assessment could report the whole package complete. Progress, done-node IDs
  // and Tiles navigation intentionally keep their existing semantics.
  const packageComplete =
    isPackageComplete(contentPackage, getDoneNodeIds(contentPackage, state)) &&
    areRetryQuestionnairesFinalized(contentPackage, state)
  useScormBridge(packageComplete)

  // The score is derived by core from the authored AST and the owned state on
  // every render — never stored separately. Core excludes a retry-enabled
  // questionnaire until it is finalized, then uses its best submitted attempt;
  // single-attempt questionnaires keep scoring saved answers. The reporting
  // effect keys off the point counts, so it fires on mount and on genuine score
  // changes, not on unrelated renders. No scored questions yields `undefined`,
  // never a zero.
  useScormScore(getAggregateQuestionnaireScore(contentPackage, state))

  return {
    state,
    markSeen,
    markCompleted,
    setAnswer,
    markQuestionnaireSubmitted,
    retryQuestionnaire,
    finalizeQuestionnaire,
    setVideoPosition
  }
}
