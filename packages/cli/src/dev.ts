import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'
import type { Renderer, RendererDevOptions, RendererDevServer } from '@scorm-cli/core'
import { createScoIndex, createScormPreviewRuntime, scormDevMock } from '@scorm-cli/scorm'
import type { LoadedPackage } from './content'
import { loadPackage } from './content'
import { errorMessage } from './errors'
import { loadRenderer } from './renderer'

interface DevWatcher {
  close(): Promise<void>
}

interface CodecSourceWatcher {
  add(paths: string[]): unknown
  unwatch(paths: string[]): unknown
}

/** Keep the codec watcher aligned with the inputs reported by esbuild. */
export function syncCodecSourcePaths(
  watcher: CodecSourceWatcher,
  currentPaths: string[],
  nextPaths: string[]
): string[] {
  const current = new Set(currentPaths)
  const next = new Set(nextPaths)
  const added = [...next].filter((sourcePath) => !current.has(sourcePath))
  const removed = [...current].filter((sourcePath) => !next.has(sourcePath))

  if (added.length > 0) watcher.add(added)
  if (removed.length > 0) watcher.unwatch(removed)
  return [...next]
}

export interface DevSession {
  url: string
  entrypoint: string
  close(): Promise<void>
}

export interface DevDependencies {
  loadPackage(contentPath: string): Promise<LoadedPackage>
  loadRenderer(): Promise<Renderer>
  watch(contentRoot: string, onChange: () => void): DevWatcher | Promise<DevWatcher>
  debounceMs: number
}

const defaultDependencies: DevDependencies = {
  loadPackage,
  loadRenderer,
  watch: (contentRoot, onChange) => {
    const watcher = chokidar.watch(contentRoot, { ignoreInitial: true })
    watcher.on('all', onChange)
    return watcher
  },
  debounceMs: 100
}

function scriptsFor(content: LoadedPackage['content']) {
  const scoIndex = createScoIndex(content)
  // The mock owns the preview's active SCORM version; the runtime it is paired
  // with resolves the matching API mapping at startup, so a version switch only
  // needs to persist the choice and reload.
  return [
    { id: 'scorm-dev-mock', source: scormDevMock },
    { id: 'scorm-runtime', source: createScormPreviewRuntime(scoIndex) }
  ]
}

export interface StartDevOptions {
  port?: number
  host?: string
}

/**
 * Start a renderer preview and keep it updated from validated authored content.
 *
 * Dependencies are injectable so tests can drive the lifecycle, and the source
 * preview entry can supply the workspace renderer without changing the packaged
 * loader. Omitted dependencies keep their defaults.
 */
export async function startDevPackage(
  contentPath: string,
  options: StartDevOptions = {},
  dependencyOverrides: Partial<DevDependencies> = {}
): Promise<DevSession> {
  const dependencies: DevDependencies = { ...defaultDependencies, ...dependencyOverrides }
  const initialPackage = await dependencies.loadPackage(contentPath)
  const renderer = await dependencies.loadRenderer()
  if (typeof renderer.dev !== 'function')
    throw new Error('@scorm-cli/renderer-react does not support dev mode')

  // `pnpm preview` maps this package to TS source, while plain `pnpm dev`
  // resolves @scorm-cli/scorm through its dist export. Keep that dist asset
  // current before either source-runner path creates its initial runtime.
  const codecEntryPath = fileURLToPath(
    new URL('../../scorm/src/browser-codec-entry.ts', import.meta.url)
  )
  const sourceRunner = fileURLToPath(import.meta.url).includes(`${path.sep}src${path.sep}`)
  const watchCodecSource =
    dependencies.watch === defaultDependencies.watch && sourceRunner && existsSync(codecEntryPath)
  let codecSourcePaths: string[] = []
  let refreshCodecAsset: (() => string[]) | undefined
  if (watchCodecSource) {
    const { buildSync } = createRequire(import.meta.url)('esbuild') as typeof import('esbuild')
    refreshCodecAsset = () => {
      const result = buildSync({
        absWorkingDir: path.dirname(codecEntryPath),
        entryPoints: [codecEntryPath],
        bundle: true,
        metafile: true,
        platform: 'browser',
        format: 'iife',
        globalName: '__scormCodec',
        target: 'es2017',
        minify: true,
        legalComments: 'none',
        logLevel: 'silent',
        write: false
      })
      const assetPath = path.resolve(path.dirname(codecEntryPath), '../dist/browser-codec.js')
      mkdirSync(path.dirname(assetPath), { recursive: true })
      writeFileSync(assetPath, result.outputFiles[0]!.text)
      return Object.keys(result.metafile!.inputs).map((sourcePath) =>
        path.resolve(path.dirname(codecEntryPath), sourcePath)
      )
    }
    codecSourcePaths = refreshCodecAsset()
  }

  const rendererOptions: RendererDevOptions = {
    contentRoot: initialPackage.contentRoot,
    scripts: scriptsFor(initialPackage.content),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.host === undefined ? {} : { host: options.host })
  }
  const server: RendererDevServer = await renderer.dev(initialPackage.content, rendererOptions)

  let closed = false
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let updateQueue: Promise<void> = Promise.resolve()
  let closePromise: Promise<void> | undefined
  let watcher: DevWatcher | undefined
  let codecWatcher: DevWatcher | undefined
  let currentPackage = initialPackage
  try {
    watcher = await dependencies.watch(initialPackage.contentRoot, () => {
      if (closed) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined
        updateQueue = updateQueue.then(async () => {
          if (closed) return
          try {
            const nextPackage = await dependencies.loadPackage(contentPath)
            if (!closed) {
              currentPackage = nextPackage
              await server.update(nextPackage.content, scriptsFor(nextPackage.content))
            }
          } catch (error) {
            if (!closed) server.reportError(errorMessage(error))
          }
        })
      }, dependencies.debounceMs)
    })
    // This watcher is separate from Vite's module graph: authored React/MDX
    // changes keep their ordinary HMR path, while codec edits regenerate the
    // asset consumed by dist-backed source CLI runs before refreshing scripts.
    if (watchCodecSource && refreshCodecAsset) {
      const sourceWatcher = chokidar.watch(codecSourcePaths, { ignoreInitial: true })
      codecWatcher = sourceWatcher
      sourceWatcher.on('all', (event) => {
        if (event !== 'change' && event !== 'unlink' && event !== 'unlinkDir') return
        if (closed) return
        updateQueue = updateQueue.then(async () => {
          if (closed) return
          try {
            codecSourcePaths = syncCodecSourcePaths(
              sourceWatcher,
              codecSourcePaths,
              refreshCodecAsset()
            )
            await server.update(currentPackage.content, scriptsFor(currentPackage.content))
          } catch (error) {
            if (!closed) server.reportError(errorMessage(error))
          }
        })
      })
    }
  } catch (error) {
    closed = true
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = undefined
    // Startup can fail after any watcher has been created. Attempt every close
    // independently so a cleanup error cannot mask the startup error.
    const closeQuietly = async (resource?: { close(): Promise<void> }) => {
      try {
        await resource?.close()
      } catch {
        // Preserve the original startup failure.
      }
    }
    await Promise.all([closeQuietly(codecWatcher), closeQuietly(watcher), closeQuietly(server)])
    throw error
  }

  return {
    url: server.url,
    entrypoint: initialPackage.entrypoint,
    close: () => {
      if (closePromise) return closePromise
      closed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      closePromise = (async () => {
        let watcherError: unknown
        try {
          await watcher?.close()
        } catch (error) {
          watcherError = error
        }
        try {
          await codecWatcher?.close()
        } catch (error) {
          watcherError ??= error
        }
        try {
          await updateQueue
        } finally {
          await server.close()
        }
        if (watcherError) throw watcherError
      })()
      return closePromise
    }
  }
}
