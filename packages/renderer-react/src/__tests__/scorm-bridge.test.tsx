// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreState, saveState, useScormBridge } from '../../app/lib/use-scorm-bridge'
import type { PlayerState } from '../../app/types'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
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
  vi.restoreAllMocks()
})

/** Minimal consumer so the hook's effects run under a real React root. */
function BridgeHarness({ complete }: { complete: boolean }) {
  useScormBridge(complete)
  return null
}

function render(complete: boolean): void {
  act(() => root.render(<BridgeHarness complete={complete} />))
}

function unload(): void {
  act(() => {
    window.dispatchEvent(new Event('pagehide'))
  })
}

describe('restoreState', () => {
  it('returns undefined without a bridge', () => {
    expect(restoreState()).toBeUndefined()
  })

  it('returns the persisted state from the bridge', () => {
    const state: PlayerState = { location: 'page:intro.mdx', pages: {} }
    window.scormBridge = { restoreState: () => state }
    expect(restoreState()).toBe(state)
  })

  it('swallows a throwing reader and reports no state', () => {
    window.scormBridge = {
      restoreState: () => {
        throw new Error('storage blocked')
      }
    }

    expect(restoreState()).toBeUndefined()
  })
})

describe('saveState', () => {
  it('reports a no-op without a bridge or reader', () => {
    expect(saveState({ pages: {} }, 0)).toBe(false)
    window.scormBridge = {}
    expect(saveState({ pages: {} }, 0)).toBe(false)
  })

  it('treats a void or accepted write as persisted', () => {
    window.scormBridge = { saveState: () => undefined }
    expect(saveState({ pages: {} }, 0)).toBe(true)
    window.scormBridge = { saveState: () => true }
    expect(saveState({ pages: {} }, 0)).toBe(true)
  })

  it('reports a rejected write', () => {
    window.scormBridge = { saveState: () => false }
    expect(saveState({ pages: {} }, 0)).toBe(false)
  })

  it('swallows a throwing writer and reports a rejected write', () => {
    window.scormBridge = {
      saveState: () => {
        throw new Error('lms down')
      }
    }

    expect(() => saveState({ pages: {} }, 0)).not.toThrow()
    expect(saveState({ pages: {} }, 0)).toBe(false)
  })
})

describe('useScormBridge completion', () => {
  it('does not mark completion before the package is complete', () => {
    const markCompleted = vi.fn()
    window.scormBridge = { markCompleted }

    render(false)
    expect(markCompleted).not.toHaveBeenCalled()

    render(true)
    expect(markCompleted).toHaveBeenCalledTimes(1)
  })

  it('marks completion at most once, even across completion toggles', () => {
    const markCompleted = vi.fn()
    window.scormBridge = { markCompleted }

    render(true)
    render(false)
    render(true)

    expect(markCompleted).toHaveBeenCalledTimes(1)
  })

  it('does not throw out of render when the completion call throws', () => {
    window.scormBridge = {
      markCompleted: () => {
        throw new Error('lms down')
      }
    }

    expect(() => render(true)).not.toThrow()
  })

  it('retries a failed completion the next time the package completes', () => {
    const markCompleted = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('lms down')
      })
      .mockImplementation(() => {})

    window.scormBridge = { markCompleted }

    // The first attempt throws; the failure is contained and not recorded.
    render(true)
    expect(markCompleted).toHaveBeenCalledTimes(1)

    // Leaving and re-entering the completed state retries the notification.
    render(false)
    render(true)
    expect(markCompleted).toHaveBeenCalledTimes(2)
  })
})

describe('useScormBridge unload', () => {
  it('finishes on every pagehide', () => {
    const finish = vi.fn()
    window.scormBridge = { finish }

    render(false)
    unload()
    unload()

    expect(finish).toHaveBeenCalledTimes(2)
  })

  it('does not throw out of the unload event when finish throws', () => {
    window.scormBridge = {
      finish: () => {
        throw new Error('lms down')
      }
    }

    render(false)

    expect(() => unload()).not.toThrow()
  })

  it('keeps working with no bridge installed', () => {
    expect(() => {
      render(true)
      unload()
    }).not.toThrow()
  })
})
