import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { AnswerValue, PageNode, PlayerPageState } from '../types';
import { collectQuestionnaireIds } from '../lib/content-helpers';
import { Button } from './ui/button';
import { ContentRenderer } from './ContentRenderer';

/**
 * A page's top boundary counts as reached while it is still within the upper
 * part of the scroll viewport, so the previous affordance is offered as soon as
 * the page opens and disappears once the learner scrolls away from the top.
 */
const PAGE_START_MARGIN = '0px 0px -40% 0px';

/**
 * A page's end boundary counts as reached once the end sentinel enters the
 * scroll viewport, extended by a small positive bottom margin so the continue
 * affordance appears just before the learner reaches the very bottom.
 *
 * A negative bottom margin must not be used here: the end sentinel sits at the
 * maximum scroll offset, so shrinking the observer root's bottom can make it
 * impossible to intersect even at the page end. That is especially true for
 * pages no taller than the viewport (`min-h-dvh`), where the sentinel can never
 * rise into a shrunken root and the continue affordance stays hidden forever.
 * A non-negative/positive margin keeps the signal robust at the actual end.
 */
const PAGE_END_MARGIN = '0px 0px 64px 0px';

export interface ScrollPresentationProps {
  pages: PageNode[];
  /**
   * Page to open on first mount, so a saved lesson location can resume on the
   * bookmarked page instead of the first one. Clamped to the available pages
   * and applied once; later page changes are driven by the controls.
   */
  initialIndex?: number;
  /**
   * Persisted state per page id. Drives restored questionnaire answers and
   * submitted state, and gates completion on `submittedQuestionnaires`.
   */
  pageStates: Record<string, PlayerPageState>;
  /**
   * Invoked once per displayed page — on first mount and on every next/previous
   * transition — to store it as the current location and mark it visited.
   */
  onPageSeen: (id: string) => void;
  /**
   * Invoked once when the displayed page is complete: its end boundary was
   * reached and every questionnaire it contains has been submitted. Completion
   * — not mere visibility — is what reveals the continue affordance and marks
   * the page completed.
   */
  onPageCompleted: (id: string) => void;
  /** Persists a question answer for the displayed page. */
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void;
  /** Marks a questionnaire on the displayed page as submitted. */
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void;
}

/** Clamps a requested page index to the pages that actually exist. */
function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(pageCount - 1, index));
}

/**
 * Shows a single page at a time. Scrolling moves through the displayed page's
 * own content: its end boundary must be reached and every questionnaire on the
 * page submitted before the continue control appears, while its top is in
 * view a previous control returns to the prior page. Only the displayed page is
 * mounted, so adjacent pages are never exposed and there is no pager or package
 * chrome. The final page still observes its end so it can complete even though
 * it has no continue control.
 */
export function ScrollPresentation({
  pages,
  initialIndex = 0,
  pageStates,
  onPageSeen,
  onPageCompleted,
  onAnswer,
  onQuestionnaireSubmitted,
}: ScrollPresentationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(() =>
    clampPageIndex(initialIndex, pages.length),
  );
  // Boundary signals for the displayed page only. The optimistic defaults match
  // a freshly opened page: at its top, before its end is reached.
  const [atTop, setAtTop] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const lastIndex = pages.length - 1;
  const currentPage = pages[currentIndex];

  const goToPage = useCallback(
    (index: number) => {
      // Every page opens at its top. Resetting the scroller before swapping the
      // content keeps the previous page's offset from leaking into the new one,
      // and happens before the next page's controls are shown.
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollTop = 0;
      }
      setAtTop(true);
      setAtEnd(false);
      setCurrentIndex(Math.max(0, Math.min(lastIndex, index)));
    },
    [lastIndex],
  );

  const goToPrevious = useCallback(() => {
    goToPage(Math.max(0, currentIndex - 1));
  }, [currentIndex, goToPage]);

  const goToNext = useCallback(() => {
    goToPage(Math.min(lastIndex, currentIndex + 1));
  }, [currentIndex, goToPage, lastIndex]);

  const handleTopChange = useCallback((visible: boolean) => {
    setAtTop(visible);
  }, []);

  const handleEndChange = useCallback((visible: boolean) => {
    setAtEnd(visible);
  }, []);

  if (!currentPage) {
    return null;
  }

  const pageState = pageStates[currentPage.id];
  const submitted = pageState?.submittedQuestionnaires ?? [];
  const questionnaireIds = collectQuestionnaireIds(currentPage.content);
  const allQuestionnairesSubmitted = questionnaireIds.every((id) =>
    submitted.includes(id),
  );
  const pageComplete = atEnd && allQuestionnairesSubmitted;

  return (
    <div ref={scrollRef} className='h-dvh overflow-y-auto'>
      <PageScene
        key={currentPage.id}
        page={currentPage}
        index={currentIndex}
        hasPrev={currentIndex > 0}
        rootRef={scrollRef}
        pageState={pageState}
        onTopChange={handleTopChange}
        onEndChange={handleEndChange}
        onAnswer={onAnswer}
        onQuestionnaireSubmitted={onQuestionnaireSubmitted}
      />

      <PageSeenReporter pageId={currentPage.id} onPageSeen={onPageSeen} />

      <PageCompletionReporter
        pageId={currentPage.id}
        complete={pageComplete}
        onPageCompleted={onPageCompleted}
      />

      {currentIndex > 0 && atTop ? (
        <PreviousControl onClick={goToPrevious} />
      ) : null}

      {currentIndex < lastIndex && pageComplete ? (
        <NextControl onClick={goToNext} />
      ) : null}
    </div>
  );
}

/**
 * Reports the displayed page exactly once per display, storing it as the
 * current location and marking it visited. The ref guard keeps StrictMode's
 * doubled effects from writing the same page twice, while a genuine
 * next/previous transition changes the id and reports again. Only one page is
 * displayed at a time, so a page cannot be re-displayed without an intervening
 * transition.
 */
function PageSeenReporter({
  pageId,
  onPageSeen,
}: {
  pageId: string;
  onPageSeen: (id: string) => void;
}) {
  const reportedRef = useRef<string | null>(null);

  useEffect(() => {
    if (reportedRef.current === pageId) {
      return;
    }
    reportedRef.current = pageId;
    onPageSeen(pageId);
  }, [pageId, onPageSeen]);

  return null;
}

/**
 * Reports a page completion exactly once. The ref guard keeps repeated observer
 * callbacks (end regained after scrolling back down) and StrictMode's doubled
 * effects from reporting the same page more than once.
 */
function PageCompletionReporter({
  pageId,
  complete,
  onPageCompleted,
}: {
  pageId: string;
  complete: boolean;
  onPageCompleted: (id: string) => void;
}) {
  const reportedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!complete || reportedRef.current === pageId) {
      return;
    }
    reportedRef.current = pageId;
    onPageCompleted(pageId);
  }, [complete, pageId, onPageCompleted]);

  return null;
}

interface PageSceneProps {
  page: PageNode;
  index: number;
  /** Whether a preceding page exists; the first page offers nothing to return to. */
  hasPrev: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  pageState?: PlayerPageState;
  onTopChange: (visible: boolean) => void;
  onEndChange: (visible: boolean) => void;
  onAnswer: (pageId: string, questionId: string, value: AnswerValue) => void;
  onQuestionnaireSubmitted: (pageId: string, questionnaireId: string) => void;
}

/**
 * The single displayed page. It reports its top/end boundaries through
 * observers rooted to the scroll container, so the surrounding controls stay in
 * sync with what the learner can see. It remounts per page, which resets every
 * observer for the new page. Its end sentinel is always present — including on
 * the final page, which has no continue control but still completes at its end.
 */
function PageScene({
  page,
  index,
  hasPrev,
  rootRef,
  pageState,
  onTopChange,
  onEndChange,
  onAnswer,
  onQuestionnaireSubmitted,
}: PageSceneProps) {
  const startRef = useRef<HTMLDivElement>(null);
  // Previous boundary value so repeated observer callbacks that do not change
  // the state are ignored (no redundant state updates).
  const lastTopRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!hasPrev) {
      return;
    }
    const element = startRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (lastTopRef.current === visible) {
          return;
        }
        lastTopRef.current = visible;
        onTopChange(visible);
      },
      {
        root: rootRef.current ?? null,
        rootMargin: PAGE_START_MARGIN,
        threshold: 0,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasPrev, index, onTopChange, page.id, rootRef]);

  const endRef = useRef<HTMLDivElement>(null);
  const lastEndRef = useRef<boolean | null>(null);

  useEffect(() => {
    const element = endRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (lastEndRef.current === visible) {
          return;
        }
        lastEndRef.current = visible;
        onEndChange(visible);
      },
      {
        root: rootRef.current ?? null,
        rootMargin: PAGE_END_MARGIN,
        threshold: 0,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [index, onEndChange, page.id, rootRef]);

  return (
    <div
      data-scene-index={index}
      aria-label={page.metadata.title}
      className='mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16'
    >
      {hasPrev ? (
        <div
          ref={startRef}
          data-scroll-start={index}
          aria-hidden='true'
          className='h-px w-full'
        />
      ) : null}

      <section className='prose prose-stone '>
        <ContentRenderer
          nodes={page.content}
          headingOffset={2}
          answers={pageState?.answers}
          submittedQuestionnaires={pageState?.submittedQuestionnaires}
          onAnswer={(questionId, value) => onAnswer(page.id, questionId, value)}
          onQuestionnaireSubmitted={(id) =>
            onQuestionnaireSubmitted(page.id, id)
          }
        />
      </section>

      <div
        ref={endRef}
        data-scroll-end={index}
        aria-hidden='true'
        className='h-px w-full'
      />
    </div>
  );
}

/** Minimal floating control that returns to the previous page. */
function PreviousControl({ onClick }: { onClick: () => void }) {
  return (
    <div className='pointer-events-none fixed inset-x-0 top-0 z-10 flex justify-center py-4 bg-background/5 backdrop-blur-sm'>
      <Button
        type='button'
        variant='secondary'
        onClick={onClick}
        className='cursor-pointer pointer-events-auto rounded-full'
      >
        <ArrowUp aria-hidden='true' />
        Previous page
      </Button>
    </div>
  );
}

/** Minimal floating control that advances to the next page. */
function NextControl({ onClick }: { onClick: () => void }) {
  return (
    <div className='pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center py-4 bg-background/5 backdrop-blur-sm'>
      <Button
        type='button'
        variant='secondary'
        onClick={onClick}
        className='cursor-pointer pointer-events-auto rounded-full px-4'
      >
        Continue to next page
        <ArrowDown aria-hidden='true' />
      </Button>
    </div>
  );
}
