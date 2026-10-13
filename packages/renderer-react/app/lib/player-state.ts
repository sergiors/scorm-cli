import type {
  AnswerValue,
  ContentPackage,
  ItemNode,
  PageNode,
  PlayerPageState,
  PlayerState,
  QuestionNode
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
  completedImpliesSubmitted: boolean,
  videoIds: ReadonlySet<string>
): PlayerPageState | undefined {
  const questionnaires = collectQuestionnaires(node.content)
  const questions = new Map<string, QuestionNode>()
  const wrapperIds = new Set<string>()
  for (const questionnaire of questionnaires) {
    wrapperIds.add(questionnaire.id)
    for (const question of questionnaire.questions) {
      questions.set(question.id, question)
    }
  }

  const page: PlayerPageState = {}
  if (raw.visited === true) page.visited = true
  if (raw.completed === true) page.completed = true

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

  // Normalise submissions against the questionnaires this page actually owns.
  // A completed scroll page implies every questionnaire on it was submitted, so
  // resume stays read-only and gated even when only the completion flag was
  // persisted (the compact codec derives completion from progress).
  const provided = new Set(
    Array.isArray(raw.submittedQuestionnaires)
      ? raw.submittedQuestionnaires.filter((id): id is string => typeof id === 'string')
      : []
  )
  const submitted: string[] = []
  for (const id of wrapperIds) {
    if (provided.has(id) || (completedImpliesSubmitted && page.completed)) {
      submitted.push(id)
    }
  }
  if (submitted.length > 0) {
    page.submittedQuestionnaires = submitted
  }

  return Object.keys(page).length > 0 ? page : undefined
}

/**
 * Safely restores a persisted {@link PlayerState} against the current content
 * package. Unknown page ids and locations are dropped, as are answers to
 * questions that no longer exist (or no longer have the recorded options),
 * submission ids that no longer name a reachable questionnaire, and video
 * positions whose id no longer names a video authored on that page/item (or
 * whose value is not a finite, non-negative number). Video positions are scoped
 * to the page that owns the video, so a video moved to another page never
 * retains a position under its old page. A completed scroll page is normalized
 * to have all of its questionnaires submitted, so a resume that only persisted
 * completion stays read-only and gated. The result is always a plain in-memory
 * state — never the raw persisted object — so the renderer can mutate it without
 * touching whatever the bridge returned.
 */
export function sanitizePlayerState(contentPackage: ContentPackage, raw: unknown): PlayerState {
  const { presentation } = contentPackage
  const nodes = presentation.type === 'scroll' ? presentation.pages : presentation.items
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
    const page = sanitizePageState(
      node,
      pageRaw,
      presentation.type === 'scroll',
      nodeVideoIds(node)
    )
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
