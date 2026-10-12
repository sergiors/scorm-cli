import { describe, expect, it } from 'vitest'
import { resolveRendererEntrypoint } from '../package-paths'

describe('renderer entrypoint validation', () => {
  it('accepts a root index.html entrypoint and normalizes its path', () => {
    expect(resolveRendererEntrypoint({ directory: 'build/site', entrypoint: './index.html' })).toBe(
      'index.html'
    )
  })

  it('rejects entrypoints outside the renderer output directory', () => {
    expect(() =>
      resolveRendererEntrypoint({ directory: 'build/site', entrypoint: '../index.html' })
    ).toThrow('renderer entrypoint must be inside its output directory')
  })

  it('requires the root entrypoint to be named index.html', () => {
    expect(() =>
      resolveRendererEntrypoint({ directory: 'build/site', entrypoint: 'app.html' })
    ).toThrow('renderer entrypoint must be named index.html')
    expect(() =>
      resolveRendererEntrypoint({ directory: 'build/site', entrypoint: 'nested/index.html' })
    ).toThrow('renderer entrypoint must be at the root of its output directory')
  })
})
