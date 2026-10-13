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

    // The reading position is restored deliberately by the presentation, so
    // native restoration must not replay a stale scroll offset on top of it.
    expect(history.scrollRestoration).toBe('manual')
  })

  it('is an inert no-op when the History API lacks scroll restoration', () => {
    vi.stubGlobal('history', {})

    expect(() => disableNativeScrollRestoration()).not.toThrow()
  })
})
