import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderReactPackage, reactRenderer } from '..'
import type { RenderResult } from '..'
import { samplePackage, slidesPackage, tilesPackage } from './fixtures'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`

let workDir: string
let outputDirectory: string
let entrypoint: RenderResult
let indexHtml: string
let appJs: string
let bundleJs: string
let jsFileNames: string[]
let chunkContents: Map<string, string>
let slidesBundle: BuiltBundle
let tilesBundle: BuiltBundle

/** The entry chunk plus the whole emitted bundle, for one built package. */
interface BuiltBundle {
  appJs: string
  bundleJs: string
  jsFileNames: string[]
  chunkContents: Map<string, string>
}

/** Reads every emitted chunk of a build directory into the entry and bundle views. */
async function readBundle(directory: string): Promise<BuiltBundle> {
  const assetFiles = await readdir(path.join(directory, 'assets'))
  const names = assetFiles.filter((name) => name.endsWith('.js'))
  const chunks = new Map(
    await Promise.all(
      names.map(
        async (name) =>
          [name, await readFile(path.join(directory, 'assets', name), 'utf-8')] as const
      )
    )
  )
  return {
    appJs: chunks.get('app.js') ?? '',
    bundleJs: [...chunks.values()].join('\n'),
    jsFileNames: names,
    chunkContents: chunks
  }
}

/**
 * Asserts that a built package keeps its node metadata in the entry chunk while
 * shipping every node body in a separate, relatively imported chunk. A locked or
 * unopened node therefore never contributes its AST to the initial bundle.
 */
function expectLazySplit(bundle: BuiltBundle, titles: string[], bodies: string[]): void {
  for (const title of titles) {
    expect(bundle.appJs).toContain(title)
  }
  for (const body of bodies) {
    expect(bundle.appJs).not.toContain(body)
    expect(bundle.bundleJs).toContain(body)
  }

  // Each node body travels in its own chunk, referenced from the entry with a
  // path relative to the output, so the package works from the file system or
  // any subpath.
  const contentChunks = bundle.jsFileNames.filter((name) =>
    bodies.some((body) => bundle.chunkContents.get(name)?.includes(body))
  )
  expect(contentChunks.length).toBeGreaterThan(0)
  for (const name of contentChunks) {
    expect(bundle.appJs).toContain(`./${name}`)
  }
}

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'renderer-react-'))
  outputDirectory = path.join(workDir, 'out')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(path.join(outputDirectory, 'stale.txt'), 'should be removed')
  await writeFile(path.join(workDir, 'thumb.svg'), SVG)

  entrypoint = await renderReactPackage(samplePackage, {
    outputDirectory,
    assets: [
      {
        sourcePath: path.join(workDir, 'thumb.svg'),
        targetPath: 'assets/thumb.svg'
      }
    ]
  })

  indexHtml = await readFile(path.join(outputDirectory, 'index.html'), 'utf-8')
  appJs = await readFile(path.join(outputDirectory, 'assets', 'app.js'), 'utf-8')

  // Concatenate every emitted script (not just the entry) so the exclusion
  // checks below cover lazily split dev-only chunks too.
  const scrollBundle = await readBundle(outputDirectory)
  jsFileNames = scrollBundle.jsFileNames
  chunkContents = scrollBundle.chunkContents
  bundleJs = scrollBundle.bundleJs

  // The other two root presentations are built too, so the split is proven for
  // each boundary: Slides → Page and Tiles → Item.
  const slidesDirectory = path.join(workDir, 'slides')
  await renderReactPackage(slidesPackage, { outputDirectory: slidesDirectory })
  slidesBundle = await readBundle(slidesDirectory)

  const tilesDirectory = path.join(workDir, 'tiles')
  await renderReactPackage(tilesPackage, { outputDirectory: tilesDirectory })
  tilesBundle = await readBundle(tilesDirectory)
}, 240_000)

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true })
  }
})

describe('renderReactPackage', () => {
  it('returns the output directory and index.html entrypoint', () => {
    expect(entrypoint.directory).toBe(path.resolve(outputDirectory))
    expect(entrypoint.entrypoint).toBe('index.html')
  })

  it('generates a self-contained index.html', () => {
    expect(indexHtml).toContain('<div id="root">')
    expect(indexHtml).toContain('./assets/app.js')
    expect(indexHtml).toContain('rel="stylesheet"')
    expect(indexHtml).toContain('href="./assets/')
    expect(indexHtml).toContain('<title>Rendering Fundamentals</title>')
    // No authored language means the parser default, English.
    expect(indexHtml).toContain('<html lang="en">')
    // Relative base so the output works from the file system or any subpath.
    expect(indexHtml).not.toContain('src="/assets')
  })

  it('clears stale files from the output directory', async () => {
    await expect(readFile(path.join(outputDirectory, 'stale.txt'), 'utf-8')).rejects.toThrow()
  })

  it('embeds deterministic package data in the bundle', () => {
    expect(appJs).toContain('Introduction')
    expect(appJs).toContain('Rendering Fundamentals')
    // No runtime JSON fetch is used to load the package.
    expect(appJs).not.toContain('virtual:package-data')
  })

  it('disables native browser scroll restoration in the entry bundle', () => {
    // A reload must open the reading at the top, so the packaged entry turns off
    // the browser's own scroll restoration behind a feature check; persisted
    // learner state is untouched. Assert the guarded assignment itself rather
    // than merely the presence of the two tokens.
    expect(appJs).toMatch(/['"]scrollRestoration['"]\s*in\s+history/)
    expect(appJs).toMatch(/history\.scrollRestoration\s*=\s*['"]manual['"]/)
  })

  it('splits each Scroll page into an independent lazily loaded chunk', () => {
    expectLazySplit(
      { appJs, bundleJs, jsFileNames, chunkContents },
      ['Introduction'],
      ['Welcome', 'Setup instructions.']
    )
  })

  it('splits each Slides page into an independent lazily loaded chunk', () => {
    expectLazySplit(slidesBundle, ['Introduction'], ['Welcome', 'Setup instructions.'])
  })

  it('splits each Tiles item into an independent lazily loaded chunk', () => {
    expectLazySplit(
      tilesBundle,
      ['Functions', 'Types', 'Extra details'],
      ['Function body.', 'Type body.', 'Modal body content.']
    )
  })

  it('does not ship the dev-only preview error channel or overlay', () => {
    // The preview error/clear events and the author-facing overlay are wired
    // only behind the `import.meta.hot` guard in `main.tsx`, so none of their
    // strings may survive into any packaged JavaScript chunk.
    for (const marker of [
      'scorm:preview-error',
      'scorm:preview-clear',
      // The overlay module names and its unique, hardcoded dev-preview copy.
      'PreviewErrorOverlay',
      'DevPreviewOverlay',
      'Fix the content and save. The preview reloads automatically once the content is valid',
      'import.meta.hot'
    ]) {
      expect(bundleJs).not.toContain(marker)
    }
  })

  it('does not ship the SCORM dev-tools toolbar or its controls', () => {
    for (const marker of [
      'scorm:runtime-event',
      '__SCORM_DEV_EVENT_BUFFER__',
      'ScormDevToolsToolbar',
      'ScormRuntimeEventInspector',
      'Dev tools',
      'LMS persistence',
      'Persist CMI data',
      // The dev-only shadcn Popover must not leak into the packaged app.
      'popover-content'
    ]) {
      expect(bundleJs).not.toContain(marker)
    }
    expect(bundleJs).not.toContain('import.meta.hot')
  })

  it('emits a compiled stylesheet', async () => {
    const assets = await readdir(path.join(outputDirectory, 'assets'))
    const cssFile = assets.find((name) => name.endsWith('.css'))
    expect(cssFile).toBeDefined()
    const css = await readFile(path.join(outputDirectory, 'assets', cssFile as string), 'utf-8')
    expect(css.length).toBeGreaterThan(0)
    // The Typography plugin is registered and `prose` is applied by the
    // presentations, so the compiled stylesheet must carry its rules.
    expect(css).toContain('.prose')
    expect(css).toContain('--tw-prose-body')
    // The Scroll presentation's page sizing, its inner content padding and its
    // static loading skeleton must be compiled as well, so a page reserves a
    // small viewport, keeps readable vertical padding inside its spacing-free
    // wrapper, and never animates. The removed per-page emphasis leaves no
    // transition behind.
    expect(css).toContain('.min-h-svh')
    expect(css).toContain('.py-8')
    expect(css).toMatch(/\.sm\\:py-12/)
    expect(css).toContain('.animate-none')
    expect(css).not.toContain('.transition-opacity')
    expect(css).not.toContain('.opacity-90')
  })

  it('copies provided assets to their target paths', async () => {
    const copied = await readFile(path.join(outputDirectory, 'assets', 'thumb.svg'), 'utf-8')
    expect(copied).toBe(SVG)
  })

  it('rejects an asset target that escapes the output directory', async () => {
    await expect(
      renderReactPackage(samplePackage, {
        outputDirectory,
        assets: [
          {
            sourcePath: path.join(workDir, 'thumb.svg'),
            targetPath: '../evil'
          }
        ]
      })
    ).rejects.toThrow(/escapes the output directory/)
  })

  it('requires an output directory', async () => {
    await expect(renderReactPackage(samplePackage, { outputDirectory: '' })).rejects.toThrow(
      /outputDirectory/
    )
  })
})

describe('reactRenderer', () => {
  it('exposes renderReactPackage through the renderer contract', () => {
    expect(reactRenderer.build).toBe(renderReactPackage)
  })
})
