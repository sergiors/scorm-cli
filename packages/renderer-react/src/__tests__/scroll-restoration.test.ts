// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disableNativeScrollRestoration } from '../../app/lib/scroll-restoration'

describe('disableNativeScrollRestoration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sets the native scroll restoration to 'manual'", () => {
    history.scrollRestoration = 'auto'

    disableNativeScrollRestoration()

    // A reload then opens at the top of the document rather than at a saved
    // scroll offset.
    expect(history.scrollRestoration).toBe('manual')
  })

  it('is an inert no-op when the History API lacks scroll restoration', () => {
    vi.stubGlobal('history', {})

    expect(() => disableNativeScrollRestoration()).not.toThrow()
  })
})
