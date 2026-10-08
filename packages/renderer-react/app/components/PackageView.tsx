import { useCallback, useRef, useState } from 'react';
import type { AnswerValue, ContentPackage, PlayerState } from '../types';
import { getPackageProgress, isPackageComplete } from '../lib/content-helpers';
import {
  sanitizePlayerState,
  sameAnswer,
  updatePageState,
  withLocation,
} from '../lib/player-state';
import {
  restoreState,
  saveState,
  useScormBridge,
} from '../lib/use-scorm-bridge';
import { GridPresentation } from './GridPresentation';
import { ScrollPresentation } from './ScrollPresentation';

export interface PackageViewProps {
  contentPackage: ContentPackage;
}

/**
 * Dispatches on the authored root presentation and renders its leaf content
 * directly, in document order.
 *
 * There is no package chrome: no header, sidebar, breadcrumb, global navigation
 * or progress/completion UI. Completion is still tracked internally and
 * reported through the SCORM bridge, but it is never rendered.
 *
 * All learner progress lives in a single in-memory {@link PlayerState} keyed by
 * stable authored ids and answer values, kept separate from the SCORM runtime's
 * compact encoding. The renderer reads the saved state once on mount through
 * `restoreState()`, validates it against the current presentation, and from then
 * on owns a plain state object. Every genuine change is written back through
 * `saveState(state, progress)` — the integer package progress is computed with
 * the canonical core helper. Side effects never run inside a React state updater,
 * and the ref below is the source of truth so StrictMode's doubled effects cannot
 * double write.
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
export function PackageView({ contentPackage }: PackageViewProps) {
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
  const complete = isPackageComplete(
    contentPackage,
    presentation.type === 'scroll'
      ? presentation.pages
          .filter((page) => state.pages[page.id]?.completed)
          .map((page) => page.id)
      : presentation.items
          .filter((item) => state.pages[item.id]?.visited)
          .map((item) => item.id),
  );
  useScormBridge(complete);

  if (presentation.type === 'scroll') {
    if (presentation.pages.length === 0) {
      return <EmptyPackage />;
    }
    const initialIndex = Math.max(
      0,
      presentation.pages.findIndex((page) => page.id === state.location),
    );
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
    );
  }

  return presentation.items.length === 0 ? (
    <EmptyPackage />
  ) : (
    <GridPresentation
      items={presentation.items}
      columns={presentation.columns}
      pageStates={state.pages}
      initialItemId={state.location}
      onItemOpened={markSeen}
      onAnswer={setAnswer}
      onQuestionnaireSubmitted={markQuestionnaireSubmitted}
    />
  );
}

function EmptyPackage() {
  return (
    <p className='p-6 text-sm text-muted-foreground'>
      This package does not contain any content.
    </p>
  );
}
