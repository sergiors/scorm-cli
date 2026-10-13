import type { ContentPackage, Renderer, RendererDevOptions } from '@scorm-cli/core'
import { createContentManifest, createScormPreviewRuntime, scormDevMock } from '@scorm-cli/scorm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoadedPackage } from '../content'
import { startDevPackage } from '../dev'

const content: ContentPackage = {
  metadata: { title: 'Demo' },
  presentation: {
    type: 'tiles',
    items: [
      {
        type: 'item',
        id: 'item:lesson.mdx',
        source: 'lesson.mdx',
        metadata: { title: 'Lesson' },
        content: []
      }
    ]
  }
}

function loaded(title: string): LoadedPackage {
  return {
    content: { ...content, metadata: { title } },
    contentRoot: '/content',
    entrypoint: '/content/index.mdx'
  }
}

afterEach(() => vi.useRealTimers())

describe('CLI dev orchestration', () => {
  it('updates valid content, reports parse errors, recovers, and closes cleanly', async () => {
    vi.useFakeTimers()
    let loadMode: 'valid' | 'invalid' = 'valid'
    let loadedTitle = 'Initial'
    let onChange = () => {}
    let watchClosed = 0
    let serverClosed = 0
    const updates: Array<{
      content: ContentPackage
      scripts?: RendererDevOptions['scripts']
    }> = []
    const errors: string[] = []
    const dev = vi.fn(async (_initial: ContentPackage, options: RendererDevOptions) => {
      expect(options).toEqual({
        contentRoot: '/content',
        scripts: [
          { id: 'scorm-dev-mock', source: scormDevMock },
          {
            id: 'scorm-runtime',
            source: createScormPreviewRuntime(createContentManifest(loaded('Initial').content))
          }
        ],
        port: 4173
      })
      return {
        url: 'http://localhost:4173',
        update: async (next: ContentPackage, scripts?: RendererDevOptions['scripts']) => {
          updates.push({ content: next, scripts })
        },
        reportError: (message: string) => errors.push(message),
        close: async () => {
          serverClosed++
        }
      }
    })
    const renderer: Renderer = { build: vi.fn(), dev }
    const session = await startDevPackage(
      '/content',
      { port: 4173 },
      {
        loadPackage: async () => {
          if (loadMode === 'invalid') throw new Error('invalid MDX')
          return loaded(loadedTitle)
        },
        loadRenderer: async () => renderer,
        watch: async (_root, callback) => {
          onChange = callback
          return {
            close: async () => {
              watchClosed++
            }
          }
        },
        debounceMs: 10
      }
    )

    expect(dev).toHaveBeenCalledTimes(1)
    expect(session).toMatchObject({
      url: 'http://localhost:4173',
      entrypoint: '/content/index.mdx'
    })

    onChange()
    await vi.advanceTimersByTimeAsync(10)
    await Promise.resolve()
    expect(updates.map(({ content: next }) => next.metadata.title)).toEqual(['Initial'])
    expect(updates[0]?.scripts?.[1]?.source).toBe(
      createScormPreviewRuntime(createContentManifest(loaded('Initial').content))
    )

    loadMode = 'invalid'
    onChange()
    await vi.advanceTimersByTimeAsync(10)
    await Promise.resolve()
    expect(errors).toEqual(['invalid MDX'])

    loadMode = 'valid'
    loadedTitle = 'Updated'
    onChange()
    await vi.advanceTimersByTimeAsync(10)
    await Promise.resolve()
    expect(updates).toHaveLength(2)
    expect(updates[1]?.scripts?.[1]?.source).toBe(
      createScormPreviewRuntime(createContentManifest(loaded('Updated').content))
    )

    await session.close()
    expect(watchClosed).toBe(1)
    expect(serverClosed).toBe(1)
    await session.close()
    expect(serverClosed).toBe(1)
  })

  it('derives version-aware preview scripts that toggle 1.2 ↔ 2004 without carrying page bodies', async () => {
    const scrollContent: ContentPackage = {
      metadata: { title: 'Preview' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page:intro.mdx',
            source: 'intro.mdx',
            metadata: { title: 'Intro' },
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Page body text.' }]
              },
              {
                type: 'questionnaire',
                id: 'questionnaire:intro.mdx:1:1',
                contributesToScore: true,
                questions: [
                  {
                    type: 'question',
                    id: 'question:intro.mdx:1:1',
                    questionType: 'single-choice',
                    prompt: [
                      { type: 'paragraph', children: [{ type: 'text', value: 'Pick one' }] }
                    ],
                    options: [
                      {
                        value: 'a',
                        correct: true,
                        content: [
                          { type: 'paragraph', children: [{ type: 'text', value: 'Option A' }] }
                        ]
                      },
                      {
                        value: 'b',
                        correct: false,
                        content: [
                          { type: 'paragraph', children: [{ type: 'text', value: 'Option B' }] }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }

    let options: RendererDevOptions | undefined
    const dev = vi.fn(async (_initial: ContentPackage, config: RendererDevOptions) => {
      options = config
      return {
        url: 'http://localhost:5173',
        update: async () => {},
        reportError: () => {},
        close: async () => {}
      }
    })
    const renderer: Renderer = { build: vi.fn(), dev }

    await startDevPackage(
      '/content',
      {},
      {
        loadPackage: async () => ({
          content: scrollContent,
          contentRoot: '/content',
          entrypoint: '/content/index.mdx'
        }),
        loadRenderer: async () => renderer,
        watch: async () => ({ close: async () => {} }),
        debounceMs: 1
      }
    )

    const scripts = options?.scripts ?? []
    const mock = scripts.find((script) => script.id === 'scorm-dev-mock')?.source ?? ''
    const runtime = scripts.find((script) => script.id === 'scorm-runtime')?.source ?? ''

    // The mock installs both supported learner APIs and owns the active version,
    // so the toolbar switches 1.2 ↔ 2004 by persisting the choice and reloading
    // — it never asks the CLI to re-derive the renderer or its content modules.
    expect(mock).toContain('"API"')
    expect(mock).toContain('"API_1484_11"')
    expect(mock).toContain('setScormVersion')

    // The runtime binds at startup to the version the mock recorded, reusing the
    // production template, so neither version needs its own runtime source.
    expect(runtime).toContain('PREVIEW_RUNTIME_MAPPINGS')
    expect(runtime).toContain('__SCORM_PREVIEW_VERSION__')

    // The injected scripts carry only the semantic content manifest (question
    // ids, prompts and correctness) the runtime needs to score, never a page
    // body. Content stays owned by the renderer's lazy content modules, so a
    // version switch and reload cannot change what the preview serves.
    expect(runtime).toContain('question:intro.mdx:1:1')
    expect(runtime).toContain('Pick one')
    expect(runtime).not.toContain('Page body text.')
  })

  it('fails clearly when the renderer has no dev implementation', async () => {
    await expect(
      startDevPackage(
        '/content',
        {},
        {
          loadPackage: async () => loaded('Demo'),
          loadRenderer: async () => ({ build: vi.fn() }),
          watch: async () => ({ close: async () => {} }),
          debounceMs: 1
        }
      )
    ).rejects.toThrow('does not support dev mode')
  })
})
