import { vi } from 'vitest'

/**
 * Replaces ReactPlayer with a lightweight test double for every suite. ReactPlayer
 * ships a CommonJS bundle whose lazy players use extensionless dynamic imports,
 * which Vitest cannot resolve; the production Vite build does, and is validated
 * separately. The double exposes the same public surface (props, `seekTo`,
 * `getCurrentTime`) so the renderer's binding can still be tested end to end.
 */
vi.mock('react-player', async () => {
  const { MockReactPlayer } = await import('./react-player-mock')
  return { default: MockReactPlayer }
})

/**
 * jsdom (25.x) has no `PointerEvent` constructor, while Base UI synthesizes a
 * `PointerEvent` click for every activation it performs on a control's behalf:
 * the checkbox forwards its clicks onto the hidden native form input, and
 * keyboard activation of non-native buttons (Space on checkbox, Enter/Space on
 * `role="checkbox"`/`option` elements) is dispatched the same way. A plain
 * `MouseEvent` cannot carry `pointerType`, which several Base UI handlers read
 * to distinguish mouse gestures from keyboard/AT activation, so the shim keeps
 * that contract intact under jsdom.
 */
if (typeof window !== 'undefined' && typeof window.PointerEvent !== 'function') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly width: number
    readonly height: number
    readonly pressure: number
    readonly tangentialPressure: number
    readonly tiltX: number
    readonly tiltY: number
    readonly twist: number
    readonly isPrimary: boolean

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? ''
      this.width = init.width ?? 1
      this.height = init.height ?? 1
      this.pressure = init.pressure ?? 0
      this.tangentialPressure = init.tangentialPressure ?? 0
      this.tiltX = init.tiltX ?? 0
      this.tiltY = init.tiltY ?? 0
      this.twist = init.twist ?? 0
      this.isPrimary = init.isPrimary ?? false
    }
  }
  window.PointerEvent = PointerEventShim as unknown as typeof PointerEvent
}
