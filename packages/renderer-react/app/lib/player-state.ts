import type {
  AnswerValue,
  ContentPackage,
  PageNode,
  PlayerPageState,
  PlayerState,
  QuestionNode,
  QuestionnaireNode,
  ItemNode
} from '../types'
import { collectQuestionnaires, collectVideoNodes } from './content-helpers'

/** A fresh player state with no location and no recorded pages. */
export function emptyPlayerState(): PlayerState {
  return { pages: {} }
}

/** The semantic precision of a persisted video position: tenths of a second. */
export function normalizeVideoPosition(seconds: number): number {
  return Math.round(seconds * 10) / 10
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validates a persisted answer against the authored question. Only option
 * values that still exist are kept, and the shape must match the question type:
 * multiple-choice answers are string arrays, everything else a single string.
 * Correctness is never consulted, so a valid answer can never leak it.
 */
function sanitizeAnswer(question: QuestionNode, value: unknown): AnswerValue | undefined {
  const options = new Set(question.options.map((option) => option.value))
  if (question.questionType === 'multiple-choice') {
    if (!Array.isArray(value)) {
      return undefined
    }
    if (!value.every((item) => typeof item === 'string' && options.has(item))) {
      return undefined
    }
    return [...new Set(value as string[])]
  }
  if (typeof value !== 'string' || !options.has(value)) {
    return undefined
  }
  return value
}

function sanitizePageState(
  node: PageNode | ItemNode,
  raw: Record<string, unknown>,
  videoIds: ReadonlySet<string>
): PlayerPageState | undefined {
  const questionnaires = collectQuestionnaires(node.content)
  const questions = new Map<string, QuestionNode>()
  const questionnaireById = new Map<string, QuestionnaireNode>()
  const wrapperIds = new Set<string>()
  for (const questionnaire of questionnaires) {
    wrapperIds.add(questionnaire.id)
    questionnaireById.set(questionnaire.id, questionnaire)
    for (const question of questionnaire.questions) {
      questions.set(question.id, question)
    }
  }

  const page: PlayerPageState = {}
  if (raw.visited === true) page.visited = true
  const completedWasPersisted = raw.completed === true

  // Completion is restored strictly from its own persisted field. It is never
  // inferred from attempt history, submission status, or page completion.
  const completed = new Set<string>()
  if (Array.isArray(raw.completedQuestionnaires)) {
    for (const questionnaireId of raw.completedQuestionnaires) {
      if (typeof questionnaireId === 'string' && questionnaireById.has(questionnaireId)) {
        completed.add(questionnaireId)
      }
    }
  }

  // A page cannot be complete while any authored questionnaire still has a
  // pending result. Older suspend data could carry such a stale flag, so drop
  // it and let the presentation reporter restore completion only after every
  // questionnaire is completed.
  const hasPendingQuestionnaire = questionnaires.some(
    (questionnaire) => !completed.has(questionnaire.id)
  )
  if (completedWasPersisted && !hasPendingQuestionnaire) page.completed = true

  if (isRecord(raw.answers)) {
    const answers: Record<string, AnswerValue> = {}
    for (const [questionId, value] of Object.entries(raw.answers)) {
      const question = questions.get(questionId)
      if (!question) continue
      const sanitized = sanitizeAnswer(question, value)
      if (sanitized !== undefined) answers[questionId] = sanitized
    }
    if (Object.keys(answers).length > 0) page.answers = answers
  }

  // Attempt histories are scoped to questionnaires this node actually owns and
  // must stay within the authored cap and question count. A restored history is
  // what lets a resumed questionnaire show Try Again only while attempts
  // remain, so an out-of-range history is dropped rather than truncated.
  const attempts: Record<string, number[]> = {}
  if (isRecord(raw.questionnaireAttempts)) {
    for (const [questionnaireId, value] of Object.entries(raw.questionnaireAttempts)) {
      const questionnaire = questionnaireById.get(questionnaireId)
      if (!questionnaire || !Array.isArray(value)) continue
      if (value.length === 0 || value.length > questionnaire.maxAttempts) continue
      if (
        !value.every(
          (count) =>
            typeof count === 'number' &&
            Number.isSafeInteger(count) &&
            count >= 0 &&
            count <= questionnaire.questions.length
        )
      ) {
        continue
      }
      attempts[questionnaireId] = [...value]
    }
    if (Object.keys(attempts).length > 0) page.questionnaireAttempts = attempts
  }

  // An in-progress retry is only meaningful with a recorded history that still
  // has an attempt left. A completed questionnaire can never be retried, so its
  // stale marker is dropped here.
  const retries = new Set<string>()
  if (Array.isArray(raw.activeQuestionnaireRetries)) {
    for (const questionnaireId of raw.activeQuestionnaireRetries) {
      if (typeof questionnaireId !== 'string') continue
      const questionnaire = questionnaireById.get(questionnaireId)
      if (!questionnaire || completed.has(questionnaireId)) continue
      const history = attempts[questionnaireId]
      if (!history || history.length >= questionnaire.maxAttempts) continue
      retries.add(questionnaireId)
    }
  }

  // Video positions are scoped to the page/item that owns the video: only ids
  // reachable in this node's nested AST are kept, so a video moved to another
  // page never retains a position under the page that used to own it. Invalid
  // values are dropped and the rest normalized to tenths of a second.
  if (isRecord(raw.videos)) {
    const videos: Record<string, number> = {}
    for (const [videoId, value] of Object.entries(raw.videos)) {
      if (!videoIds.has(videoId)) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
      videos[videoId] = normalizeVideoPosition(value)
    }
    if (Object.keys(videos).length > 0) page.videos = videos
  }

  // Normalise submissions against the questionnaires this node actually owns.
  // A recorded attempt restores a submitted (possibly pending) result even
  // though suspend data never encoded `submittedQuestionnaires`; completion is
  // still read only from its own field above. An active retry intentionally has
  // no submission.
  const provided = new Set(
    Array.isArray(raw.submittedQuestionnaires)
      ? raw.submittedQuestionnaires.filter((id): id is string => typeof id === 'string')
      : []
  )
  const submitted: string[] = []
  for (const id of wrapperIds) {
    if (retries.has(id)) continue
    const history = attempts[id]
    if (provided.has(id) || completed.has(id) || (history !== undefined && history.length > 0)) {
      submitted.push(id)
    }
  }

  // Legacy suspend data did not store attempt history. When submission is
  // nevertheless known, seed its single historical score from the sanitized
  // answers so a resumed questionnaire never grants a fresh full allowance.
  // Never infer history for an active retry.
  const submittedIds = new Set(submitted)
  for (const questionnaire of questionnaires) {
    if (
      attempts[questionnaire.id] ||
      !submittedIds.has(questionnaire.id) ||
      retries.has(questionnaire.id)
    ) {
      continue
    }
    let correctCount = 0
    for (const question of questionnaire.questions) {
      const answer = page.answers?.[question.id]
      const correctValues = question.options
        .filter((option) => option.correct)
        .map((option) => option.value)
      if (question.questionType === 'multiple-choice') {
        if (correctValues.length === 0 || !Array.isArray(answer)) continue
        const selected = new Set(answer)
        const correct = new Set(correctValues)
        if (selected.size === correct.size && [...selected].every((value) => correct.has(value))) {
          correctCount += 1
        }
      } else if (typeof answer === 'string' && correctValues.includes(answer)) {
        correctCount += 1
      }
    }
    attempts[questionnaire.id] = [correctCount]
  }
  if (Object.keys(attempts).length > 0) page.questionnaireAttempts = attempts

  if (completed.size > 0) {
    page.completedQuestionnaires = [...completed]
  }

  if (submitted.length > 0) {
    page.submittedQuestionnaires = submitted
  }

  const activeRetries = [...retries].filter((id) => !submittedIds.has(id) && !completed.has(id))
  if (activeRetries.length > 0) {
    page.activeQuestionnaireRetries = activeRetries
  }

  return Object.keys(page).length > 0 ? page : undefined
}

/**
 * Safely restores a persisted {@link PlayerState} against the current content
 * package. Unknown page ids and locations are dropped, as are answers to
 * questions that no longer exist (or no longer have the recorded options),
 * submission ids that no longer name a reachable questionnaire, and video
 * positions whose id no longer names a video authored on that page/item (or
 * whose value is not a finite, non-negative number). Attempt histories are
 * validated against the authored attempt cap and question count, and an active
 * retry survives only while its history still has an attempt left. A recorded
 * attempt restores its submitted result even though suspend data never encoded
 * submissions, while completion is restored only from its own field. Video
 * positions are scoped to the page/item that owns the video, so a video moved to
 * another node never retains a position under its old node. A persisted page
 * completion survives only when every authored questionnaire has completed its
 * result; an in-progress retry stays unsubmitted. A submitted questionnaire with
 * no legacy history is seeded with one score from its sanitized answers. The
 * result is always a plain in-memory state — never the raw persisted object — so
 * the renderer can mutate it without touching whatever the bridge returned.
 */
export function sanitizePlayerState(contentPackage: ContentPackage, raw: unknown): PlayerState {
  const { presentation } = contentPackage
  const nodes = presentation.type === 'tiles' ? presentation.items : presentation.pages
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const state: PlayerState = { pages: {} }

  if (!isRecord(raw)) {
    return state
  }

  if (typeof raw.location === 'string' && byId.has(raw.location)) {
    state.location = raw.location
  }

  if (!isRecord(raw.pages)) {
    return state
  }

  for (const [pageId, pageRaw] of Object.entries(raw.pages)) {
    const node = byId.get(pageId)
    if (!node || !isRecord(pageRaw)) continue
    const page = sanitizePageState(node, pageRaw, nodeVideoIds(node))
    if (page) state.pages[pageId] = page
  }

  return state
}

/**
 * The ids of every video authored inside a single page/item's nested AST.
 * Reuses the canonical core traversal directly on the node's content, so a page
 * only accepts positions for the videos it actually owns.
 */
function nodeVideoIds(node: PageNode | ItemNode): Set<string> {
  const videos = collectVideoNodes(node.content)
  return new Set(videos.map((video) => video.id))
}

/**
 * Returns a new state with `pageId`'s page state replaced by the result of
 * `update`. Preserves referential identity when the update changes nothing, so
 * callers can skip both a re-render and a bridge write.
 */
export function updatePageState(
  state: PlayerState,
  pageId: string,
  update: (page: PlayerPageState) => PlayerPageState
): PlayerState {
  const page = state.pages[pageId] ?? {}
  const nextPage = update(page)
  if (nextPage === page) {
    return state
  }
  return { ...state, pages: { ...state.pages, [pageId]: nextPage } }
}

/** Returns a new state with `location` set, preserving pages state. */
export function withLocation(state: PlayerState, location: string): PlayerState {
  return state.location === location ? state : { ...state, location }
}

/** Compares two answers so an unchanged selection never triggers a write. */
export function sameAnswer(previous: AnswerValue | undefined, next: AnswerValue): boolean {
  if (Array.isArray(previous) || Array.isArray(next)) {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
      return false
    }
    return (
      previous.length === next.length && previous.every((value, index) => value === next[index])
    )
  }
  return previous === next
}
