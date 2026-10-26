import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Renderer } from '@scorm-cli/core'
import { runPreviewCommand } from '../preview-command'

describe('preview command', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('rejects an invalid --port before starting the preview session', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loadRenderer = vi.fn<() => Promise<Renderer>>()

    await runPreviewCommand('whatever-content', { port: '70000' }, loadRenderer)
    await runPreviewCommand('whatever-content', { port: 'not-a-number' }, loadRenderer)

    // The port guard fires before the package is loaded or the renderer is
    // resolved, so an invalid port never boots a half-started preview session
    // — and the reported error is the port guard, not a downstream load failure.
    expect(loadRenderer).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    const portErrors = errorSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes('--port must be an integer between 0 and 65535'))
    expect(portErrors).toHaveLength(2)
  })
})
