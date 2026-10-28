// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentRenderer } from '../../app/components/ContentRenderer'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type {
  AccordionItemNode,
  ContentNode,
  ContentPackage,
  InlineNode,
  PlayerState
} from '../../app/types'
import { singleChoiceQuestion } from './fixtures'

const text = (value: string): InlineNode => ({ type: 'text', value })

const section = (title: string, body: string, defaultOpen = false): AccordionItemNode => ({
  type: 'accordionItem',
  defaultOpen,
  title: [text(title)],
  content: [{ type: 'paragraph', children: [text(body)] }]
})

const accordion = (
  items: AccordionItemNode[],
  flags:
    Partial<Pick<AccordionItemNode, never>> | { multiple?: boolean; collapsible?: boolean } = {}
): ContentNode => ({
  type: 'accordion',
  multiple: false,
  collapsible: false,
  items,
  ...flags
})

function contentPackage(nodes: ContentNode[]): ContentPackage {
  return {
    metadata: { title: 'Accordion test' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page:accordion-test.mdx',
          source: 'accordion-test.mdx',
          metadata: { title: 'Accordion test' },
          content: nodes
        }
      ]
    }
  }
}

/**
 * Renders the player contexts around a page whose authored content is `nodes`,
 * mirroring `content.test.tsx`; every bridge method stays an uninstalled stub so
 * a purely visual change can never reach the SCORM runtime.
 */
function render(nodes: ContentNode[]): string {
  window.scormBridge = { restoreState: () => ({ pages: {} }) }
  return renderToStaticMarkup(
    <PlayerI18nProvider>
      <PlayerProvider contentPackage={contentPackage(nodes)}>
        <PageProvider pageId="page:accordion-test.mdx">
          <ContentRenderer nodes={nodes} />
        </PageProvider>
      </PlayerProvider>
    </PlayerI18nProvider>
  )
}

interface BridgeSpies {
  restoreState: ReturnType<typeof vi.fn<() => PlayerState | undefined>>
  saveState: ReturnType<typeof vi.fn>
  setScore: ReturnType<typeof vi.fn>
  markCompleted: ReturnType<typeof vi.fn>
  finish: ReturnType<typeof vi.fn>
  calls(): { completed: number; finish: number; save: number; score: number }
}

function spyBridge(): BridgeSpies {
  const restoreState = vi.fn<() => PlayerState | undefined>(() => ({ pages: {} }))
  const saveState = vi.fn<(state: PlayerState, progress: number) => void>(() => {})
  const setScore = vi.fn<(score: { earned: number; possible: number } | undefined) => void>()
  const markCompleted = vi.fn<() => void>(() => {})
  const finish = vi.fn<() => void>(() => {})
  const bridge: BridgeSpies = {
    restoreState,
    saveState,
    setScore,
    markCompleted,
    finish
  } as unknown as BridgeSpies
  bridge.calls = () => ({
    completed: markCompleted.mock.calls.length,
    finish: finish.mock.calls.length,
    save: saveState.mock.calls.length,
    score: setScore.mock.calls.length
  })
  window.scormBridge = bridge as unknown as typeof window.scormBridge
  return bridge
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete window.scormBridge
})

function mount(nodes: ContentNode[]): void {
  act(() => {
    root.render(
      <PlayerI18nProvider>
        <PlayerProvider contentPackage={contentPackage(nodes)}>
          <PageProvider pageId="page:accordion-test.mdx">
            <ContentRenderer nodes={nodes} />
          </PageProvider>
        </PlayerProvider>
      </PlayerI18nProvider>
    )
  })
}

function triggers(): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-slot="accordion-trigger"]')
  )
}

/** Trigger `aria-expanded` per section, and how many bodies are visibly open. */
function openStates(): { expanded: boolean[]; openBodies: number } {
  return {
    expanded: triggers().map((trigger) => trigger.getAttribute('aria-expanded') === 'true'),
    openBodies: container.querySelectorAll('[data-slot="accordion-content"][data-state="open"]')
      .length
  }
}

function click(trigger: HTMLButtonElement): void {
  act(() => {
    trigger.click()
  })
}

function pressKey(trigger: HTMLButtonElement, key: string): void {
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('accordion presentation structure', () => {
  it('renders the radix luma accordion data-slots around semantic trigger buttons', () => {
    const html = render([
      accordion([section('First', 'First body'), section('Second', 'Second body')])
    ])

    expect(html).toContain('data-slot="accordion"')
    expect(html).toContain('data-orientation="vertical"')
    expect((html.match(/data-slot="accordion-item"/g) ?? []).length).toBe(2)
    // Each trigger is a real button inside a heading, not a styled div.
    expect((html.match(/data-slot="accordion-trigger"/g) ?? []).length).toBe(2)
    expect(html).toContain('<button')
    expect(html).toContain('<h3')
    // Closed sections stay collapsed: expanded is false and no body renders.
    expect((html.match(/aria-expanded="false"/g) ?? []).length).toBe(2)
    expect((html.match(/data-state="closed"/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(html).not.toContain('First body')
    expect(html).not.toContain('Second body')
    // Both chevrons are on every trigger.
    expect((html.match(/data-slot="accordion-trigger-icon"/g) ?? []).length).toBe(4)
  })

  it('renders authored titles through the inline content pipeline in the trigger', () => {
    const node: ContentNode = {
      type: 'accordion',
      multiple: false,
      collapsible: false,
      items: [
        {
          type: 'accordionItem',
          defaultOpen: false,
          title: [
            text('Styled '),
            { type: 'strong', children: [text('title')] },
            { type: 'inlineCode', value: 'code' }
          ],
          content: [section('ignored', 'ignored').content[0]!]
        }
      ]
    }
    const html = render([node])
    expect(html).toContain('Styled ')
    expect(html).toContain('<strong')
    expect(html).toContain('title')
    expect(html).toContain('<code')
  })

  it('exposes an open section as a labeled region with its trigger target', () => {
    const html = render([accordion([section('Open', 'Open body text', true)])])
    expect(html).toContain('aria-controls')
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-labelledby')
    expect(html).toContain('data-slot="accordion-content"')
    expect(html).toContain('<p')
    expect(html).toContain('Open body text')
  })
})

describe('accordion default open state', () => {
  it('opens only the authored defaultOpen section at first render', () => {
    const html = render([accordion([section('A', 'A body'), section('B', 'B body', true)])])
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBe(1)
    expect((html.match(/aria-expanded="false"/g) ?? []).length).toBe(1)
    expect(html).toContain('B body')
    expect(html).not.toContain('A body')
  })

  it('opens every defaultOpen section of a multiple accordion', () => {
    const html = render([
      accordion(
        [section('A', 'A body', true), section('B', 'B body'), section('C', 'C body', true)],
        {
          multiple: true
        }
      )
    ])
    expect((html.match(/aria-expanded="true"/g) ?? []).length).toBe(2)
    expect(html).toContain('A body')
    expect(html).toContain('C body')
    expect(html).not.toContain('B body')
  })

  it('starts a non-collapsible accordion with no defaults fully closed', () => {
    const html = render([accordion([section('A', 'A body'), section('B', 'B body')])])
    expect(html).not.toContain('aria-expanded="true"')
    expect(html).not.toContain('data-slot="accordion-content" data-state="open"')
    expect(html).not.toContain('A body')
  })
})

describe('accordion interaction semantics', () => {
  it('opens the clicked section and closes the previous one in single mode', () => {
    mount([accordion([section('A', 'A body'), section('B', 'B body', true)])])
    expect(openStates()).toEqual({ expanded: [false, true], openBodies: 1 })

    click(triggers()[0]!)
    expect(openStates()).toEqual({ expanded: [true, false], openBodies: 1 })
    expect(container.textContent).toContain('A body')
    expect(container.textContent).not.toContain('B body')
  })

  it('keeps the open section open after another click when not collapsible', () => {
    mount([accordion([section('A', 'A body')])])
    click(triggers()[0]!)
    expect(openStates().expanded).toEqual([true])

    click(triggers()[0]!)
    expect(openStates()).toEqual({ expanded: [true], openBodies: 1 })
  })

  it('lets the open section close again when the accordion is collapsible', () => {
    mount([accordion([section('A', 'A body')], { collapsible: true })])
    click(triggers()[0]!)
    expect(openStates().expanded).toEqual([true])

    click(triggers()[0]!)
    expect(openStates()).toEqual({ expanded: [false], openBodies: 0 })
  })

  it('keeps earlier sections open while opening another in multiple mode', () => {
    mount([accordion([section('A', 'A body'), section('B', 'B body')], { multiple: true })])
    click(triggers()[0]!)
    click(triggers()[1]!)
    expect(openStates()).toEqual({ expanded: [true, true], openBodies: 2 })

    // Toggling the second section closed leaves the first one untouched.
    click(triggers()[1]!)
    expect(openStates()).toEqual({ expanded: [true, false], openBodies: 1 })
  })

  it('moves trigger focus between sections with ArrowDown and Home keys', () => {
    mount([accordion([section('A', 'A body'), section('B', 'B body'), section('C', 'C body')])])
    const [first, second, third] = triggers()

    pressKey(first!, 'ArrowDown')
    expect(document.activeElement).toBe(second)

    pressKey(second!, 'ArrowDown')
    expect(document.activeElement).toBe(third)

    pressKey(third!, 'Home')
    expect(document.activeElement).toBe(first)
  })
})

describe('accordion player isolation', () => {
  it('toggles sections without any new player or SCORM write', () => {
    const bridge = spyBridge()
    mount([accordion([section('A', 'A body'), section('B', 'B body', true)])])

    // Restoring state reads the bridge once, and a fresh package persists
    // nothing. The session reports its aggregate score at mount from its own
    // effect, so only those baseline calls may exist before any interaction.
    expect(bridge.restoreState).toHaveBeenCalled()
    expect(bridge.calls()).toMatchObject({ completed: 0, finish: 0, save: 0 })
    const before = bridge.calls()

    click(triggers()[0]!)
    click(triggers()[1]!)
    click(triggers()[0]!)
    // The visual state really changed, so the unchanged writes are meaningful:
    // an open accordion stays presentation-only player state.
    expect(openStates().expanded).toEqual([true, false])
    expect(bridge.calls()).toEqual(before)
  })
})

describe('accordion nested integrations', () => {
  it('hosts a questionnaire and a video inside an open section body', () => {
    const node: ContentNode = {
      type: 'accordion',
      multiple: false,
      collapsible: false,
      items: [
        {
          type: 'accordionItem',
          defaultOpen: true,
          title: [text('Deep dive')],
          content: [
            {
              type: 'questionnaire',
              id: 'questionnaire:acc.mdx:1:1',
              contributesToScore: true,
              revealCorrectAnswers: true,
              maxAttempts: 1,
              shuffleOptions: false,
              questions: [singleChoiceQuestion]
            },
            { type: 'video', id: 'video:acc.mdx:2:1', provider: 'native', src: './v.mp4' }
          ]
        }
      ]
    }
    const html = render([node])

    expect(html).toContain('data-slot="accordion-content"')
    // The questionnaire keeps its whole interactive surface inside the body.
    expect(html).toContain('data-slot="questionnaire"')
    expect(html).toContain('Which option is correct?')
    // The video keeps its shared media frame and lazy player binding.
    expect(html).toContain('data-slot="media-frame"')
    expect(html).toContain('data-testid="react-player"')
    expect(html).toContain('./v.mp4')
  })

  it('mounts a closed section body only after opening it', () => {
    mount([accordion([section('A', 'A body'), section('B', 'B body')])])
    expect(container.textContent).not.toContain('B body')

    click(triggers()[1]!)
    expect(container.textContent).toContain('B body')
    expect(container.querySelector('[data-slot="accordion-content"] p')).toBeTruthy()
  })
})
