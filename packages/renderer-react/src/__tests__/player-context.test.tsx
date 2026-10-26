// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PageProvider,
  PlayerProvider,
  usePageId,
  usePlayerActions,
  usePlayerState
} from '../../app/lib/player-context'
import type { ContentPackage } from '../../app/types'

const PAGE_ID = 'page:probe.mdx'

const probePackage: ContentPackage = {
  metadata: { title: 'Player context' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: PAGE_ID,
        source: 'probe.mdx',
        metadata: { title: 'Probe' },
        content: []
      }
    ]
  }
}

/** Renders the probe page's answers, so state updates are visible in the DOM. */
let stateRenders = 0
const StateProbe = () => {
  stateRenders += 1
  const state = usePlayerState()
  return <span data-probe="state">{JSON.stringify(state.pages[PAGE_ID]?.answers ?? null)}</span>
}

/** Dispatches one answer, so the test can act through the actions context. */
let actionRenders = 0
const ActionsProbe = () => {
  actionRenders += 1
  const actions = usePlayerActions()
  return <button onClick={() => actions.setAnswer(PAGE_ID, 'question:probe', 'a')}>answer</button>
}

/** Renders the owning page id, so ownership wiring is visible in the DOM. */
const PageIdProbe = () => {
  return <span data-probe="page-id">{usePageId() ?? 'none'}</span>
}

function answerButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button')
  if (!button) {
    throw new Error('Answer button not found')
  }
  return button
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  stateRenders = 0
  actionRenders = 0
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

describe('PlayerProvider split contexts', () => {
  it('makes a dispatched action visible to state consumers of the same session', () => {
    window.scormBridge = { saveState: vi.fn() }
    act(() =>
      root.render(
        <PlayerProvider contentPackage={probePackage}>
          <StateProbe />
          <ActionsProbe />
        </PlayerProvider>
      )
    )

    expect(document.querySelector('[data-probe="state"]')?.textContent).toBe('null')

    act(() => answerButton().click())

    // Dispatching through the actions context lands in the same session the
    // state context reads: the answer appears under the probe question id.
    expect(document.querySelector('[data-probe="state"]')?.textContent).toBe(
      JSON.stringify({ 'question:probe': 'a' })
    )
  })

  it('does not re-render an actions-only consumer when the session state changes', () => {
    window.scormBridge = { saveState: vi.fn() }
    act(() =>
      root.render(
        <PlayerProvider contentPackage={probePackage}>
          <StateProbe />
          <ActionsProbe />
        </PlayerProvider>
      )
    )

    const stateRendersBefore = stateRenders
    const actionRendersBefore = actionRenders

    act(() => answerButton().click())

    // The state-only consumer subscribed to the changing context re-renders...
    expect(stateRenders).toBe(stateRendersBefore + 1)
    // ...while the actions-only consumer, served by the separate and stable
    // actions context, is never disturbed by the state update.
    expect(actionRenders).toBe(actionRendersBefore)
  })
})

describe('PlayerProvider required hooks', () => {
  it('rejects the state hook outside a PlayerProvider', () => {
    expect(() => renderToStaticMarkup(<StateProbe />)).toThrow(
      'usePlayerState must be used within a PlayerProvider'
    )
  })

  it('rejects the actions hook outside a PlayerProvider', () => {
    expect(() => renderToStaticMarkup(<ActionsProbe />)).toThrow(
      'usePlayerActions must be used within a PlayerProvider'
    )
  })
})

describe('PageProvider ownership', () => {
  it('associates owned content with its page and leaves standalone content ownerless', () => {
    const html = renderToStaticMarkup(
      <PlayerProvider contentPackage={probePackage}>
        <PageProvider pageId={PAGE_ID}>
          <PageIdProbe />
        </PageProvider>
        <PageIdProbe />
      </PlayerProvider>
    )

    container.innerHTML = html
    const probes = Array.from(container.querySelectorAll('[data-probe="page-id"]'))

    expect(probes[0]?.textContent).toBe(PAGE_ID)
    expect(probes[1]?.textContent).toBe('none')
  })
})
