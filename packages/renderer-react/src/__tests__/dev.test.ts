import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ContentPackage } from '@scorm-cli/core'
import { getPresentationNodes } from '@scorm-cli/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reactRenderer } from '..'
import type { RendererDevServer } from '..'
import { samplePackage, slidesPackage, tilesPackage } from './fixtures'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'

/** The served URL of the transformed `virtual:package-data` module. */
const MANIFEST_URL = '@id/__x00__virtual:package-data'

/**
 * Every dynamic import specifier Vite rewrote in a served virtual module. In dev
 * each authored node body is imported through a host-origin `/@id/...` URL (a
 * packaged build instead uses a relative `./assets/...` chunk path), so reading
 * the transformed manifest is what proves the preview follows the same lazy
 * import the browser will actually fetch.
 */
function dynamicImportSpecifiers(code: string): string[] {
  return [...code.matchAll(/\bimport\((['"])(.+?)\1\)/g)].map((match) => match[2]!)
}

/** The canonical node id (e.g. `page:intro.mdx`) encoded in a lazy import URL. */
function nodeIdFromSpecifier(specifier: string): string {
  return decodeURIComponent(specifier.slice(specifier.lastIndexOf('/') + 1))
}

/**
 * Drives the dev server to `contentPackage`, then follows every dynamic import
 * the transformed manifest generated — fetching each from the preview origin
 * exactly as the browser would. Returns the served manifest plus one entry per
 * lazily loaded node module: the node id it resolves, the import specifier Vite
 * emitted and the served body.
 */
async function loadLazyNodes(contentPackage: ContentPackage) {
  await server.update(contentPackage)
  const manifest = await fetch(`${server.url}${MANIFEST_URL}`).then((response) => response.text())
  const nodes = await Promise.all(
    dynamicImportSpecifiers(manifest).map(async (specifier) => {
      const response = await fetch(new URL(specifier, server.url))
      expect(response.status).toBe(200)
      return {
        id: nodeIdFromSpecifier(specifier),
        specifier,
        body: await response.text()
      }
    })
  )
  return { manifest, nodes }
}

interface HmrFrame {
  type?: string
  event?: string
  data?: unknown
}

/** Minimal Vite HMR client used to observe custom preview events. */
class HmrSocket {
  private readonly socket: WebSocket
  private readonly received: HmrFrame[] = []
  private readonly pending: Array<{
    match: (frame: HmrFrame) => boolean
    resolve: (frame: HmrFrame) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      let frame: HmrFrame
      try {
        frame = JSON.parse(String(event.data)) as HmrFrame
      } catch {
        return
      }
      this.received.push(frame)
      for (let index = this.pending.length - 1; index >= 0; index -= 1) {
        const waiter = this.pending[index]
        if (waiter.match(frame)) {
          clearTimeout(waiter.timer)
          this.pending.splice(index, 1)
          waiter.resolve(frame)
        }
      }
    })
  }

  waitFor(match: (frame: HmrFrame) => boolean, timeoutMs = 15_000): Promise<HmrFrame> {
    const existing = this.received.find(match)
    if (existing) {
      return Promise.resolve(existing)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for HMR frame')),
        timeoutMs
      )
      this.pending.push({ match, resolve, timer })
    })
  }

  close(): void {
    this.socket.close()
  }
}

async function connectHmr(baseUrl: string): Promise<HmrSocket> {
  const clientSource = await fetch(`${baseUrl}@vite/client`).then((response) => response.text())
  const token = clientSource.match(/const wsToken = "([^"]+)"/)?.[1] ?? ''
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}?token=${encodeURIComponent(token)}`

  const socket = new WebSocket(wsUrl, 'vite-hmr')
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('HMR WebSocket failed to open')), {
      once: true
    })
  })
  return new HmrSocket(socket)
}

let workDir: string
let contentRoot: string
let server: RendererDevServer

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'renderer-react-dev-'))
  contentRoot = path.join(workDir, 'content')
  await mkdir(path.join(contentRoot, 'assets'), { recursive: true })
  await writeFile(path.join(contentRoot, 'assets', 'pixel.svg'), SVG)

  const dev = reactRenderer.dev
  if (!dev) {
    throw new Error('reactRenderer.dev is not implemented')
  }

  server = await dev(samplePackage, {
    contentRoot,
    port: 0,
    host: 'localhost',
    scripts: [
      { id: 'scorm-dev-mock', source: 'window.__SCORM_DEVTOOLS__ = true;' },
      {
        id: 'scorm-runtime',
        source: 'window.scormBridge = { markCompleted: function () {} };'
      }
    ]
  })
}, 120_000)

afterAll(async () => {
  await server?.close()
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
  }
})

describe('reactRenderer.dev', () => {
  it('exposes an http url', () => {
    expect(server.url).toMatch(/^http:\/\/[^/]+\/$/)
  })

  it('serves the app shell with the package title', async () => {
    await server.update(samplePackage)
    const response = await fetch(server.url)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<div id="root">')
    expect(html).toContain('/@vite/client')
    expect(html).toContain('<title>Rendering Fundamentals</title>')
  })

  it('serves local assets from the provided content root', async () => {
    const response = await fetch(`${server.url}assets/pixel.svg`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(SVG)
  })

  it('injects the provided dev scripts in order, before the app module', async () => {
    const html = await fetch(server.url).then((response) => response.text())

    const mockIndex = html.indexOf('__SCORM_DEVTOOLS__')
    const runtimeIndex = html.indexOf('markCompleted')
    const appIndex = html.indexOf('main.tsx')

    expect(mockIndex).toBeGreaterThan(-1)
    expect(runtimeIndex).toBeGreaterThan(mockIndex)
    expect(appIndex).toBeGreaterThan(runtimeIndex)
  })

  it('serves the virtual package data module', async () => {
    await server.update(samplePackage)
    const response = await fetch(`${server.url}@id/__x00__virtual:package-data`)
    expect(response.status).toBe(200)
    const code = await response.text()
    expect(code).toContain('Rendering Fundamentals')
    expect(code).toContain('Introduction')
  })

  it('keeps only the semantic summary in the manifest and serves page content separately', async () => {
    await server.update(samplePackage)
    const code = await fetch(`${server.url}@id/__x00__virtual:package-data`).then((response) =>
      response.text()
    )

    // The manifest exposes the lazy content provider and the minimal semantic
    // summary the session layer needs — questionnaire and question ids, option
    // values and correctness — while dropping the presentation-only page body.
    expect(code).toContain('contentProvider')
    expect(code).toContain('questionnaire:intro.mdx:1:1')
    expect(code).toContain('"value":"first"')
    expect(code).toContain('"correct":true')
    expect(code).not.toContain('Which option is correct?')
    expect(code).not.toContain('Welcome')

    // The full page AST is served by the page's own lazily loaded module.
    const pageCode = await fetch(
      `${server.url}@id/__x00__virtual:package-node/page%3Aintro.mdx`
    ).then((response) => response.text())
    expect(pageCode).toContain('Which option is correct?')
    expect(pageCode).toContain('Welcome')
  })

  it('rejects an unknown content id instead of resolving to blank content', async () => {
    await server.update(samplePackage)
    const code = await fetch(`${server.url}@id/__x00__virtual:package-data`).then((response) =>
      response.text()
    )

    // An id with no server-rendered module is a manifest or build mismatch, not
    // an empty node: the provider rejects with the id rather than resolving to
    // `[]`, which would render a blank page as if the load had succeeded.
    expect(code).not.toContain('Promise.resolve([])')
    expect(code).toContain('No content module for node id')
  })

  it('fails the node content module for an unknown id instead of serving blank content', async () => {
    const response = await fetch(`${server.url}@id/__x00__virtual:package-node/page%3Amissing.mdx`)

    // A node id with no authored page/item must fail the module load so the app
    // renders a visible load error, never a blank page from `export default []`.
    expect(response.status).not.toBe(200)
    expect(await response.text()).toContain('No content module for node id: page:missing.mdx')
  })

  it('serves Slides pages and Tiles items as independent lazily loaded modules', async () => {
    // Slides: the manifest carries the page metadata and summary, while each
    // page's body is served by its own module.
    await server.update(slidesPackage)
    const slidesManifest = await fetch(`${server.url}@id/__x00__virtual:package-data`).then(
      (response) => response.text()
    )
    expect(slidesManifest).toContain('contentProvider')
    expect(slidesManifest).not.toContain('Setup instructions.')
    const slideModule = await fetch(
      `${server.url}@id/__x00__virtual:package-node/page%3Asetup.mdx`
    ).then((response) => response.text())
    expect(slideModule).toContain('Setup instructions.')

    // Tiles: the item body is served by its own module too.
    await server.update(tilesPackage)
    const tilesManifest = await fetch(`${server.url}@id/__x00__virtual:package-data`).then(
      (response) => response.text()
    )
    expect(tilesManifest).not.toContain('Function body.')
    const itemModule = await fetch(
      `${server.url}@id/__x00__virtual:package-node/item%3Afunctions.mdx`
    ).then((response) => response.text())
    expect(itemModule).toContain('Function body.')
  })

  it('resolves the generated lazy imports to the served Page modules for Scroll and Slides', async () => {
    for (const contentPackage of [samplePackage, slidesPackage]) {
      const { manifest, nodes } = await loadLazyNodes(contentPackage)

      // The manifest embeds no page body; each page is exposed only as a lazy
      // import the provider issues on demand.
      expect(manifest).not.toContain('Welcome')
      expect(manifest).not.toContain('Setup instructions.')

      const pageBodies: Record<string, string> = {
        'page:intro.mdx': 'Welcome',
        'page:setup.mdx': 'Setup instructions.'
      }
      expect(nodes.map(({ id }) => id).sort()).toEqual(Object.keys(pageBodies).sort())

      for (const { id, specifier, body } of nodes) {
        // Dev resolves the virtual node module to an absolute, host-origin URL
        // the browser fetches from the preview origin. A packaged build instead
        // imports a relative `./assets/...` chunk (see build.test.ts), so the
        // preview runs the same lazy import through Vite's own transform rather
        // than an eager preview-only path.
        expect(specifier).toMatch(/^\/@id\/__x00__virtual:package-node\//)
        expect(specifier).not.toMatch(/^\.\//)
        expect(body).toContain(pageBodies[id])
      }
    }
  })

  it('resolves the generated lazy imports to the served Item modules for Tiles', async () => {
    const { manifest, nodes } = await loadLazyNodes(tilesPackage)

    expect(manifest).not.toContain('Function body.')
    expect(manifest).not.toContain('Type body.')
    expect(manifest).not.toContain('Modal body content.')

    const itemBodies: Record<string, string> = {
      'item:functions.mdx': 'Function body.',
      'item:types.mdx': 'Type body.',
      'item:details.mdx': 'Modal body content.'
    }
    expect(nodes.map(({ id }) => id).sort()).toEqual(Object.keys(itemBodies).sort())

    for (const { id, specifier, body } of nodes) {
      expect(specifier).toMatch(/^\/@id\/__x00__virtual:package-node\//)
      expect(body).toContain(itemBodies[id])
    }
  })

  it('imports every node body dynamically so a locked body never loads with the manifest', async () => {
    await server.update(samplePackage)
    const manifest = await fetch(`${server.url}@id/__x00__virtual:package-data`).then((response) =>
      response.text()
    )

    // Page two is locked until page one completes. Its body may only be reached
    // through the dynamic import inside `contentProvider.load`, so loading the
    // manifest (the initial module) can never download a locked body: a static
    // import or re-export would ship it eagerly. The runtime's request policy
    // itself — a locked node is never requested — is covered by the DOM suite,
    // which asserts `never requests a locked page module`.
    expect(manifest).not.toMatch(/^\s*import\s+['"]/m)
    expect(manifest).not.toMatch(/\bfrom\s*['"]virtual:package-node/)
    for (const page of getPresentationNodes(samplePackage)) {
      expect(manifest).toContain(`case ${JSON.stringify(page.id)}: return import(`)
    }
    // Content is only ever resolved through `load`; `get` reads the cache.
    expect(manifest).toContain('return contentCache.get(id);')
  })

  it('keeps the lazy module URL valid when the preview document is re-served', async () => {
    await server.update(samplePackage)
    const manifest = await fetch(`${server.url}@id/__x00__virtual:package-data`).then((response) =>
      response.text()
    )
    const specifier = dynamicImportSpecifiers(manifest)[0]!
    const before = await fetch(new URL(specifier, server.url)).then((response) => response.text())

    // Re-requesting the preview document (as a browser reload would) must not
    // invalidate the module graph: the same lazy node URL is still served with
    // the same content, so the browser can reuse it. This test does not execute
    // the injected scripts or switch SCORM versions; it only asserts that
    // fetching the document leaves the lazy module URL intact.
    await fetch(server.url).then((response) => response.text())
    const after = await fetch(new URL(specifier, server.url)).then((response) => response.text())

    expect(after).toBe(before)
    expect(after).toContain('Welcome')
  })

  it('replaces the virtual package data on update', async () => {
    const updated = {
      ...samplePackage,
      metadata: { title: 'Updated title' }
    }

    await server.update(updated)

    const module = await fetch(`${server.url}@id/__x00__virtual:package-data`).then((response) =>
      response.text()
    )
    expect(module).toContain('Updated title')

    const html = await fetch(server.url).then((response) => response.text())
    expect(html).toContain('<title>Updated title</title>')
  })

  it('refreshes the injected runtime scripts on update and serves the new runtime', async () => {
    const updated = {
      ...samplePackage,
      metadata: { title: 'Refreshed runtime' }
    }

    // The CLI re-derives both scripts from the new content (the SCORM runtime
    // embeds the refreshed content manifest), so the server must serve the new
    // runtime on the very next document request rather than the initial one.
    await server.update(updated, [
      { id: 'scorm-dev-mock', source: 'window.__SCORM_DEVTOOLS__ = true;' },
      {
        id: 'scorm-runtime',
        source:
          'window.scormBridge = { markCompleted: function () { window.__RUNTIME_MANIFEST__ = "Refreshed runtime"; } };'
      }
    ])

    const html = await fetch(server.url).then((response) => response.text())
    expect(html).toContain('__RUNTIME_MANIFEST__')
  })

  it('broadcasts preview errors and clears them on the next update', async () => {
    const client = await connectHmr(server.url)
    try {
      // Wait until the server has registered this client.
      await client.waitFor((frame) => frame.type === 'connected')

      const errorFrame = client.waitFor(
        (frame) => frame.type === 'custom' && frame.event === 'scorm:preview-error'
      )
      server.reportError('Broken content at lessons/intro.mdx:3')
      const error = await errorFrame
      expect(error.data).toEqual({
        message: 'Broken content at lessons/intro.mdx:3'
      })

      const clearFrame = client.waitFor(
        (frame) => frame.type === 'custom' && frame.event === 'scorm:preview-clear'
      )
      await server.update({
        ...samplePackage,
        metadata: { title: 'Recovered' }
      })
      await clearFrame
    } finally {
      client.close()
    }
  })
})
