import type {
  AnswerValue,
  ItemNode,
  PageNode,
  PlayerPageState,
  PlayerState,
  QuestionNode,
  RootPresentation,
} from '../types';
import { collectQuestionnaires } from './content-helpers';

/** A fresh player state with no location and no recorded pages. */
export function emptyPlayerState(): PlayerState {
  return { pages: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a persisted answer against the authored question. Only option
 * values that still exist are kept, and the shape must match the question type:
 * multiple-choice answers are string arrays, everything else a single string.
 * Correctness is never consulted, so a valid answer can never leak it.
 */
function sanitizeAnswer(
  question: QuestionNode,
  value: unknown,
): AnswerValue | undefined {
  const options = new Set(question.options.map((option) => option.value));
  if (question.questionType === 'multiple-choice') {
    if (!Array.isArray(value)) {
      return undefined;
    }
    if (!value.every((item) => typeof item === 'string' && options.has(item))) {
      return undefined;
    }
    return [...new Set(value as string[])];
  }
  if (typeof value !== 'string' || !options.has(value)) {
    return undefined;
  }
  return value;
}

function sanitizePageState(
  node: PageNode | ItemNode,
  raw: Record<string, unknown>,
  completedImpliesSubmitted: boolean,
): PlayerPageState | undefined {
  const questionnaires = collectQuestionnaires(node.content);
  const questions = new Map<string, QuestionNode>();
  const wrapperIds = new Set<string>();
  for (const questionnaire of questionnaires) {
    wrapperIds.add(questionnaire.id);
    for (const question of questionnaire.questions) {
      questions.set(question.id, question);
    }
  }

  const page: PlayerPageState = {};
  if (raw.visited === true) page.visited = true;
  if (raw.completed === true) page.completed = true;

  if (isRecord(raw.answers)) {
    const answers: Record<string, AnswerValue> = {};
    for (const [questionId, value] of Object.entries(raw.answers)) {
      const question = questions.get(questionId);
      if (!question) continue;
      const sanitized = sanitizeAnswer(question, value);
      if (sanitized !== undefined) answers[questionId] = sanitized;
    }
    if (Object.keys(answers).length > 0) page.answers = answers;
  }

  // Normalise submissions against the questionnaires this page actually owns.
  // A completed scroll page implies every questionnaire on it was submitted, so
  // resume stays read-only and gated even when only the completion flag was
  // persisted (the compact codec derives completion from progress).
  const provided = new Set(
    Array.isArray(raw.submittedQuestionnaires)
      ? raw.submittedQuestionnaires.filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
  );
  const submitted: string[] = [];
  for (const id of wrapperIds) {
    if (provided.has(id) || (completedImpliesSubmitted && page.completed)) {
      submitted.push(id);
    }
  }
  if (submitted.length > 0) {
    page.submittedQuestionnaires = submitted;
  }

  return Object.keys(page).length > 0 ? page : undefined;
}

/**
 * Safely restores a persisted {@link PlayerState} against the current
 * presentation AST. Unknown page ids and locations are dropped, as are answers
 * to questions that no longer exist (or no longer have the recorded options),
 * and submission ids that no longer name a reachable questionnaire. A completed
 * scroll page is normalized to have all of its questionnaires submitted, so a
 * resume that only persisted completion stays read-only and gated. The result is
 * always a plain in-memory state — never the raw persisted object — so the
 * renderer can mutate it without touching whatever the bridge returned.
 */
export function sanitizePlayerState(
  presentation: RootPresentation,
  raw: unknown,
): PlayerState {
  const nodes =
    presentation.type === 'scroll' ? presentation.pages : presentation.items;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state: PlayerState = { pages: {} };

  if (!isRecord(raw)) {
    return state;
  }

  if (typeof raw.location === 'string' && byId.has(raw.location)) {
    state.location = raw.location;
  }

  if (!isRecord(raw.pages)) {
    return state;
  }

  for (const [pageId, pageRaw] of Object.entries(raw.pages)) {
    const node = byId.get(pageId);
    if (!node || !isRecord(pageRaw)) continue;
    const page = sanitizePageState(
      node,
      pageRaw,
      presentation.type === 'scroll',
    );
    if (page) state.pages[pageId] = page;
  }

  return state;
}

/**
 * Returns a new state with `pageId`'s page state replaced by the result of
 * `update`. Preserves referential identity when the update changes nothing, so
 * callers can skip both a re-render and a bridge write.
 */
export function updatePageState(
  state: PlayerState,
  pageId: string,
  update: (page: PlayerPageState) => PlayerPageState,
): PlayerState {
  const page = state.pages[pageId] ?? {};
  const nextPage = update(page);
  if (nextPage === page) {
    return state;
  }
  return { ...state, pages: { ...state.pages, [pageId]: nextPage } };
}

/** Returns a new state with `location` set, preserving pages state. */
export function withLocation(
  state: PlayerState,
  location: string,
): PlayerState {
  return state.location === location ? state : { ...state, location };
}

/** Compares two answers so an unchanged selection never triggers a write. */
export function sameAnswer(
  previous: AnswerValue | undefined,
  next: AnswerValue,
): boolean {
  if (Array.isArray(previous) || Array.isArray(next)) {
    if (!Array.isArray(previous) || !Array.isArray(next)) {
      return false;
    }
    return (
      previous.length === next.length &&
      previous.every((value, index) => value === next[index])
    );
  }
  return previous === next;
}
