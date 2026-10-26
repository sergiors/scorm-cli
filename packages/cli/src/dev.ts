import chokidar from 'chokidar'
import type { Renderer, RendererDevOptions, RendererDevServer } from '@scorm-cli/core'
import { createContentManifest, createScormPreviewRuntime, scormDevMock } from '@scorm-cli/scorm'
import type { LoadedPackage } from './content'
import { loadPackage } from './content'
import { errorMessage } from './errors'
import { loadRenderer } from './renderer'

interface DevWatcher {
  close(): Promise<void>
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
  const contentManifest = createContentManifest(content)
  // The mock owns the preview's active SCORM version; the runtime it is paired
  // with resolves the matching API mapping at startup, so a version switch only
  // needs to persist the choice and reload.
  return [
    { id: 'scorm-dev-mock', source: scormDevMock },
    { id: 'scorm-runtime', source: createScormPreviewRuntime(contentManifest) }
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
  let watcher: DevWatcher
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
            if (!closed) await server.update(nextPackage.content, scriptsFor(nextPackage.content))
          } catch (error) {
            if (!closed) server.reportError(errorMessage(error))
          }
        })
      }, dependencies.debounceMs)
    })
  } catch (error) {
    await server.close()
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
          await watcher.close()
        } catch (error) {
          watcherError = error
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
