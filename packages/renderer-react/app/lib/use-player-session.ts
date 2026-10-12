import { useCallback, useRef, useState } from 'react';
import type { AnswerValue, ContentPackage, PlayerState } from '../types';
import { getPackageProgress, getPresentationNodes, isPackageComplete } from './content-helpers';
import { sanitizePlayerState, sameAnswer, updatePageState, withLocation } from './player-state';
import { restoreState, saveState, useScormBridge } from './use-scorm-bridge';

/**
 * The learner's owned progress plus the transitions that mutate it, as returned
 * by {@link usePlayerSession}. Presentations stay stateless: they render
 * `state` and call these handlers, never persisting anything themselves.
 */
export interface PlayerSession {
  /** The in-memory resume state (lesson location plus per-node progress). */
  state: PlayerState;
  /** Stores a node as the current location and marks it visited in one write. */
  markSeen(id: string): void;
  /** Marks a node completed (scroll completion is gated on this). */
  markCompleted(id: string): void;
  /** Persists a question answer for a node. */
  setAnswer(pageId: string, questionId: string, value: AnswerValue): void;
  /** Marks a questionnaire on a node as submitted. */
  markQuestionnaireSubmitted(pageId: string, questionnaireId: string): void;
}

/**
 * Owns the whole learner session for a package: restoring, validating, mutating
 * and persisting the resume state, and reporting completion to the SCORM
 * bridge. Presentation selection and rendering live in the caller, so this hook
 * is the single state/transition/persistence boundary.
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
 * - Scroll pages are visited as soon as they are displayed and complete only
 *   once their end boundary is reached and every questionnaire on the page has
 *   been submitted. The page being viewed is stored as the lesson location, so
 *   a refresh resumes on that page even when it is not complete. The package is
 *   complete once every page is completed.
 * - Grid items are visited (and stored as the location) as they are opened; the
 *   package is complete once every item has been opened. A saved location
 *   reopens that item's dialog on mount.
 */
export function usePlayerSession(contentPackage: ContentPackage): PlayerSession {
  const { presentation } = contentPackage;

  // Validate the saved state once, on first mount. Reading the bridge is a pure
  // lookup and sanitizing is pure, so StrictMode's doubled initializer yields
  // the same value.
  const [state, setState] = useState<PlayerState>(() =>
    sanitizePlayerState(presentation, restoreState()),
  );
  const stateRef = useRef(state);

  // Applies a pure update to the owned state and persists the result. The ref
  // is updated synchronously so back-to-back interactions compose, and the
  // bridge write happens outside the updater — never as a side effect of it.
  // The readable state and its integer progress travel together; the runtime
  // owns encoding both, so the renderer never serializes suspend data.
  const applyState = useCallback(
    (updater: (previous: PlayerState) => PlayerState) => {
      const previous = stateRef.current;
      const next = updater(previous);
      if (next === previous) {
        return;
      }
      stateRef.current = next;
      setState(next);
      saveState(next, getPackageProgress(contentPackage, next));
    },
    [contentPackage],
  );

  // Marks a page/item as seen and stores it as the current location in one
  // write, so a display never produces two bridge calls.
  const markSeen = useCallback(
    (id: string) => {
      applyState((previous) => {
        const visited = updatePageState(previous, id, (page) =>
          page.visited ? page : { ...page, visited: true },
        );
        return withLocation(visited, id);
      });
    },
    [applyState],
  );

  const markCompleted = useCallback(
    (id: string) => {
      applyState((previous) =>
        updatePageState(previous, id, (page) =>
          page.completed ? page : { ...page, completed: true },
        ),
      );
    },
    [applyState],
  );

  const setAnswer = useCallback(
    (pageId: string, questionId: string, value: AnswerValue) => {
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          if (sameAnswer(page.answers?.[questionId], value)) {
            return page;
          }
          return { ...page, answers: { ...page.answers, [questionId]: value } };
        }),
      );
    },
    [applyState],
  );

  const markQuestionnaireSubmitted = useCallback(
    (pageId: string, questionnaireId: string) => {
      applyState((previous) =>
        updatePageState(previous, pageId, (page) => {
          const submitted = page.submittedQuestionnaires ?? [];
          if (submitted.includes(questionnaireId)) {
            return page;
          }
          return {
            ...page,
            submittedQuestionnaires: [...submitted, questionnaireId],
          };
        }),
      );
    },
    [applyState],
  );

  // Scroll completion requires every page to be *completed*; grid completion
  // requires every item to be *visited*. Reusing the canonical helper keeps
  // both presentations (and the CLI) in agreement.
  const doneNodeIds = getPresentationNodes(contentPackage)
    .filter((node) =>
      presentation.type === 'scroll'
        ? state.pages[node.id]?.completed
        : state.pages[node.id]?.visited,
    )
    .map((node) => node.id);
  useScormBridge(isPackageComplete(contentPackage, doneNodeIds));

  return { state, markSeen, markCompleted, setAnswer, markQuestionnaireSubmitted };
}
