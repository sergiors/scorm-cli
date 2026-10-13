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
