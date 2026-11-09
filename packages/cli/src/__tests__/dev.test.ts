import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ContentPackage, Renderer, RendererDevOptions } from '@scorm-cli/core'
import { createScoIndex, createScormPreviewRuntime, scormDevMock } from '@scorm-cli/scorm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoadedPackage } from '../content'
import { startDevPackage, syncCodecSourcePaths } from '../dev'
import type { DevSession } from '../dev'

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

const testDir = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = path.resolve(testDir, '../../../..')
/** The codec entry whose module graph the workspace dev watcher observes. */
const codecEntryPath = path.join(repositoryRoot, 'packages/scorm/src/browser-codec-entry.ts')
/** The asset consumed when plain `pnpm dev` resolves the scorm dist package. */
const codecAssetPath = path.join(repositoryRoot, 'packages/scorm/dist/browser-codec.js')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface WorkspaceSession {
  session: DevSession
  updates: Array<{ content: ContentPackage; scripts?: RendererDevOptions['scripts'] }>
  errors: string[]
  loads: () => number
}

/**
 * Starts a preview through the workspace default watcher — the only setup in
 * which the codec source watcher is installed. The loader and renderer stay
 * injected; watching is real, so both the content watcher and the codec
 * source watcher observe real files.
 */
async function startWorkspaceSession(contentRoot: string): Promise<WorkspaceSession> {
  const updates: WorkspaceSession['updates'] = []
  const errors: string[] = []
  let loads = 0
  const renderer: Renderer = {
    build: vi.fn(),
    dev: vi.fn(async () => ({
      url: 'http://localhost:4173',
      update: async (next: ContentPackage, scripts?: RendererDevOptions['scripts']) => {
        updates.push({ content: next, scripts })
      },
      reportError: (message: string) => errors.push(message),
      close: async () => {}
    }))
  }
  const session = await startDevPackage(
    path.join(contentRoot, 'index.mdx'),
    { port: 4173 },
    {
      loadPackage: async () => {
        loads += 1
        return { content, contentRoot, entrypoint: path.join(contentRoot, 'index.mdx') }
      },
      loadRenderer: async () => renderer,
      debounceMs: 20
      // `watch` deliberately keeps its default: the codec source watcher only
      // exists alongside the real content watcher.
    }
  )
  return { session, updates, errors, loads: () => loads }
}

afterEach(() => vi.useRealTimers())

describe('CLI dev orchestration', () => {
  it('reconciles codec watcher inputs without changing unrelated paths', () => {
    const add = vi.fn()
    const unwatch = vi.fn()
    const watcher = { add, unwatch }

    const paths = syncCodecSourcePaths(
      watcher,
      ['/codec/entry.ts', '/codec/removed.ts'],
      ['/codec/entry.ts', '/codec/helper.ts']
    )

    expect(add).toHaveBeenCalledExactlyOnceWith(['/codec/helper.ts'])
    expect(unwatch).toHaveBeenCalledExactlyOnceWith(['/codec/removed.ts'])
    expect(paths).toEqual(['/codec/entry.ts', '/codec/helper.ts'])
  })

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
            source: createScormPreviewRuntime(createScoIndex(loaded('Initial').content))
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
      createScormPreviewRuntime(createScoIndex(loaded('Initial').content))
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
      createScormPreviewRuntime(createScoIndex(loaded('Updated').content))
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
                revealCorrectAnswers: true,
                maxAttempts: 1,
                shuffleOptions: false,
                questions: [
                  {
                    type: 'question',
                    id: 'question:intro.mdx:1:1',
                    questionType: 'single-choice',
                    prompt: 'Pick one',
                    options: [
                      {
                        value: 'a',
                        correct: true,
                        content: 'Option A'
                      },
                      {
                        value: 'b',
                        correct: false,
                        content: 'Option B'
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

    // The injected scripts carry only the semantic SCO index (question
    // ids, prompts and correctness) the runtime needs to score, never a page
    // body. Prompt and option labels travel as plain strings inside the
    // index, while page content stays owned by the renderer's lazy modules,
    // so a version switch and reload cannot change what the preview serves.
    expect(runtime).toContain('question:intro.mdx:1:1')
    expect(runtime).toContain('"prompt":"Pick one"')
    expect(runtime).toContain('"label":"Option A"')
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

describe('CLI dev codec source refresh', () => {
  // Ordering matters: the codec scenario advances the mtime of a workspace
  // source file, and change events for it can surface late. The content
  // scenario runs first so it observes only its own authored changes.
  it('keeps authored content changes on the single debounced loader path', async () => {
    const contentRoot = mkdtempSync(path.join(os.tmpdir(), 'scorm-cli-dev-content-'))
    const contentFile = path.join(contentRoot, 'index.mdx')
    writeFileSync(contentFile, '# Lesson')
    const { session, updates, errors, loads } = await startWorkspaceSession(contentRoot)

    try {
      // given both workspace watchers are live: provoke the content watcher
      // until the first reload lands, then let queued events settle.
      const deadline = Date.now() + 10_000
      while (updates.length === 0 && Date.now() < deadline) {
        writeFileSync(contentFile, '# Lesson, edited')
        await sleep(150)
      }

      expect(updates.length, 'content change must reach the renderer').toBeGreaterThan(0)
      await sleep(400)
      const loadsBefore = loads()
      const updatesBefore = updates.length

      // when a single authored file changes
      writeFileSync(contentFile, '# Lesson, revised')
      const changedAt = Date.now()
      while (updates.length === updatesBefore && Date.now() - changedAt < 10_000) {
        await sleep(100)
      }
      await sleep(400)

      // then the content loader ran again, and every renderer update so far
      // was preceded by a content reload: the codec watcher never injected
      // one of its own for an ordinary authored change.
      expect(errors).toEqual([])
      expect(loads()).toBeGreaterThan(loadsBefore)
      expect(updates.length).toBeGreaterThan(updatesBefore)
      expect(updates.length, 'every update must come from a content reload').toBe(loads() - 1)
      expect(updates.at(-1)!.scripts?.[1]?.source).toBe(
        createScormPreviewRuntime(createScoIndex(content))
      )
    } finally {
      await session.close()
      rmSync(contentRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('refreshes the runtime when a codec source file changes without reloading content', async () => {
    const contentRoot = mkdtempSync(path.join(os.tmpdir(), 'scorm-cli-dev-codec-'))
    writeFileSync(path.join(contentRoot, 'index.mdx'), '# Lesson')
    const originalCodecTimes = statSync(codecEntryPath)
    // Let the directory and seed file flush their change events before the
    // session starts watching, so they can never look like a content reload.
    await sleep(400)
    const { session, updates, errors, loads } = await startWorkspaceSession(contentRoot)

    try {
      // given both watchers are live and quiet: record the baseline the codec
      // source change must move on its own.
      await sleep(600)
      const loadsBaseline = loads()
      const updatesBaseline = updates.length
      const assetMtimeBaseline = statSync(codecAssetPath).mtimeMs

      // provoke a source change in the watched codec graph until the refresh
      // lands (chokidar readiness varies by platform).
      const deadline = Date.now() + 10_000
      let touches = 0
      while (updates.length === updatesBaseline && Date.now() < deadline) {
        touches += 1
        // Only the mtime advances; the file bytes stay identical. The original
        // access and modification times are restored after the watcher closes.
        const touched = new Date(Date.now() + touches * 1000)
        utimesSync(codecEntryPath, touched, touched)
        await sleep(150)
      }

      // then a refresh happened even though no authored file changed.
      expect(updates.length, 'codec source change must trigger a refresh').toBeGreaterThan(
        updatesBaseline
      )
      await sleep(300)

      // The refresh re-derived the preview runtime — codec bundle included —
      // for the current package; the content loader was never consulted, so
      // ordinary content HMR is a separate path.
      expect(loads(), 'codec refresh must not reload authored content').toBe(loadsBaseline)
      expect(errors).toEqual([])
      expect(
        statSync(codecAssetPath).mtimeMs,
        'dist codec asset must be regenerated'
      ).toBeGreaterThan(assetMtimeBaseline)
      const latest = updates.at(-1)!
      expect(latest.content).toEqual(content)
      expect(latest.scripts?.[1]?.source).toBe(createScormPreviewRuntime(createScoIndex(content)))
      expect(latest.scripts?.[1]?.source).toContain('__scormCodec')

      // and once the session closes, codec source changes stop refreshing it.
      await session.close()
      const closedUpdates = updates.length
      const afterClose = new Date(Date.now() + 60_000)
      utimesSync(codecEntryPath, afterClose, afterClose)
      await sleep(300)
      expect(updates.length).toBe(closedUpdates)
    } finally {
      try {
        await session.close()
      } finally {
        // Touching the source provokes the real watcher; restore both timestamps
        // so a successful test cannot leave the workspace with a future mtime.
        utimesSync(codecEntryPath, originalCodecTimes.atime, originalCodecTimes.mtime)
        rmSync(contentRoot, { recursive: true, force: true })
      }
    }
  }, 30_000)
})
