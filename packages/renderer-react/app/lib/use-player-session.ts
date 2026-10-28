import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AnswerValue,
  ContentNode,
  ContentPackage,
  InlineContentNode,
  PlayerState
} from '../types'
import {
  getAggregateQuestionnaireScore,
  getDoneNodeIds,
  getPackageProgress,
  getPresentationNodes,
  isPackageComplete
} from './content-helpers'
import {
  arePackageQuestionnairesComplete,
  arePageQuestionnairesComplete,
  findAuthoredQuestionnaire,
  hasUnlimitedQuestionnaireAttempts,
  questionnaireAttemptsRemaining
} from './questionnaire-completion'
import { getQuestionnaireResult } from './questionnaire'
import {
  sanitizePlayerState,
  sameAnswer,
  updatePageState,
  withLocation,
  normalizeVideoPosition
} from './player-state'
import { persistablePlayerState } from './reading-location'
import { restoreState, saveState, useScormBridge, useScormScore } from './use-scorm-bridge'

/**
 * Creates the session's global option-shuffle seed as a non-negative safe
 * integer. Prefers the platform crypto source; `Math.random` is only a fallback
 * for environments without Web Crypto. Callers must invoke this outside render.
 */
function createShuffleSeed(): number {
  const cryptoApi = globalThis.crypto
  if (cryptoApi !== undefined && typeof cryptoApi.getRandomValues === 'function') {
    try {
      const values = new Uint32Array(1)
      cryptoApi.getRandomValues(values)
      return values[0]
    } catch {
      // Fall through to the non-crypto fallback below.
    }
  }
  return Math.floor(Math.random() * 0x1_0000_0000)
}

/**
 * Whether any authored questionnaire opts into option shuffling. The traversal
 * ignores unknown runtime node types instead of throwing, so malformed content
 * still reaches the renderer's own explicit error.
 */
function packageHasShuffledQuestionnaires(contentPackage: ContentPackage): boolean {
  const visit = (nodes: ReadonlyArray<ContentNode | InlineContentNode>): boolean => {
    for (const node of nodes) {
      switch (node.type) {
        case 'questionnaire':
          if (node.shuffleOptions) return true
          break
        case 'list':
          if (node.items.some((item) => visit(item.children))) return true
          break
        case 'quote':
          if (visit(node.children)) return true
          break
        default:
          break
      }
    }
    return false
  }

  return getPresentationNodes(contentPackage).some((node) => visit(node.content))
}

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
  /**
   * Records the latest reading anchor without changing semantic state. A
   * changed anchor on the current page is persisted as a lesson-location update.
   */
  recordReadingPosition(pageId: string, anchor: string | null): void
  /** Marks a node completed (scroll completion is gated on this). */
  markCompleted(id: string): void
  /** Persists a question answer for a node. */
  setAnswer(pageId: string, questionId: string, value: AnswerValue): void
  /**
   * Persists the active question of a stepper questionnaire, scoped to the
   * page/item that owns it. A question outside the authored questionnaire is
   * rejected when the package defines that questionnaire, and an unchanged
   * active question is a no-op.
   */
  setActiveQuestionnaireItem(pageId: string, questionnaireId: string, questionId: string): void
  /**
   * Records a successful questionnaire submission from the latest page answers.
   * The canonical result is evaluated inside the state transition, so a stale
   * render-time score can never be recorded. Appends exactly one correct-answer
   * count to the attempt history (never beyond a finite authored cap), marks the
   * questionnaire submitted, and clears any active retry. The same write
   * completes the result when every question is correct or a finite cap has no
   * attempt left; an unlimited cap never completes automatically on an imperfect
   * result, which stays pending until the learner completes it manually.
   */
  markQuestionnaireSubmitted(pageId: string, questionnaireId: string): void
  /**
   * Starts a retry for a submitted questionnaire whose history still has an
   * attempt left: clears only its answers, keeps the history and page
   * completion, removes the submitted status, and marks it actively retrying.
   * A completed questionnaire can never be retried.
   */
  retryQuestionnaire(pageId: string, questionnaireId: string, questionIds: readonly string[]): void
  /**
   * Completes a pending submitted result without recording another attempt.
   * Idempotent, and the transition that makes an early result count toward page
   * completion and the aggregate score.
   */
  completeQuestionnaire(pageId: string, questionnaireId: string): void
  /**
   * Persists a video's semantic playback position in seconds, scoped to the
   * page/item that owns the video. Non-finite and negative positions are
   * ignored, values are normalized to tenths, and an unchanged position is a
   * no-op.
   */
  setVideoPosition(pageId: string, videoId: string, seconds: number): void
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
 * effects cannot double write. A package that shuffles questionnaire options
 * also gets one global shuffle seed, generated after restoration and persisted
 * with the rest of the state; a valid restored seed is never replaced.
 *
 * Completion semantics differ by presentation:
 * - Scroll and Slides pages are visited as soon as they are displayed. A page
 *   completes once its own completion rule is met (for Scroll, its end boundary
 *   was reached; for Slides, it is simply displayed) and every questionnaire on
 *   the page has satisfied its gate: submitted and completed. The page being
 *   viewed is stored as the lesson location. Both resume on that page after a
 *   refresh: the location the runtime read back (SCORM 1.2
 *   `cmi.core.lesson_location` / SCORM 2004 `cmi.location`, normalized to
 *   `PlayerState.location`) seeds the initial reading position, while restored
 *   answers, submissions and progress are unaffected. The package is complete
 *   once every page is completed.
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

  // The latest reading anchor, kept out of React state so scrolling does not
  // re-render. It starts from the restored anchor and is persisted only when it
  // changes on the current semantic page.
  const readingRef = useRef<{ pageId?: string; anchor?: string }>({
    pageId: state.location,
    anchor: state.anchor
  })

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
      saveState(
        persistablePlayerState(next, readingRef.current),
        getPackageProgress(contentPackage, next)
      )
    },
    [contentPackage]
  )

  // A package that never shuffles needs no seed, so sessions for such packages
  // keep their existing write behavior.
  const requiresShuffleSeed = packageHasShuffledQuestionnaires(contentPackage)

  // Generate the single global seed after the restored state has been validated,
  // never during render. A valid restored seed is kept as-is, and the ref guard
  // ensures StrictMode's doubled effect cannot generate a second one. The write
  // goes through `applyState`, so the seed is persisted with the rest of the
  // owned state.
  const shuffleSeedInitialized = useRef(false)
  useEffect(() => {
    if (stateRef.current.shuffleSeed !== undefined) {
      shuffleSeedInitialized.current = true
      return
    }
    if (!requiresShuffleSeed || shuffleSeedInitialized.current) {
      return
    }
    shuffleSeedInitialized.current = true
    const seed = createShuffleSeed()
    applyState((previous) =>
      previous.shuffleSeed === undefined ? { ...previous, shuffleSeed: seed } : previous
    )
  }, [applyState, requiresShuffleSeed])

  // The presentation owns geometry. Persist one location update per actual
  // anchor transition on the current page; pixel movement within the same
  // anchor remains a no-op and the in-memory semantic state stays unchanged.
  const recordReadingPosition = useCallback((pageId: string, anchor: string | null) => {
    const nextReading = {
      pageId,
      ...(anchor === null ? {} : { anchor })
    }
    const previousReading = readingRef.current
    if (
      previousReading.pageId === nextReading.pageId &&
      previousReading.anchor === nextReading.anchor
    ) {
      return
    }
    readingRef.current = nextReading
    const current = stateRef.current
    if (current.location === pageId) {
      saveState(
        persistablePlayerState(current, nextReading),
        getPackageProgress(contentPackage, current)
      )
    }
  }, [contentPackage])

  // Marks a page/item as seen and stores it as the current location in one
  // write, so a display never produces two bridge calls.
  const markSeen = useCallback(
    (id: string) => {
      if (readingRef.current.pageId !== id) {
        readingRef.current = { pageId: id }
      }
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

  // Remembers which stepper question is active so a resume or review returns to
  // it. The authored questionnaire validates the id whenever this package owns
  // it, so a stale or foreign question can never become the saved position. A
  // standalone rendered questionnaire has no authored definition to consult,
  // and its owner has already validated the id against its own questions.
  const setActiveQuestionnaireItem = useCallback(
    (pageId: string, questionnaireId: string, questionId: string) => {
      const authored = findAuthoredQuestionnaire(contentPackage, pageId, questionnaireId)
      if (authored && !authored.questions.some((question) => question.id === questionId)) {
        return
      }
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          if (page.activeQuestionnaireItems?.[questionnaireId] === questionId) {
            return page
          }
          return {
            ...page,
            activeQuestionnaireItems: {
              ...page.activeQuestionnaireItems,
              [questionnaireId]: questionId
            }
          }
        })
      )
    },
    [applyState, contentPackage]
  )

  // A successful submission is the only thing that consumes an attempt. Its
  // canonical result is evaluated from the exact `page.answers` inside the
  // transition, so the recorded count and the completion decision can never
  // come from a stale render closure. Exactly one attempt is appended, never
  // beyond a finite authored cap, and an active retry is cleared in the same
  // write. An unlimited cap never blocks a submission or completes an imperfect
  // result on exhaustion.
  const markQuestionnaireSubmitted = useCallback(
    (pageId: string, questionnaireId: string) => {
      const authored = findAuthoredQuestionnaire(contentPackage, pageId, questionnaireId)
      if (!authored) {
        return
      }
      const hasUnlimitedAttempts = hasUnlimitedQuestionnaireAttempts(authored)

      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const submitted = page.submittedQuestionnaires ?? []
          if (submitted.includes(questionnaireId)) {
            return page
          }

          const history = page.questionnaireAttempts?.[questionnaireId] ?? []
          if (!hasUnlimitedAttempts && history.length >= authored.maxAttempts) {
            return page
          }

          const result = getQuestionnaireResult(authored, page.answers)
          const nextHistory = [...history, result.correct]
          const isComplete =
            result.correct === result.total ||
            (!hasUnlimitedAttempts && questionnaireAttemptsRemaining(authored, nextHistory) === 0)
          const nextPage = {
            ...page,
            submittedQuestionnaires: [...submitted, questionnaireId],
            questionnaireAttempts: {
              ...page.questionnaireAttempts,
              [questionnaireId]: nextHistory
            }
          }

          if (isComplete) {
            const completed = page.completedQuestionnaires ?? []
            if (!completed.includes(questionnaireId)) {
              nextPage.completedQuestionnaires = [...completed, questionnaireId]
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
  // must not infer this questionnaire back to submitted. A completed
  // questionnaire can never start a retry.
  const retryQuestionnaire = useCallback(
    (pageId: string, questionnaireId: string, questionIds: readonly string[]) => {
      const authored = findAuthoredQuestionnaire(contentPackage, pageId, questionnaireId)
      if (!authored) {
        return
      }
      const hasUnlimitedAttempts = hasUnlimitedQuestionnaireAttempts(authored)

      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const history = page.questionnaireAttempts?.[questionnaireId] ?? []
          const retries = page.activeQuestionnaireRetries ?? []
          const completed = page.completedQuestionnaires ?? []
          const submitted = page.submittedQuestionnaires ?? []
          if (
            !submitted.includes(questionnaireId) ||
            completed.includes(questionnaireId) ||
            (!hasUnlimitedAttempts && questionnaireAttemptsRemaining(authored, history) === 0) ||
            retries.includes(questionnaireId)
          ) {
            return page
          }

          const answers = { ...page.answers }
          for (const questionId of questionIds) {
            delete answers[questionId]
          }
          const nextSubmitted = submitted.filter((id) => id !== questionnaireId)
          const nextPage: typeof page = {
            ...page,
            activeQuestionnaireRetries: [...retries, questionnaireId]
          }

          // A retry is a fresh round, so its saved active question is dropped
          // and the wizard starts at question 0 again. Other questionnaires on
          // the same page keep their own positions.
          const activeItems = page.activeQuestionnaireItems
          if (activeItems?.[questionnaireId] !== undefined) {
            const remainingItems = { ...activeItems }
            delete remainingItems[questionnaireId]
            if (Object.keys(remainingItems).length > 0) {
              nextPage.activeQuestionnaireItems = remainingItems
            } else {
              delete nextPage.activeQuestionnaireItems
            }
          }

          if (Object.keys(answers).length > 0) {
            nextPage.answers = answers
          } else {
            delete nextPage.answers
          }

          if (nextSubmitted.length > 0) {
            nextPage.submittedQuestionnaires = nextSubmitted
          } else {
            delete nextPage.submittedQuestionnaires
          }

          return nextPage
        })
      )
    },
    [applyState]
  )

  // Completing keeps the submitted attempt and its history exactly as they are;
  // it only records the learner's decision that the result is final. The write
  // is idempotent, and a completed questionnaire is no longer eligible for a
  // retry.
  const completeQuestionnaire = useCallback(
    (pageId: string, questionnaireId: string) => {
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const submitted = page.submittedQuestionnaires ?? []
          const completed = page.completedQuestionnaires ?? []
          if (!submitted.includes(questionnaireId) || completed.includes(questionnaireId)) {
            return page
          }
          return {
            ...page,
            completedQuestionnaires: [...completed, questionnaireId]
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
  // presentation, but additionally requires every authored questionnaire to be
  // completed. Tiles mark an item done as soon as it is opened, so without this
  // gate an open tile with a pending assessment could report the whole package
  // complete. Progress, done-node IDs and Tiles navigation intentionally keep
  // their existing semantics.
  const packageComplete =
    isPackageComplete(contentPackage, getDoneNodeIds(contentPackage, state)) &&
    arePackageQuestionnairesComplete(contentPackage, state)
  useScormBridge(packageComplete)

  // The score is derived by core from the authored AST and the owned state on
  // every render — never stored separately. Core excludes a questionnaire until
  // it is completed, then uses its best submitted attempt. The reporting effect
  // keys off the point counts, so it fires on mount and on genuine score
  // changes, not on unrelated renders. No scored questions yields `undefined`,
  // never a zero.
  useScormScore(getAggregateQuestionnaireScore(contentPackage, state))

  return {
    state,
    markSeen,
    recordReadingPosition,
    markCompleted,
    setAnswer,
    setActiveQuestionnaireItem,
    markQuestionnaireSubmitted,
    retryQuestionnaire,
    completeQuestionnaire,
    setVideoPosition
  }
}
