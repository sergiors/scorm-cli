// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageView } from '../../app/components/PackageView';
import type {
  ContentPackage,
  ItemNode,
  PageNode,
  PlayerState,
  QuestionnaireNode,
} from '../../app/types';
import { gridPackage, headingDepths, introPage, setupPage } from './fixtures';
import { PlayerI18nProvider } from '../../app/lib/player-i18n';

/**
 * Renders a package under the player's i18n provider, mirroring `PackageApp`.
 * The provider normally lives at the app boundary; these tests render
 * `PackageView` directly, so they supply it here.
 */
function Player({ contentPackage }: { contentPackage: ContentPackage }) {
  return (
    <PlayerI18nProvider lang={contentPackage.metadata.lang}>
      <PackageView contentPackage={contentPackage} />
    </PlayerI18nProvider>
  );
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

interface FakeObserverState {
  callback: IntersectionObserverCallback;
  elements: Set<Element>;
  options?: IntersectionObserverInit;
}

const observers: FakeObserverState[] = [];

class FakeIntersectionObserver {
  private readonly state: FakeObserverState;

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.state = { callback, elements: new Set<Element>(), options };
    observers.push(this.state);
  }

  observe(element: Element): void {
    this.state.elements.add(element);
  }

  unobserve(element: Element): void {
    this.state.elements.delete(element);
  }

  disconnect(): void {
    this.state.elements.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

let originalIntersectionObserver: typeof IntersectionObserver | undefined;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  observers.length = 0;
  originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  // The player resets the document scroll through `window.scrollTo`; jsdom does
  // not implement it, so spy on it to observe the reset without side effects.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.scormBridge;
  if (originalIntersectionObserver) {
    globalThis.IntersectionObserver = originalIntersectionObserver;
  }
  vi.restoreAllMocks();
});

function text(): string {
  return container.textContent ?? '';
}

function documentText(): string {
  return document.body.textContent ?? '';
}

function findButton(prefix: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((node) =>
    node.textContent?.trim().startsWith(prefix),
  );
  if (!button) {
    throw new Error(`Button not found: ${prefix}`);
  }
  return button;
}

function input(value: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(
    `input[value="${value}"]`,
  );
  if (!element) {
    throw new Error(`Input not found for value: ${value}`);
  }
  return element;
}

/**
 * A read-only submitted choice. Submitted answers render through the shadcn
 * questionnaire choice part (dialogs portal into `document`), so search the
 * whole document rather than the render container.
 */
function submittedControl(value: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(
    `[data-slot="questionnaire-choice-input"][value="${value}"]`,
  );
  if (!element) {
    throw new Error(`Submitted control not found for value: ${value}`);
  }
  return element;
}

/** Answers the standard intro questionnaire (single- then multiple-choice). */
function answerQuestionnaire(): void {
  act(() => input('first').click());
  act(() => findButton('Next question').click());
  act(() => input('alpha').click());
  act(() => findButton('Submit questionnaire').click());
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

/** The state passed to the most recent `saveState` call. */
function lastSaved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls;
  return calls[calls.length - 1]?.[0] as PlayerState;
}

/** The integer progress passed to the most recent `saveState` call. */
function lastProgress(saveState: { mock: { calls: unknown[][] } }): number {
  const calls = saveState.mock.calls;
  return calls[calls.length - 1]?.[1] as number;
}

/** Finds the fake observer currently watching the given element. */
function observerFor(element: Element): FakeObserverState {
  const state = observers.find((candidate) => candidate.elements.has(element));
  if (!state) {
    throw new Error('No IntersectionObserver is watching the element');
  }
  return state;
}

/** Drives the fake observer watching a single element. */
function driveObserver(element: Element, isIntersecting: boolean): void {
  const state = observerFor(element);
  act(() => {
    state.callback(
      [
        {
          target: element,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

/** Drives the fake start (top boundary) observer for a page's sentinel. */
function setStartIntersecting(index: number, isIntersecting: boolean): void {
  const sentinel = container.querySelector(`[data-scroll-start="${index}"]`);
  if (!sentinel) {
    throw new Error(`No start sentinel for page ${index}`);
  }
  driveObserver(sentinel, isIntersecting);
}

/** Drives the fake end observer for a page's sentinel. */
function setEndIntersecting(index: number, isIntersecting: boolean): void {
  const sentinel = container.querySelector(`[data-scroll-end="${index}"]`);
  if (!sentinel) {
    throw new Error(`No end sentinel for page ${index}`);
  }
  driveObserver(sentinel, isIntersecting);
}

function previousButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')).filter((button) =>
    button.textContent?.trim().startsWith('Previous page'),
  );
}

function nextButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')).filter((button) =>
    button.textContent?.trim().startsWith('Continue to next page'),
  );
}

/**
 * Any internal scroll wrapper the player must never render now that scrolling
 * belongs to the document itself.
 */
function scrollWrappers(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.overflow-y-auto'),
  );
}

/** Indices of the mounted scenes; at most one is ever present. */
function sceneIndices(): number[] {
  return Array.from(container.querySelectorAll('[data-scene-index]'), (node) =>
    Number(node.getAttribute('data-scene-index')),
  );
}

function plainPage(index: number): PageNode {
  return {
    type: 'page',
    id: `page:plain-${index}.mdx`,
    source: `plain-${index}.mdx`,
    metadata: { title: `Plain ${index}` },
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: `Body ${index}.` }],
      },
    ],
  };
}

/** A questionnaire whose single question id is shared across pages. */
function sharedQuestionnaire(source: string): QuestionnaireNode {
  return {
    type: 'questionnaire',
    id: `questionnaire:${source}`,
    questions: [
      {
        type: 'question',
        id: 'question:shared',
        questionType: 'single-choice',
        prompt: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Shared prompt' }],
          },
        ],
        options: [
          {
            value: 'yes',
            correct: true,
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Yes' }],
              },
            ],
          },
          {
            value: 'no',
            correct: false,
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'No' }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function sharedPage(pageId: string, source: string, title: string): PageNode {
  return {
    type: 'page',
    id: pageId,
    source,
    metadata: { title },
    content: [sharedQuestionnaire(source)],
  };
}

const gatedPackage: ContentPackage = {
  metadata: { title: 'Gated package' },
  presentation: { type: 'scroll', pages: [introPage, setupPage] },
};

const plainTwoPagePackage: ContentPackage = {
  metadata: { title: 'Plain two pages' },
  presentation: { type: 'scroll', pages: [plainPage(1), plainPage(2)] },
};

const plainOnePagePackage: ContentPackage = {
  metadata: { title: 'Plain one page' },
  presentation: { type: 'scroll', pages: [plainPage(1)] },
};

const progressPackage: ContentPackage = {
  metadata: { title: 'Progress' },
  presentation: {
    type: 'scroll',
    pages: [plainPage(1), plainPage(2), plainPage(3), plainPage(4)],
  },
};

const sharedQuestionPackage: ContentPackage = {
  metadata: { title: 'Shared question' },
  presentation: {
    type: 'scroll',
    pages: [
      sharedPage('page:a.mdx', 'a.mdx', 'Page A'),
      sharedPage('page:b.mdx', 'b.mdx', 'Page B'),
    ],
  },
};

const gridQuizItem: ItemNode = {
  type: 'item',
  id: 'item:quiz.mdx',
  source: 'quiz.mdx',
  metadata: { title: 'Quiz' },
  content: [sharedQuestionnaire('quiz.mdx')],
};

const gridQuizPackage: ContentPackage = {
  metadata: { title: 'Grid quiz' },
  presentation: { type: 'grid', items: [gridQuizItem] },
};

const gridHeadingItem: ItemNode = {
  type: 'item',
  id: 'item:headings.mdx',
  source: 'headings.mdx',
  metadata: { title: 'Headings' },
  content: headingDepths,
};

const gridHeadingPackage: ContentPackage = {
  metadata: { title: 'Grid headings' },
  presentation: { type: 'grid', items: [gridHeadingItem] },
};

describe('PackageView scroll interactions', () => {
  it('renders only the first page, without previous/next page controls', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />));

    expect(sceneIndices()).toEqual([0]);
    // Only the displayed page's authored body is present. The metadata title is
    // exposed as the scene's accessible name, never injected as visible text.
    expect(text()).toContain('Welcome');
    expect(text()).not.toContain('Setup instructions.');
    expect(previousButtons()).toHaveLength(0);
    expect(nextButtons()).toHaveLength(0);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('does not mark every page complete at mount', () => {
    const markCompleted = vi.fn();
    window.scormBridge = { markCompleted };

    act(() => root.render(<Player contentPackage={gatedPackage} />));
    expect(markCompleted).not.toHaveBeenCalled();
  });

  it('works without any SCORM bridge', () => {
    expect(window.scormBridge).toBeUndefined();
    act(() => root.render(<Player contentPackage={gatedPackage} />));
    expect(text()).toContain('Welcome');
  });

  it('inverts the page content prose colors in dark mode', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />));

    const scene = container.querySelector<HTMLElement>(
      '[data-scene-index="0"]',
    );
    const prose = scene?.querySelector<HTMLElement>('.prose');
    expect(prose).not.toBeNull();
    // Light mode keeps the stone palette...
    expect(prose?.classList.contains('prose-stone')).toBe(true);
    // ...and dark mode inverts it, so typography colors do not stay in the
    // light palette when the surrounding theme is dark.
    expect(prose?.classList.contains('dark:prose-invert')).toBe(true);
  });

  it('completes a questionnaire-free page at its end', () => {
    const markCompleted = vi.fn();
    window.scormBridge = { markCompleted };

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    expect(markCompleted).not.toHaveBeenCalled();

    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());
    setEndIntersecting(1, true);

    expect(markCompleted).toHaveBeenCalledTimes(1);
  });

  it('marks the first page visited and stores it as the location on mount', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    expect(saveState).toHaveBeenCalledTimes(1);
    expect(lastSaved(saveState)).toEqual({
      location: 'page:plain-1.mdx',
      pages: { 'page:plain-1.mdx': { visited: true } },
    });
    // A visited-but-not-completed scroll page contributes no package progress.
    expect(lastProgress(saveState)).toBe(0);
    expect(Number.isInteger(lastProgress(saveState))).toBe(true);
  });

  it('does not re-save a restored page that is already visited', () => {
    const saveState = vi.fn();
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-2.mdx',
        pages: { 'page:plain-2.mdx': { visited: true } },
      }),
      saveState,
    };

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    expect(sceneIndices()).toEqual([1]);
    expect(saveState).not.toHaveBeenCalled();
  });
});

describe('PackageView scroll completion gating', () => {
  it('keeps the next control hidden at the page end until questionnaires submit', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />));

    setEndIntersecting(0, true);
    expect(nextButtons()).toHaveLength(0);

    answerQuestionnaire();
    expect(nextButtons()).toHaveLength(1);
  });

  it('waits for the page end when the questionnaire is submitted first', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />));

    answerQuestionnaire();
    expect(nextButtons()).toHaveLength(0);

    setEndIntersecting(0, true);
    expect(nextButtons()).toHaveLength(1);
  });

  it('completes a page only at its end with every questionnaire submitted', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={gatedPackage} />));
    const afterMount = saveState.mock.calls.length;

    setEndIntersecting(0, true);
    // Reaching the end is not enough: the questionnaire is still unanswered.
    expect(saveState.mock.calls.length).toBe(afterMount);

    answerQuestionnaire();
    expect(lastSaved(saveState).pages['page:intro.mdx']?.completed).toBe(true);
  });

  it('never renders a completion banner or progress UI', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />));
    setEndIntersecting(0, true);

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text()).not.toContain('Package complete');
  });
});

describe('PackageView scroll navigation controls', () => {
  it('keeps the next control hidden until the page end is reached', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    expect(container.querySelector('[data-scroll-end]')).not.toBeNull();
    expect(nextButtons()).toHaveLength(0);
  });

  it('shows the next control at the page end when another page follows', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);

    const buttons = nextButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('type')).toBe('button');
  });

  it('hides the next control after scrolling forward past the page end', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);
    expect(nextButtons()).toHaveLength(1);

    setEndIntersecting(0, false);
    expect(nextButtons()).toHaveLength(0);
  });

  it('advances to the next page and hides the previous content', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);

    act(() => nextButtons()[0]?.click());

    expect(sceneIndices()).toEqual([1]);
    expect(text()).toContain('Body 2.');
    expect(text()).not.toContain('Body 1.');
    // The new page opens at its top, so only the previous control is offered.
    expect(previousButtons()).toHaveLength(1);
    expect(nextButtons()).toHaveLength(0);
  });

  it('never shows a previous control on the first page', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    expect(container.querySelector('[data-scroll-start]')).toBeNull();
    expect(previousButtons()).toHaveLength(0);
  });

  it('keeps the previous control a fixed, clickable overlay above the page', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());

    const control = container.querySelector<HTMLElement>(
      '[data-scroll-previous]',
    );
    const scene = container.querySelector<HTMLElement>(
      '[data-scene-index="1"]',
    );
    if (!control || !scene) {
      throw new Error('Previous control or page scene not found');
    }

    // The control floats over the viewport, ahead of the scene in document
    // order, instead of occupying page flow, so the page never shifts when the
    // control appears or disappears.
    expect(control.classList.contains('fixed')).toBe(true);
    expect(container.contains(control)).toBe(true);
    expect(
      control.compareDocumentPosition(scene) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The wrapper ignores pointer events so it never blocks the page beneath it,
    // while the button itself stays operable.
    expect(control.classList.contains('pointer-events-none')).toBe(true);
    const button = previousButtons()[0];
    expect(button).toBeDefined();
    expect(button?.className).toContain('pointer-events-auto');
  });

  it('returns to the previous page when the previous control is activated', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());

    act(() => previousButtons()[0]?.click());

    expect(sceneIndices()).toEqual([0]);
    expect(text()).toContain('Body 1.');
    expect(text()).not.toContain('Body 2.');
    expect(previousButtons()).toHaveLength(0);
  });

  it('never shows a next control on the final page', () => {
    act(() => root.render(<Player contentPackage={plainOnePagePackage} />));

    setEndIntersecting(0, true);
    expect(nextButtons()).toHaveLength(0);
  });

  it('never shows a next control on the last page of a multi-page package', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());

    setEndIntersecting(1, true);
    expect(nextButtons()).toHaveLength(0);
  });

  it('resets the document scroll to the top when the page changes', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    // The initial page also opens at the top.
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });

    vi.mocked(window.scrollTo).mockClear();
    setEndIntersecting(0, true);

    act(() => nextButtons()[0]?.click());

    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('shows both controls when short content exposes both boundaries', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />));
    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());

    // The middle page is short: its top and end sentinels are both in view.
    setStartIntersecting(1, true);
    setEndIntersecting(1, true);

    expect(previousButtons()).toHaveLength(1);
    expect(nextButtons()).toHaveLength(1);
  });

  it('centres each control without spanning the viewport or covering the scrollbar', () => {
    act(() => root.render(<Player contentPackage={progressPackage} />));
    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());

    // The middle page is short: its top and end sentinels are both in view, so
    // both controls render and can be inspected together.
    setStartIntersecting(1, true);
    setEndIntersecting(1, true);

    const wrappers = [
      container.querySelector<HTMLElement>('[data-scroll-previous]'),
      container.querySelector<HTMLElement>('[data-scroll-next]'),
    ];
    for (const wrapper of wrappers) {
      if (!wrapper) {
        throw new Error('Expected both scroll controls to be visible');
      }

      // Pinned and centred, but shrink-wrapped to the button: it must never
      // span the viewport (`inset-x-0`/full width) or cover the scrollbar.
      expect(wrapper.classList.contains('fixed')).toBe(true);
      expect(wrapper.classList.contains('left-1/2')).toBe(true);
      expect(wrapper.classList.contains('-translate-x-1/2')).toBe(true);
      expect(wrapper.classList.contains('inset-x-0')).toBe(false);
      expect(wrapper.classList.contains('left-0')).toBe(false);
      expect(wrapper.classList.contains('right-0')).toBe(false);
      expect(wrapper.classList.contains('w-full')).toBe(false);
      expect(wrapper.classList.contains('flex')).toBe(false);

      // The translucent background and backdrop blur are applied to the narrow
      // wrapper itself, so they stay confined to the centred button and cannot
      // paint over the scrollbar.
      expect(wrapper.className).toContain('bg-background/5');
      expect(wrapper.className).toContain('backdrop-blur-sm');

      // The wrapper ignores pointer events while the button stays clickable.
      expect(wrapper.classList.contains('pointer-events-none')).toBe(true);
    }

    // Both buttons remain clickable and wired to navigation.
    expect(previousButtons()[0]?.className).toContain('pointer-events-auto');
    expect(nextButtons()[0]?.className).toContain('pointer-events-auto');

    act(() => nextButtons()[0]?.click());
    expect(sceneIndices()).toEqual([2]);
    act(() => previousButtons()[0]?.click());
    expect(sceneIndices()).toEqual([1]);
  });

  it('observes page boundaries against the viewport', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    const sentinel = container.querySelector('[data-scroll-end="0"]');
    expect(sentinel).not.toBeNull();
    // The document owns scrolling, so boundaries are measured against the
    // viewport (`root: null`) rather than an internal container.
    expect(observerFor(sentinel as Element).options?.root).toBeNull();
  });

  it('observes the page end with a non-negative bottom margin', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    const sentinel = container.querySelector('[data-scroll-end="0"]');
    expect(sentinel).not.toBeNull();

    const options = observerFor(sentinel as Element).options;
    // The end sentinel must remain reachable at the maximum scroll offset, so
    // the viewport root may not shrink its bottom edge.
    expect(options?.root).toBeNull();

    const [, , bottom = ''] = (options?.rootMargin ?? '').split(' ');
    const bottomMargin = Number.parseFloat(bottom);
    expect(Number.isNaN(bottomMargin)).toBe(false);
    expect(bottomMargin).toBeGreaterThanOrEqual(0);
  });

  it('disconnects page boundary observers when the page changes', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    const sentinel = container.querySelector('[data-scroll-end="0"]');
    expect(sentinel).not.toBeNull();
    const observer = observerFor(sentinel as Element);

    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());

    // The previous page's observer is torn down rather than left watching a
    // sentinel that is no longer mounted.
    expect(observer.elements.has(sentinel as Element)).toBe(false);
  });
});

describe('PackageView scroll viewport', () => {
  it('renders pages directly in the document without an internal scroll container', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    // Scrolling belongs to the document, so the player renders no viewport-sized
    // overflow container of its own (see the stylesheet rules covered in
    // scroll-viewport.test).
    expect(scrollWrappers()).toHaveLength(0);
    expect(container.querySelector('.overscroll-contain')).toBeNull();
    expect(container.querySelector('.h-dvh')).toBeNull();

    // The scene sits in the render container's natural flow.
    const scene = container.querySelector('[data-scene-index="0"]');
    expect(scene?.parentElement).toBe(container);
  });

  it('lays the page scene out in natural flow without vertical centering', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />));

    const scene = container.querySelector<HTMLElement>(
      '[data-scene-index="0"]',
    );
    if (!scene) {
      throw new Error('Page scene not found');
    }
    const classes = scene.classList;

    // Full-height, centred column with a readable measure.
    expect(classes.contains('min-h-dvh')).toBe(true);
    expect(classes.contains('w-full')).toBe(true);
    expect(classes.contains('max-w-3xl')).toBe(true);
    expect(classes.contains('mx-auto')).toBe(true);

    // Natural flow: the old flex column vertically centred the content.
    expect(classes.contains('flex')).toBe(false);
    expect(classes.contains('flex-col')).toBe(false);
    expect(classes.contains('justify-center')).toBe(false);

    // Intentional top/bottom padding reserves room for the fixed controls.
    expect(classes.contains('pt-20')).toBe(true);
    expect(classes.contains('pb-24')).toBe(true);
  });

  it('renders the authored page body and names the scene after the page', () => {
    act(() => root.render(<Player contentPackage={gatedPackage} />));

    const scene = container.querySelector<HTMLElement>(
      '[data-scene-index="0"]',
    );
    if (!scene) {
      throw new Error('Page scene not found');
    }

    // The page renders its authored body as-is. The metadata title is not
    // injected as a heading, so it can never duplicate an authored h1.
    expect(scene.textContent).toContain('Welcome');
    expect(scene.querySelector('h1')).toBeNull();

    // The scene keeps its accessible name in sync with the page metadata.
    expect(scene.getAttribute('aria-label')).toBe('Introduction');
  });

  it('resets the document scroll once for the initial page', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    // Opening the page resets the document scroll exactly once, and the reset is
    // instantaneous rather than a smooth animation from an old offset.
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('keeps the next control clickable above the viewport', () => {
    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);

    const button = nextButtons()[0];
    expect(button).toBeDefined();
    expect(button?.className).toContain('pointer-events-auto');
    expect(button?.parentElement?.classList.contains('fixed')).toBe(true);
    expect(
      button?.parentElement?.classList.contains('pointer-events-none'),
    ).toBe(true);
  });
});

describe('PackageView scroll location restore', () => {
  it('resumes on the saved page and offers the previous control', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-3.mdx',
        pages: { 'page:plain-3.mdx': { visited: true } },
      }),
    };

    act(() => root.render(<Player contentPackage={progressPackage} />));

    expect(sceneIndices()).toEqual([2]);
    expect(text()).toContain('Body 3.');
    expect(text()).not.toContain('Body 1.');
    // The restored page opens at its top: the document scroll is reset.
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(previousButtons()).toHaveLength(1);
    expect(nextButtons()).toHaveLength(0);
  });

  it('restores a page that is completed and completed-only gates the package', () => {
    const markCompleted = vi.fn();
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-2.mdx',
        pages: {
          'page:plain-1.mdx': { completed: true },
          'page:plain-2.mdx': { visited: true },
        },
      }),
      markCompleted,
    };

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));

    expect(sceneIndices()).toEqual([1]);
    expect(markCompleted).not.toHaveBeenCalled();

    // Reaching the end of the viewed page completes it and the package.
    setEndIntersecting(1, true);
    expect(markCompleted).toHaveBeenCalledTimes(1);
  });

  it('restores saved answers and submitted questionnaires read-only', () => {
    const saveState = vi.fn();
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:intro.mdx',
        pages: {
          'page:intro.mdx': {
            visited: true,
            answers: {
              'question:intro.mdx:1:1': 'first',
              'question:intro.mdx:1:2': ['alpha'],
            },
            submittedQuestionnaires: ['questionnaire:intro.mdx:1:1'],
          },
        },
      }),
      saveState,
    };

    act(() => root.render(<Player contentPackage={gatedPackage} />));

    // The restored submission renders read-only with both saved answers checked,
    // and counts as submitted, so reaching the page end completes it.
    expect(submittedControl('first').checked).toBe(true);
    expect(submittedControl('first').disabled).toBe(true);
    expect(submittedControl('alpha').checked).toBe(true);
    expect(submittedControl('alpha').disabled).toBe(true);
    expect(text()).not.toContain('Submit questionnaire');
    // Restoring an unchanged page must not write the bridge again.
    expect(saveState).not.toHaveBeenCalled();

    setEndIntersecting(0, true);
    expect(nextButtons()).toHaveLength(1);
  });

  it('resumes a completed page without re-answering its questionnaire', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:intro.mdx',
        pages: {
          'page:intro.mdx': {
            visited: true,
            completed: true,
            answers: { 'question:intro.mdx:1:1': 'first' },
          },
        },
      }),
    };

    act(() => root.render(<Player contentPackage={gatedPackage} />));

    // Completion is resumed from the state, not inferred from the location, and
    // a completed scroll page is normalized to submitted, so its questionnaire
    // is read-only and the learner can move on without re-answering.
    expect(submittedControl('first').disabled).toBe(true);
    expect(text()).not.toContain('Submit questionnaire');

    setEndIntersecting(0, true);
    expect(nextButtons()).toHaveLength(1);
  });

  it('drops an unknown saved location and starts on the first page', () => {
    window.scormBridge = {
      restoreState: () => ({ location: 'page:missing.mdx', pages: {} }),
    };

    act(() => root.render(<Player contentPackage={progressPackage} />));

    expect(sceneIndices()).toEqual([0]);
  });

  it('starts fresh when no resume reader is installed', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={progressPackage} />));

    expect(sceneIndices()).toEqual([0]);
    expect(lastSaved(saveState).location).toBe('page:plain-1.mdx');
  });

  it('restores the location once under StrictMode', () => {
    const saveState = vi.fn();
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:plain-2.mdx',
        pages: {},
      }),
      saveState,
    };

    act(() =>
      root.render(
        <StrictMode>
          <Player contentPackage={progressPackage} />
        </StrictMode>,
      ),
    );

    expect(sceneIndices()).toEqual([1]);
    // StrictMode's doubled mount must persist the restored page exactly once.
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(lastSaved(saveState)).toEqual({
      location: 'page:plain-2.mdx',
      pages: { 'page:plain-2.mdx': { visited: true } },
    });
  });
});

describe('PackageView scroll state persistence', () => {
  it('stores each answer under its page namespace', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={gatedPackage} />));
    act(() => input('first').click());

    expect(lastSaved(saveState).pages['page:intro.mdx']?.answers).toEqual({
      'question:intro.mdx:1:1': 'first',
    });
  });

  it('updates the location on next navigation and preserves page state', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());

    const saved = lastSaved(saveState);
    expect(saved.location).toBe('page:plain-2.mdx');
    expect(saved.pages['page:plain-1.mdx']).toEqual({
      visited: true,
      completed: true,
    });
    expect(saved.pages['page:plain-2.mdx']).toEqual({ visited: true });
    // One of two scroll pages is completed, so progress is 50.
    expect(lastProgress(saveState)).toBe(50);
  });

  it('passes integer package progress through the bridge as pages complete', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={progressPackage} />));
    setEndIntersecting(0, true);
    expect(lastProgress(saveState)).toBe(25);
    act(() => nextButtons()[0]?.click());
    setEndIntersecting(1, true);

    expect(lastProgress(saveState)).toBe(50);
    expect(Number.isInteger(lastProgress(saveState))).toBe(true);
  });

  it('updates the location on previous navigation without losing progress', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
    setEndIntersecting(0, true);
    act(() => nextButtons()[0]?.click());
    act(() => previousButtons()[0]?.click());

    const saved = lastSaved(saveState);
    expect(saved.location).toBe('page:plain-1.mdx');
    expect(saved.pages['page:plain-1.mdx']?.completed).toBe(true);
    expect(saved.pages['page:plain-2.mdx']?.visited).toBe(true);
  });

  it('keeps page-scoped answers for a question id reused across pages', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={sharedQuestionPackage} />));
    act(() => input('yes').click());
    setEndIntersecting(0, true);
    act(() => findButton('Submit questionnaire').click());
    act(() => nextButtons()[0]?.click());

    // Page B reuses the same question id but renders its own, unanswered state.
    expect(input('yes').checked).toBe(false);
    expect(input('no').checked).toBe(false);

    const saved = lastSaved(saveState);
    expect(saved.pages['page:a.mdx']?.answers).toEqual({
      'question:shared': 'yes',
    });
    expect(saved.pages['page:b.mdx']?.answers).toBeUndefined();
  });

  it('passes readable ids and answer values, never compact indices', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={gatedPackage} />));
    act(() => input('first').click());
    act(() => findButton('Next question').click());
    act(() => input('alpha').click());

    const saved = lastSaved(saveState);
    // The bridge receives the same readable, page-scoped state the components
    // use: stable question ids with authored option values, not page/question/
    // option indices and never a serialized suspend-data string.
    expect(saved.pages['page:intro.mdx']?.answers).toEqual({
      'question:intro.mdx:1:1': 'first',
      'question:intro.mdx:1:2': ['alpha'],
    });
    expect(JSON.stringify(saved)).not.toContain('suspend_data');
  });

  it('never calls the SCORM API directly', () => {
    const api = {
      LMSInitialize: vi.fn(() => 'true'),
      LMSGetValue: vi.fn(() => ''),
      LMSSetValue: vi.fn(() => 'true'),
      LMSCommit: vi.fn(() => 'true'),
      LMSFinish: vi.fn(() => 'true'),
    };
    (window as unknown as { API?: typeof api }).API = api;

    try {
      act(() => root.render(<Player contentPackage={plainTwoPagePackage} />));
      setEndIntersecting(0, true);
      expect(
        Object.values(api).every((method) => method.mock.calls.length === 0),
      ).toBe(true);
    } finally {
      delete (window as unknown as { API?: unknown }).API;
    }
  });
});

describe('PackageView grid interactions', () => {
  it('renders cards and opens the selected item in a dialog', () => {
    act(() => root.render(<Player contentPackage={gridPackage} />));

    expect(text()).toContain('Functions');
    expect(dialog()).toBeNull();

    act(() => findButton('Functions').click());
    expect(dialog()).not.toBeNull();
    expect(documentText()).toContain('Function body.');
  });

  it('wraps authored item content in prose typography', () => {
    act(() => root.render(<Player contentPackage={gridPackage} />));
    act(() => findButton('Functions').click());

    const prose = dialog()?.querySelector('.prose');
    expect(prose).not.toBeNull();
    expect(prose?.textContent).toContain('Function body.');
  });

  it('renders authored Markdown depths 1-6 as matching h1-h6 in the dialog', () => {
    act(() => root.render(<Player contentPackage={gridHeadingPackage} />));
    act(() => findButton('Headings').click());

    const content = dialog();
    expect(content).not.toBeNull();
    for (let level = 1; level <= 6; level += 1) {
      expect(content?.querySelector(`h${level}`)).not.toBeNull();
      expect(content?.textContent).toContain(`Level ${level}`);
    }
  });

  it('closes the dialog with the close button', () => {
    act(() => root.render(<Player contentPackage={gridPackage} />));
    act(() => findButton('Functions').click());
    expect(dialog()).not.toBeNull();

    const close = document.querySelector<HTMLButtonElement>(
      '[data-slot="dialog-close"]',
    );
    expect(close).not.toBeNull();
    act(() => close?.click());

    expect(dialog()).toBeNull();
    expect(documentText()).not.toContain('Function body.');
  });

  it('closes the dialog on Escape', () => {
    act(() => root.render(<Player contentPackage={gridPackage} />));
    act(() => findButton('Functions').click());
    expect(dialog()).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(dialog()).toBeNull();
  });

  it('stores the opened item as the location and marks it visited', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<Player contentPackage={gridPackage} />));
    act(() => findButton('Functions').click());

    expect(lastSaved(saveState)).toEqual({
      location: 'item:functions.mdx',
      pages: { 'item:functions.mdx': { visited: true } },
    });
    // Grid progress counts visited items: one of three.
    expect(lastProgress(saveState)).toBe(33);
  });

  it('reopens the saved item and restores its answers read-only', () => {
    window.scormBridge = {
      restoreState: () => ({
        location: 'item:quiz.mdx',
        pages: {
          'item:quiz.mdx': {
            visited: true,
            answers: { 'question:shared': 'no' },
            submittedQuestionnaires: ['questionnaire:quiz.mdx'],
          },
        },
      }),
    };

    act(() => root.render(<Player contentPackage={gridQuizPackage} />));

    expect(dialog()).not.toBeNull();
    expect(documentText()).toContain('Shared prompt');
    const no = submittedControl('no');
    expect(no.checked).toBe(true);
    expect(no.disabled).toBe(true);
  });

  it('completes once every item has been opened and notifies the bridge once', () => {
    const markCompleted = vi.fn();
    const finish = vi.fn();
    window.scormBridge = { markCompleted, finish };

    act(() => root.render(<Player contentPackage={gridPackage} />));
    expect(markCompleted).not.toHaveBeenCalled();

    act(() => findButton('Functions').click());
    const close = () =>
      document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
    act(() => close()?.click());
    act(() => findButton('Types').click());
    act(() => close()?.click());
    act(() => findButton('Extra details').click());

    expect(markCompleted).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('never renders a completion banner or progress UI', () => {
    act(() => root.render(<Player contentPackage={gridPackage} />));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text()).not.toContain('Package complete');
  });
});
