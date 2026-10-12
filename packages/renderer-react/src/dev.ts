import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type {
  ContentPackage,
  RendererDevOptions,
  RendererDevScript,
  RendererDevServer
} from '@scorm-cli/core'
import { createServer, searchForWorkspaceRoot, type Plugin, type ViteDevServer } from 'vite'
import { PREVIEW_CLEAR_EVENT, PREVIEW_ERROR_EVENT } from '../app/shared/preview-events'
import {
  createPackageDataPlugin,
  resolveAppRoot,
  resolveCoreEntry,
  RESOLVED_PACKAGE_DATA_ID
} from './vite-app'

const DEFAULT_PORT = 5173
const DEFAULT_HOST = 'localhost'

/**
 * Starts a real Vite dev server for the authored content package and returns a
 * handle the CLI can drive.
 *
 * The preview runs the same app, components and virtual package-data plugin as
 * the production build, but serves local assets straight from `contentRoot`
 * instead of copying them, and never produces a SCORM ZIP. Updates replace the
 * in-memory package (and any supplied scripts) and trigger a full reload, while
 * authoring failures are broadcast as a custom HMR event the app renders as an
 * overlay.
 *
 * `options.scripts` (the `scorm dev` mock LMS API and the SCORM runtime) are
 * injected as inline `<script>` tags at the start of `<head>`, so they run
 * before the app module and can install `window.API`/`window.scormBridge`.
 */
export async function renderReactDevServer(
  contentPackage: ContentPackage,
  options: RendererDevOptions
): Promise<RendererDevServer> {
  const contentRoot = path.resolve(options.contentRoot)
  const host = options.host ?? DEFAULT_HOST
  // Vite treats port 0 as "unset" and falls back to 5173, so resolve an
  // ephemeral port ourselves to honour the conventional meaning of 0.
  const port = options.port === 0 ? await findFreePort(host) : (options.port ?? DEFAULT_PORT)
  const appRoot = resolveAppRoot(import.meta.url)
  const coreEntry = resolveCoreEntry(appRoot)

  const handle = { current: contentPackage }
  // The injected scripts change with the content manifest, so hold them in a
  // mutable handle the update lifecycle can replace, exactly like the package.
  const scriptsHandle: DevScriptsHandle = { current: options.scripts ?? [] }

  // Generated shadcn components import through the `@/` alias; resolve it to the
  // app directory. When the renderer runs from its own workspace the app's
  // `@scorm-cli/core` import resolves to the workspace package normally; when it
  // runs from the bundled CLI it is aliased to the browser core copy the CLI
  // build emits next to its executable.
  const alias: Record<string, string> = { '@': appRoot }
  if (coreEntry) {
    alias['@scorm-cli/core'] = coreEntry
  }

  const server = await createServer({
    configFile: false,
    root: appRoot,
    base: '/',
    logLevel: 'warn',
    resolve: { alias },
    // Keep Vite's dep cache inside the package's node_modules instead of
    // creating a stray `app/node_modules` (or `dist/node_modules`) directory
    // that would ship. The app sits at `<package>/app` in the workspace and at
    // `<package>/dist/app` in the bundled CLI, so resolve the package root.
    cacheDir: path.join(packageRootFor(appRoot), 'node_modules', '.vite'),
    plugins: [
      createDevScriptsPlugin(scriptsHandle),
      react(),
      tailwindcss(),
      createPackageDataPlugin(handle)
    ],
    // Local references in the parsed AST are relative to the package root, so
    // serving that directory as static assets makes them resolve untouched.
    publicDir: existsSync(contentRoot) ? contentRoot : false,
    server: {
      host,
      port,
      // Prefer the requested port but fall back to a free one so `scorm dev`
      // never fails on a busy port.
      strictPort: false,
      fs: {
        // In the bundled CLI the app's `@scorm-cli/core` alias points at the
        // browser core copy emitted under the sibling `dist/internal` directory,
        // so allow that directory too.
        allow: [
          searchForWorkspaceRoot(appRoot),
          contentRoot,
          ...(coreEntry ? [path.dirname(coreEntry)] : [])
        ]
      }
    }
  })

  await server.listen()

  // Finish the initial dependency scan before returning. Closing the server
  // mid-scan makes Vite log an aborted esbuild scanner error; awaiting the scan
  // also means the preview is fully ready when the URL is printed.
  const optimizer = server.environments.client.depsOptimizer
  if (optimizer) {
    await optimizer.init()
    await optimizer.scanProcessing
  }

  const url = resolveServerUrl(server, host, port)

  return {
    url,
    async update(content, scripts) {
      handle.current = content
      // The caller re-derives the scripts (e.g. the SCORM runtime embeds a
      // content manifest) on every content change, so an update that supplies
      // scripts replaces them before the reload serves the next document.
      if (scripts) {
        scriptsHandle.current = scripts
      }
      invalidatePackageData(server)
      server.ws.send({ type: 'custom', event: PREVIEW_CLEAR_EVENT })
      server.ws.send({ type: 'full-reload' })
    },
    reportError(message) {
      server.ws.send({
        type: 'custom',
        event: PREVIEW_ERROR_EVENT,
        data: { message }
      })
    },
    async close() {
      await server.close()
    }
  }
}

/**
 * Mutable holder for the dev scripts the server injects into the document. Dev
 * updates replace `current` in place so the next served document uses the
 * scripts derived for the refreshed content (for example a SCORM runtime that
 * embeds the new content manifest), without re-creating the Vite server.
 */
interface DevScriptsHandle {
  current: RendererDevScript[]
}

/**
 * Injects the caller-provided dev scripts as inline `<script>` tags at the
 * start of `<head>`, preserving order so the mock LMS API is installed before
 * the SCORM runtime that consumes it. The handle is read on every HTML
 * transform, so replacing it mid-session is picked up by the next request. This
 * hook only exists on the dev server; production builds never receive these
 * scripts.
 */
function createDevScriptsPlugin(handle: DevScriptsHandle): Plugin {
  return {
    name: 'scorm-cli:dev-scripts',
    transformIndexHtml() {
      return handle.current.map((script) => ({
        tag: 'script',
        children: escapeInlineScript(script.source),
        injectTo: 'head-prepend' as const
      }))
    }
  }
}

/**
 * Neutralises a `</script>` sequence in an inline script body so it cannot
 * close the tag early and break the surrounding document.
 */
function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script')
}

/**
 * Drops the cached transform for the virtual package-data module so the next
 * request (after the reload) re-runs `load` with the replaced package.
 */
function invalidatePackageData(server: ViteDevServer): void {
  const module = server.moduleGraph.getModuleById(RESOLVED_PACKAGE_DATA_ID)
  if (module) {
    server.moduleGraph.invalidateModule(module)
  }
}

function resolveServerUrl(server: ViteDevServer, host: string, port: number): string {
  const resolved = server.resolvedUrls
  const first = resolved?.local[0] ?? resolved?.network[0]
  if (first) {
    return first
  }
  return `http://${host}:${port}/`
}

/**
 * The package that owns the app directory. The app sits at `<package>/app` in
 * the workspace and at `<package>/dist/app` in the bundled CLI, so the package
 * root is one or two levels up from the resolved app directory.
 */
function packageRootFor(appRoot: string): string {
  const parent = path.dirname(appRoot)
  return path.basename(parent) === 'dist' ? path.dirname(parent) : parent
}

/** Asks the OS for an unused port on `host` (used when port 0 is requested). */
function findFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, host, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}
