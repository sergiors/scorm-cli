import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSourceModule, resolveAppRoot, resolveCoreEntry, resolveSourceCore } from '../vite-app'

let workDir: string
let packageRoot: string
let sourceApp: string
let builtApp: string

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'renderer-vite-app-'))
  packageRoot = path.join(workDir, 'renderer-react')
  sourceApp = path.join(packageRoot, 'app')
  builtApp = path.join(packageRoot, 'dist', 'app')

  await mkdir(sourceApp, { recursive: true })
  await mkdir(builtApp, { recursive: true })
  await mkdir(path.join(packageRoot, 'src'), { recursive: true })
  await writeFile(path.join(packageRoot, 'package.json'), '{}')
  await writeFile(path.join(sourceApp, 'index.html'), '<div id="root"></div>')
  await writeFile(path.join(builtApp, 'index.html'), '<div id="root"></div>')
  await writeFile(path.join(packageRoot, 'src', 'dev.ts'), '')
  await writeFile(path.join(packageRoot, 'dist', 'index.js'), '')
  await mkdir(path.join(packageRoot, 'dist', 'internal'), { recursive: true })
  await writeFile(path.join(packageRoot, 'dist', 'internal', 'core.js'), '')
})

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
  }
})

describe('renderer app resolution', () => {
  it('prefers the workspace app source when the renderer runs from src', () => {
    const moduleUrl = pathToFileURL(path.join(packageRoot, 'src', 'dev.ts')).href

    // A stale dist/app copy must never shadow the source tree during a source
    // preview; Vite has to watch and transform the files being edited.
    expect(isSourceModule(moduleUrl)).toBe(true)
    expect(resolveAppRoot(moduleUrl)).toBe(sourceApp)
  })

  it('prefers the shipped app copy when the renderer runs from dist', () => {
    const moduleUrl = pathToFileURL(path.join(packageRoot, 'dist', 'index.js')).href

    // The packaged CLI bundles the renderer next to its app copy, so it keeps
    // loading the copy that ships in the tarball, not a workspace app.
    expect(isSourceModule(moduleUrl)).toBe(false)
    expect(resolveAppRoot(moduleUrl)).toBe(builtApp)
  })

  it('resolves workspace core when a source run falls back to dist/app', async () => {
    const fallbackRoot = path.join(workDir, 'fallback', 'renderer-react')
    const fallbackSourceApp = path.join(fallbackRoot, 'app')
    const fallbackBuiltApp = path.join(fallbackRoot, 'dist', 'app')
    const fallbackCore = path.join(workDir, 'fallback', 'core', 'src', 'index.ts')
    await mkdir(fallbackSourceApp, { recursive: true })
    await mkdir(fallbackBuiltApp, { recursive: true })
    await mkdir(path.join(fallbackRoot, 'src'), { recursive: true })
    await mkdir(path.dirname(fallbackCore), { recursive: true })
    await writeFile(path.join(fallbackRoot, 'package.json'), '{}')
    await writeFile(path.join(fallbackRoot, 'src', 'dev.ts'), '')
    await writeFile(path.join(fallbackBuiltApp, 'index.html'), '<div id="root"></div>')
    await writeFile(fallbackCore, '')

    const moduleUrl = pathToFileURL(path.join(fallbackRoot, 'src', 'dev.ts')).href
    const appRoot = resolveAppRoot(moduleUrl)

    expect(appRoot).toBe(fallbackBuiltApp)
    expect(resolveSourceCore(appRoot)).toBe(fallbackCore)
  })

  it('resolves the bundled core copy next to the shipped app, and none in the workspace', () => {
    // The packaged CLI emits the browser-safe core copy next to its executable:
    // `dist/app` and `dist/internal/core.js` are siblings, so a bundled dev run
    // aliases the app's `@scorm-cli/core` import to the shipped copy. This is a
    // production boundary: the published CLI must never reach for workspace
    // source, only for the copy it carries.
    expect(resolveCoreEntry(builtApp)).toBe(path.join(packageRoot, 'dist', 'internal', 'core.js'))

    // A workspace source run has no bundled copy next to the app directory, so
    // `resolveCoreEntry` yields nothing and the dev server keeps the app's
    // `@scorm-cli/core` import resolving through normal package resolution.
    expect(resolveCoreEntry(sourceApp)).toBeUndefined()
  })
})
