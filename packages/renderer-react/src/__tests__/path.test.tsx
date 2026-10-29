// @vitest-environment jsdom
import { act, useMemo, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentRenderer as ContentRendererBase } from '../../app/components/ContentRenderer'
import { Presentation as PresentationBase } from '../../app/components/Presentation'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import type { ContentProvider } from '../../app/lib/content-loader'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type {
  ContentNode,
  ContentPackage,
  PageNode,
  PathNode,
  PlayerPageState,
  PlayerState
} from '../../app/types'
import { inlineContentProvider } from './fixtures'
import { virtuosoMock } from './virtuoso-mock'

// The scroll presentation is virtualized by React Virtuoso, which measures real
// DOM geometry. The suite drives the deterministic double instead.
vi.mock('react-virtuoso', () => import('./virtuoso-mock'))

/**
 * Wraps a player component in the i18n provider, matching how `PackageApp`
 * renders the tree. These tests render players directly, so they supply the
 * provider here; the wrappers keep every call site unchanged. `lang` selects
 * the catalog; without it the English default chrome renders.
 */
function ContentRenderer({
  lang,
  ...props
}: ComponentProps<typeof ContentRendererBase> & { lang?: string }) {
  return (
    <PlayerI18nProvider lang={lang}>
      <ContentRendererBase {...props} />
    </PlayerI18nProvider>
  )
}

/**
 * Wraps the presentation in the player's i18n and player providers, matching how
 * `PackageApp` renders the tree, and supplies the inline content provider the
 * build wires through `virtual:package-data`. Call sites that pass their own
 * provider (a lazy one) keep it.
 */
function Presentation({
  contentProvider,
  ...props
}: Omit<ComponentProps<typeof PresentationBase>, 'contentProvider'> & {
  contentProvider?: ContentProvider
}) {
  const provider = useMemo(
    () => contentProvider ?? inlineContentProvider(props.contentPackage),
    [contentProvider, props.contentPackage]
  )
  return (
    <PlayerI18nProvider lang={props.contentPackage.metadata.lang}>
      <PlayerProvider contentPackage={props.contentPackage}>
        <PresentationBase {...props} contentProvider={provider} />
      </PlayerProvider>
    </PlayerI18nProvider>
  )
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  virtuosoMock.reset()
  // Presentation resets the document scroll through `window.scrollTo` when a
  // page opens; jsdom does not implement it, so stub it to keep the run quiet.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete window.scormBridge
  vi.restoreAllMocks()
})

function referencePage(id: string, title: string, description?: string): PageNode {
  return {
    type: 'page',
    id,
    source: id.replace(/^page:/, ''),
    metadata: description === undefined ? { title } : { title, description },
    content: []
  }
}

const refIds = ['page:one.mdx', 'page:two.mdx', 'page:three.mdx', 'page:four.mdx']

const pathNode: PathNode = { type: 'path', pageIds: refIds }

const refPages: PageNode[] = [
  referencePage('page:one.mdx', 'One', 'The first page'),
  referencePage('page:two.mdx', 'Two'),
  referencePage('page:three.mdx', 'Three'),
  referencePage('page:four.mdx', 'Four', 'The last page')
]

interface PathContext {
  pathPages?: readonly PageNode[]
  pageStates?: Record<string, PlayerPageState>
  onNavigatePathPage?: (pageId: string) => void
  /** Locale for the player chrome; defaults to the react-intl fallback. */
  lang?: string
}

function renderStatic(nodes: ContentNode[], context: PathContext = {}): string {
  const { pageStates = {}, lang, ...contentContext } = context
  window.scormBridge = { restoreState: () => ({ pages: pageStates }) }
  return renderToStaticMarkup(
    <PlayerProvider contentPackage={pathStatePackage}>
      <PageProvider pageId={refPages[0]!.id}>
        <ContentRenderer lang={lang} nodes={nodes} {...contentContext} />
      </PageProvider>
    </PlayerProvider>
  )
}

const pathStatePackage: ContentPackage = {
  metadata: { title: 'Path state' },
  presentation: { type: 'scroll', pages: refPages }
}

function StatefulContentRenderer({
  pageStates,
  ...props
}: ComponentProps<typeof ContentRendererBase> & {
  pageStates: Record<string, PlayerPageState>
}) {
  window.scormBridge = { restoreState: () => ({ pages: pageStates }) }
  return (
    <PlayerI18nProvider>
      <PlayerProvider contentPackage={pathStatePackage}>
        <PageProvider pageId={refPages[0]!.id}>
          <ContentRendererBase {...props} />
        </PageProvider>
      </PlayerProvider>
    </PlayerI18nProvider>
  )
}

function host(html: string): HTMLElement {
  const element = document.createElement('div')
  element.innerHTML = html
  return element
}

function statuses(html: string): Array<string | null> {
  return Array.from(host(html).querySelectorAll('[data-path-status]'), (node) =>
    node.getAttribute('data-path-status')
  )
}

/**
 * Builds page state for a contiguous "done" vector: a done page is both
 * visited and completed, which is exactly what the shared access policy reads
 * to unlock the next root page.
 */
function pageStatesFor(done: readonly boolean[]): Record<string, PlayerPageState> {
  const states: Record<string, PlayerPageState> = {}
  refIds.forEach((id, index) => {
    if (done[index]) {
      states[id] = { visited: true, completed: true }
    }
  })
  return states
}

function sceneIndices(element: HTMLElement): number[] {
  return Array.from(element.querySelectorAll('[data-scene-index]'), (node) =>
    Number(node.getAttribute('data-scene-index'))
  )
}

function lastSaved(saveState: { mock: { calls: unknown[][] } }): PlayerState {
  const calls = saveState.mock.calls
  return calls[calls.length - 1]?.[0] as PlayerState
}

describe('PathView status vectors', () => {
  const vectors: Array<[string, boolean[], string[]]> = [
    ['0000', [false, false, false, false], ['available', 'locked', 'locked', 'locked']],
    ['1000', [true, false, false, false], ['visited', 'available', 'locked', 'locked']],
    ['1100', [true, true, false, false], ['visited', 'visited', 'available', 'locked']],
    ['1110', [true, true, true, false], ['visited', 'visited', 'visited', 'available']],
    // A gap in the prefix locks every entry after the first, even a later
    // completed (and therefore visited) one: visited status alone never unlocks.
    ['0010', [false, false, true, false], ['available', 'locked', 'locked', 'locked']]
  ]

  for (const [label, visited, expected] of vectors) {
    it(`marks ${label}`, () => {
      const html = renderStatic([pathNode], {
        pathPages: refPages,
        pageStates: pageStatesFor(visited),
        onNavigatePathPage: () => {}
      })
      expect(statuses(html)).toEqual(expected)
    })
  }

  it('walls off every entry after the first when nothing is visited', () => {
    const html = renderStatic([pathNode], {
      pathPages: refPages,
      pageStates: {},
      onNavigatePathPage: () => {}
    })
    const entries = Array.from(host(html).querySelectorAll<HTMLButtonElement>('[data-path-entry]'))
    expect(entries).toHaveLength(4)
    expect(entries[0]?.disabled).toBe(false)
    for (const locked of entries.slice(1)) {
      expect(locked.disabled).toBe(true)
    }
  })
})

describe('PathView status affordances', () => {
  it('pairs each status with its own icon and localized label', () => {
    const html = renderStatic([pathNode], {
      pathPages: refPages,
      pageStates: { 'page:one.mdx': { visited: true, completed: true } },
      onNavigatePathPage: () => {}
    })
    const entries = Array.from(host(html).querySelectorAll('[data-path-entry]'))

    // The icon identifier lucide attaches, independent of the base/size classes.
    const iconName = (entry: Element) =>
      Array.from(entry.querySelector('svg')?.classList ?? []).find((name) =>
        name.startsWith('lucide-')
      )

    // visited=['one']: one is visited, two available, three/four locked.
    expect(entries.map(iconName)).toEqual([
      'lucide-check',
      'lucide-circle',
      'lucide-lock',
      'lucide-lock'
    ])
    expect(
      entries.map((entry) => entry.querySelector('[data-slot="item-actions"]')?.textContent)
    ).toEqual(['Visited', 'Available', 'Locked', 'Locked'])
  })

  it('localizes the pt-BR status labels from restored page state', () => {
    const html = renderStatic([pathNode], {
      pathPages: refPages,
      pageStates: { 'page:one.mdx': { visited: true, completed: true } },
      onNavigatePathPage: () => {},
      lang: 'pt-BR'
    })
    const entries = Array.from(host(html).querySelectorAll('[data-path-entry]'))

    expect(
      entries.map((entry) => entry.querySelector('[data-slot="item-actions"]')?.textContent)
    ).toEqual(['Visitada', 'Disponível', 'Bloqueada', 'Bloqueada'])
    // Authored copy passes through untouched, as in every locale.
    expect(entries[0]?.textContent).toContain('The first page')
  })
})

describe('PathView display metadata', () => {
  it('shows the resolved title and optional description', () => {
    const html = renderStatic([pathNode], {
      pathPages: refPages,
      pageStates: {},
      onNavigatePathPage: () => {}
    })
    const entries = Array.from(host(html).querySelectorAll('[data-path-entry]'))

    expect(entries[0]?.textContent).toContain('One')
    expect(entries[0]?.querySelector('[data-slot="item-description"]')?.textContent).toBe(
      'The first page'
    )

    // A page without a description renders only its required title.
    expect(entries[1]?.textContent).toContain('Two')
    expect(entries[1]?.querySelector('[data-slot="item-description"]')).toBeNull()

    expect(entries[3]?.textContent).toContain('Four')
    expect(entries[3]?.querySelector('[data-slot="item-description"]')?.textContent).toBe(
      'The last page'
    )
  })

  it('falls back to the reference id when a page cannot be resolved', () => {
    const html = renderStatic([pathNode], {
      pathPages: [],
      pageStates: {},
      onNavigatePathPage: () => {}
    })
    expect(host(html).textContent).toContain('page:one.mdx')
  })
})

describe('PathView navigation', () => {
  function entries(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-path-entry]'))
  }

  it('navigates from available and visited entries', () => {
    const onNavigate = vi.fn()
    act(() =>
      root.render(
        <StatefulContentRenderer
          nodes={[pathNode]}
          pathPages={refPages}
          pageStates={{ 'page:one.mdx': { visited: true, completed: true } }}
          onNavigatePathPage={onNavigate}
        />
      )
    )

    // one is visited, two is available (previous is visited), three/four locked.
    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual([
      'visited',
      'available',
      'locked',
      'locked'
    ])

    act(() => entries()[0]?.click())
    expect(onNavigate).toHaveBeenLastCalledWith('page:one.mdx')

    act(() => entries()[1]?.click())
    expect(onNavigate).toHaveBeenLastCalledWith('page:two.mdx')
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it('renders locked entries visible but inert', () => {
    const onNavigate = vi.fn()
    act(() =>
      root.render(
        <StatefulContentRenderer
          nodes={[pathNode]}
          pathPages={refPages}
          pageStates={{}}
          onNavigatePathPage={onNavigate}
        />
      )
    )

    const locked = entries()[1]!
    expect(locked.disabled).toBe(true)
    expect(locked.textContent).toContain('Locked')
    // The entry is still part of the list.
    expect(entries()).toHaveLength(4)

    act(() => locked.click())
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('keeps a previously visited but now locked entry inert', () => {
    const onNavigate = vi.fn()
    act(() =>
      root.render(
        <StatefulContentRenderer
          nodes={[pathNode]}
          pathPages={refPages}
          // Page three is completed (and so visited), but page one is not done,
          // so the completed prefix stops at page one and page three is locked.
          pageStates={{ 'page:three.mdx': { visited: true, completed: true } }}
          onNavigatePathPage={onNavigate}
        />
      )
    )

    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual([
      'available',
      'locked',
      'locked',
      'locked'
    ])

    // Visited status must not make a locked page navigable.
    const visitedLocked = entries()[2]!
    expect(visitedLocked.disabled).toBe(true)
    act(() => visitedLocked.click())
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('renders inert without a page-switching callback', () => {
    act(() =>
      root.render(
        <StatefulContentRenderer nodes={[pathNode]} pathPages={refPages} pageStates={{}} />
      )
    )

    const first = entries()[0]!
    expect(first.dataset.pathStatus).toBe('available')
    expect(first.disabled).toBe(true)
  })
})

describe('Presentation Path navigation', () => {
  const gateway: PageNode = {
    type: 'page',
    id: 'page:gateway.mdx',
    source: 'gateway.mdx',
    metadata: { title: 'Gateway' },
    content: [{ type: 'path', pageIds: ['page:target.mdx', 'page:later.mdx'] }]
  }
  const target: PageNode = {
    type: 'page',
    id: 'page:target.mdx',
    source: 'target.mdx',
    metadata: { title: 'Target', description: 'Read me' },
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Target body.' }]
      }
    ]
  }
  const later: PageNode = {
    type: 'page',
    id: 'page:later.mdx',
    source: 'later.mdx',
    metadata: { title: 'Later' },
    content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Later body.' }] }]
  }
  const contentPackage: ContentPackage = {
    metadata: { title: 'Path package' },
    presentation: { type: 'scroll', pages: [gateway, target, later] }
  }

  function entries(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-path-entry]'))
  }

  it('opens an accessible reference through the shared progression and reuses visited state', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:gateway.mdx',
        pages: { 'page:gateway.mdx': { visited: true, completed: true } }
      }),
      saveState
    }

    act(() => root.render(<Presentation contentPackage={contentPackage} />))

    // The gateway is complete, so its Path offers the first reference and locks
    // the rest.
    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual(['available', 'locked'])

    // A locked entry cannot move the presentation.
    act(() => entries()[1]?.click())
    expect(lastSaved(saveState)).toBeUndefined()
    expect(virtuosoMock.scrollToIndexCalls).toHaveLength(0)

    // Opening the available reference jumps straight to it through the
    // virtualizer, which then renders the target and stores it as the location,
    // adding only its visited flag.
    act(() => entries()[0]?.click())
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 1, align: 'start', behavior: 'auto' }
    ])
    const saved = lastSaved(saveState)
    expect(saved.location).toBe('page:target.mdx')
    expect(saved.pages['page:target.mdx']).toEqual({ visited: true })
    expect(Object.keys(saved).sort()).toEqual(['location', 'pages'])
    expect(JSON.stringify(saved)).not.toContain('suspend_data')
  })

  it('reopens a visited reference and unlocks the next one', () => {
    const saveState = vi.fn()
    window.scormBridge = {
      restoreState: () => ({
        location: 'page:gateway.mdx',
        pages: {
          'page:gateway.mdx': { visited: true, completed: true },
          'page:target.mdx': { visited: true, completed: true }
        }
      }),
      saveState
    }

    act(() => root.render(<Presentation contentPackage={contentPackage} />))

    // The visited reference stays open and unlocks the entry after it.
    expect(entries().map((entry) => entry.dataset.pathStatus)).toEqual(['visited', 'available'])

    act(() => entries()[1]?.click())
    expect(virtuosoMock.scrollToIndexCalls).toEqual([
      { index: 2, align: 'start', behavior: 'auto' }
    ])
    expect(lastSaved(saveState).location).toBe('page:later.mdx')
    expect(lastSaved(saveState).pages['page:later.mdx']).toEqual({ visited: true })
  })
})
