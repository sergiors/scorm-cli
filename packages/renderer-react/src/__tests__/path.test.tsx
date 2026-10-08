// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentRenderer } from '../../app/components/ContentRenderer';
import { PackageView } from '../../app/components/PackageView';
import { canOpenPathPage } from '../../app/components/PathView';
import { QuestionnaireView } from '../../app/components/QuestionnaireView';
import type {
  ContentNode,
  ContentPackage,
  PageNode,
  PathNode,
  PlayerPageState,
  PlayerState,
  QuestionnaireNode,
} from '../../app/types';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // PackageView resets the document scroll through `window.scrollTo` when a
  // page opens; jsdom does not implement it, so stub it to keep the run quiet.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.scormBridge;
  vi.restoreAllMocks();
});

function referencePage(
  id: string,
  title: string,
  description?: string,
): PageNode {
  return {
    type: 'page',
    id,
    source: id.replace(/^page:/, ''),
    metadata: description === undefined ? { title } : { title, description },
    content: [],
  };
}

const refIds = [
  'page:one.mdx',
  'page:two.mdx',
  'page:three.mdx',
  'page:four.mdx',
];

const pathNode: PathNode = { type: 'path', pageIds: refIds };

const refPages: PageNode[] = [
  referencePage('page:one.mdx', 'One', 'The first page'),
  referencePage('page:two.mdx', 'Two'),
  referencePage('page:three.mdx', 'Three'),
  referencePage('page:four.mdx', 'Four', 'The last page'),
];

interface PathContext {
  pathPages?: readonly PageNode[];
  pageStates?: Record<string, PlayerPageState>;
  onNavigatePathPage?: (pageId: string) => void;
}

function renderStatic(nodes: ContentNode[], context: PathContext = {}): string {
  return renderToStaticMarkup(<ContentRenderer nodes={nodes} {...context} />);
}

function host(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

function statuses(html: string): Array<string | null> {
  return Array.from(host(html).querySelectorAll('[data-path-status]'), (node) =>
    node.getAttribute('data-path-status'),
  );
}

function pageStatesFor(
  visited: readonly boolean[],
): Record<string, PlayerPageState> {
  const states: Record<string, PlayerPageState> = {};
  refIds.forEach((id, index) => {
    if (visited[index]) {
      states[id] = { visited: true };
    }
  });
  return states;
}

function sceneIndices(element: HTMLElement): number[] {
  return Array.from(element.querySelectorAll('[data-scene-index]'), (node) =>
    Number(node.getAttribute('data-scene-index')),
  );
}

function lastSaved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls;
  return calls[calls.length - 1]?.[0] as PlayerState;
}

describe('canOpenPathPage', () => {
  it('always opens the first entry', () => {
    expect(canOpenPathPage(0, [false, false, false, false])).toBe(true);
  });

  it('opens the entry after the visited prefix, blocking a skip ahead', () => {
    expect(canOpenPathPage(1, [true, false, false, false])).toBe(true);
    expect(canOpenPathPage(2, [true, false, false, false])).toBe(false);
    expect(canOpenPathPage(3, [true, true, false, false])).toBe(false);
  });

  it('keeps an already visited entry open regardless of the visited prefix', () => {
    expect(canOpenPathPage(2, [false, false, true, false])).toBe(true);
    expect(canOpenPathPage(1, [false, false, true, false])).toBe(false);
    expect(canOpenPathPage(3, [false, false, true, false])).toBe(true);
  });
});

describe('PathView status vectors', () => {
  const vectors: Array<[string, boolean[], string[]]> = [
    [
      '0000',
      [false, false, false, false],
      ['available', 'locked', 'locked', 'locked'],
    ],
    [
      '1000',
      [true, false, false, false],
      ['visited', 'available', 'locked', 'locked'],
    ],
    [
      '1100',
      [true, true, false, false],
      ['visited', 'visited', 'available', 'locked'],
    ],
    [
      '1110',
      [true, true, true, false],
      ['visited', 'visited', 'visited', 'available'],
    ],
  ];

  for (const [label, visited, expected] of vectors) {
    it(`marks ${label}`, () => {
      const html = renderStatic([pathNode], {
        pathPages: refPages,
        pageStates: pageStatesFor(visited),
        onNavigatePathPage: () => {},
      });
      expect(statuses(html)).toEqual(expected);
    });
  }

  it('walls off every entry after the first when nothing is visited', () => {
    const html = renderStatic([pathNode], {
      pathPages: refPages,
      pageStates: {},
      onNavigatePathPage: () => {},
    });
    const entries = Array.from(
      host(html).querySelectorAll<HTMLButtonElement>('[data-path-entry]'),
    );
    expect(entries).toHaveLength(4);
    expect(entries[0]?.disabled).toBe(false);
    for (const locked of entries.slice(1)) {
      expect(locked.disabled).toBe(true);
    }
  });
});

describe('PathView display metadata', () => {
  it('shows the resolved title and optional description', () => {
    const html = renderStatic([pathNode], {
      pathPages: refPages,
      pageStates: {},
      onNavigatePathPage: () => {},
    });
    const entries = Array.from(
      host(html).querySelectorAll('[data-path-entry]'),
    );

    expect(entries[0]?.textContent).toContain('One');
    expect(
      entries[0]?.querySelector('[data-path-description]')?.textContent,
    ).toBe('The first page');

    // A page without a description renders only its required title.
    expect(entries[1]?.textContent).toContain('Two');
    expect(entries[1]?.querySelector('[data-path-description]')).toBeNull();

    expect(entries[3]?.textContent).toContain('Four');
    expect(
      entries[3]?.querySelector('[data-path-description]')?.textContent,
    ).toBe('The last page');
  });

  it('falls back to the reference id when a page cannot be resolved', () => {
    const html = renderStatic([pathNode], {
      pathPages: [],
      pageStates: {},
      onNavigatePathPage: () => {},
    });
    expect(host(html).textContent).toContain('page:one.mdx');
  });
});

describe('PathView navigation', () => {
  function entries(): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-path-entry]'),
    );
  }

  it('navigates from available and visited entries', () => {
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <ContentRenderer
          nodes={[pathNode]}
          pathPages={refPages}
          pageStates={{ 'page:one.mdx': { visited: true } }}
          onNavigatePathPage={onNavigate}
        />,
      ),
    );

    // one is visited, two is available (previous is visited), three/four locked.
    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual([
      'visited',
      'available',
      'locked',
      'locked',
    ]);

    act(() => entries()[0]?.click());
    expect(onNavigate).toHaveBeenLastCalledWith('page:one.mdx');

    act(() => entries()[1]?.click());
    expect(onNavigate).toHaveBeenLastCalledWith('page:two.mdx');
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('renders locked entries visible but inert', () => {
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <ContentRenderer
          nodes={[pathNode]}
          pathPages={refPages}
          pageStates={{}}
          onNavigatePathPage={onNavigate}
        />,
      ),
    );

    const locked = entries()[1]!;
    expect(locked.disabled).toBe(true);
    expect(locked.textContent).toContain('Locked');
    // The entry is still part of the list.
    expect(entries()).toHaveLength(4);

    act(() => locked.click());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders inert without a page-switching callback', () => {
    act(() =>
      root.render(
        <ContentRenderer
          nodes={[pathNode]}
          pathPages={refPages}
          pageStates={{}}
        />,
      ),
    );

    const first = entries()[0]!;
    expect(first.dataset.pathStatus).toBe('available');
    expect(first.disabled).toBe(true);
  });
});

describe('QuestionnaireView nested Path', () => {
  const nestedQuestionnaire: QuestionnaireNode = {
    type: 'questionnaire',
    id: 'questionnaire:nested.mdx:1:1',
    questions: [
      {
        type: 'question',
        id: 'question:nested.mdx:1:1',
        questionType: 'single-choice',
        prompt: [pathNode],
        options: [
          { value: 'yes', correct: true, content: [pathNode] },
          { value: 'no', correct: false, content: [pathNode] },
        ],
      },
    ],
  };

  function pathEntries(): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-path-entry]'),
    );
  }

  it('resolves reference status and navigation in prompt and option content', () => {
    const onNavigate = vi.fn();
    act(() =>
      root.render(
        <QuestionnaireView
          node={nestedQuestionnaire}
          pathPages={refPages}
          pageStates={{ 'page:one.mdx': { visited: true } }}
          onNavigatePathPage={onNavigate}
        />,
      ),
    );

    // The Path authored in the active prompt and in each option resolves its
    // references through the questionnaire's forwarded context: titles come
    // from the root pages, statuses from the persisted page state.
    const all = pathEntries();
    expect(all).toHaveLength(12);

    const prompt = all.slice(0, 4);
    expect(prompt[0]?.textContent).toContain('One');
    expect(prompt.map((entry) => entry.dataset.pathStatus)).toEqual([
      'visited',
      'available',
      'locked',
      'locked',
    ]);

    const firstOption = all.slice(4, 8);
    expect(firstOption[0]?.textContent).toContain('One');
    expect(firstOption.map((entry) => entry.dataset.pathStatus)).toEqual([
      'visited',
      'available',
      'locked',
      'locked',
    ]);

    // Navigation is forwarded to the presentation's page switching.
    act(() => prompt[0]?.click());
    expect(onNavigate).toHaveBeenCalledWith('page:one.mdx');
  });

  it('resolves reference status in submitted rendering', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={nestedQuestionnaire}
          submitted
          pathPages={refPages}
          pageStates={{
            'page:one.mdx': { visited: true },
            'page:two.mdx': { visited: true },
          }}
          onNavigatePathPage={() => {}}
        />,
      ),
    );

    // Submitted rendering shows every question at once; the nested Paths still
    // resolve their references and visited status from the same context.
    const all = pathEntries();
    expect(all).toHaveLength(12);
    expect(all[0]?.textContent).toContain('One');
    expect(all.slice(0, 4).map((entry) => entry.dataset.pathStatus)).toEqual([
      'visited',
      'visited',
      'available',
      'locked',
    ]);
  });
});

describe('PackageView Path navigation', () => {
  const gateway: PageNode = {
    type: 'page',
    id: 'page:gateway.mdx',
    source: 'gateway.mdx',
    metadata: { title: 'Gateway' },
    content: [{ type: 'path', pageIds: ['page:target.mdx', 'page:later.mdx'] }],
  };
  const target: PageNode = {
    type: 'page',
    id: 'page:target.mdx',
    source: 'target.mdx',
    metadata: { title: 'Target', description: 'Read me' },
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Target body.' }],
      },
    ],
  };
  const later: PageNode = {
    type: 'page',
    id: 'page:later.mdx',
    source: 'later.mdx',
    metadata: { title: 'Later' },
    content: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Later body.' }] },
    ],
  };
  const contentPackage: ContentPackage = {
    metadata: { title: 'Path package' },
    presentation: { type: 'scroll', pages: [gateway, target, later] },
  };

  function entries(): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-path-entry]'),
    );
  }

  it('switches pages without mounting a duplicate and reuses visited state', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<PackageView contentPackage={contentPackage} />));

    // Only the gateway is mounted; its Path offers the first reference and locks
    // the rest.
    expect(sceneIndices(container)).toEqual([0]);
    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual([
      'available',
      'locked',
    ]);

    // A locked entry cannot move the presentation.
    act(() => entries()[1]?.click());
    expect(sceneIndices(container)).toEqual([0]);

    // Opening the available reference switches through the existing page view
    // and mounts exactly one scene.
    act(() => entries()[0]?.click());
    expect(sceneIndices(container)).toEqual([1]);
    expect(container.querySelectorAll('[data-scene-index]')).toHaveLength(1);
    expect(container.textContent).toContain('Target body.');

    const saved = lastSaved(saveState);
    // Navigation reuses the existing per-page visited flag and adds nothing.
    expect(saved.pages['page:target.mdx']).toEqual({ visited: true });
    expect(Object.keys(saved).sort()).toEqual(['location', 'pages']);
    expect(JSON.stringify(saved)).not.toContain('suspend_data');
  });

  it('reopens visited entries and unlocks the next one', () => {
    const saveState = vi.fn();
    window.scormBridge = { saveState };

    act(() => root.render(<PackageView contentPackage={contentPackage} />));
    act(() => entries()[0]?.click());
    expect(sceneIndices(container)).toEqual([1]);

    // Return to the gateway through the existing previous control.
    const previous = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.includes('Previous page'));
    act(() => previous?.click());
    expect(sceneIndices(container)).toEqual([0]);

    // The visited reference stays open and unlocks the entry after it.
    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual([
      'visited',
      'available',
    ]);

    act(() => entries()[1]?.click());
    expect(sceneIndices(container)).toEqual([2]);
    expect(container.textContent).toContain('Later body.');
    expect(lastSaved(saveState).pages['page:later.mdx']).toEqual({
      visited: true,
    });
  });
});
