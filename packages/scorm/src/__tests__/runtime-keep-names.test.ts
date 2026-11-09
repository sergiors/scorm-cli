import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlayerState } from '@scorm-cli/core'
import type { ScoIndex } from '../sco-index'
import { decodeSuspendData, encodeSuspendData } from '../state-codec'

const execFileAsync = promisify(execFile)

const testDir = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = path.resolve(testDir, '../../../..')
/** The exact tsx used by `pnpm preview`, which serves the scorm package from TS source. */
const tsxBinary = path.join(repositoryRoot, 'packages/cli/node_modules/.bin/tsx')
const previewTsconfigPath = path.join(repositoryRoot, 'packages/cli/tsconfig.preview.json')
const probePath = path.join(testDir, 'fixtures/keep-names-probe.ts')

/**
 * `pnpm preview` serves the runtime from source through tsx. Spawn that exact
 * source runner to ensure esbuild reads and bundles the codec module graph as
 * the browser would receive it, rather than relying on Vitest's transform.
 */
interface SerializedPreview {
  scoIndex: ScoIndex
  codecSource: string
  previewRuntime: string
  mock: string
}

let tempDir = ''
let serialized: SerializedPreview

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'scorm-keep-names-'))
  const resultPath = path.join(tempDir, 'result.json')
  try {
    await execFileAsync(tsxBinary, ['--tsconfig', previewTsconfigPath, probePath, resultPath], {
      timeout: 120_000
    })
  } catch (error) {
    const spawnError = error as { stderr?: string; message: string }
    throw new Error(`tsx keep-names probe failed: ${spawnError.stderr ?? spawnError.message}`, {
      cause: error
    })
  }
  serialized = JSON.parse(readFileSync(resultPath, 'utf8')) as SerializedPreview
}, 120_000)

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
})

const SAVED_STATE: PlayerState = {
  location: 'page:one',
  pages: {
    'page:one': {
      visited: true,
      completed: true,
      answers: { 'q-one': ['alpha', 'beta'] },
      videos: { 'video:lesson.mdx:0:1': 12.34 }
    }
  }
}

/** Mirrors CLI dev injection order: the mock script runs first, then the preview runtime. */
function createPreviewWindow(): Record<string, any> {
  const window: Record<string, any> = { localStorage: new MemoryStorage() }
  window.parent = window
  vm.runInNewContext(serialized.mock, { window })
  vm.runInNewContext(serialized.previewRuntime, { window })
  return window
}

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('embedded browser runtime source under tsx keepNames', () => {
  it('bundles the codec module graph without serializing tsx-transformed functions', () => {
    expect(serialized.codecSource).not.toContain('__name(')
    expect(serialized.codecSource).not.toMatch(/node:|require\(/)
    expect(serialized.codecSource).toContain('compactEncode')
    expect(serialized.codecSource).toContain('compactDecode')
  })

  it('bundles source even when a stale generated asset is present', async () => {
    const sourceAssetPath = path.join(repositoryRoot, 'packages/scorm/src/browser-codec.js')
    expect(existsSync(sourceAssetPath), 'source tree must not contain a generated asset').toBe(
      false
    )
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'scorm-stale-codec-'))
    const resultPath = path.join(tempDir, 'result.json')
    const staleMarker = 'STALE_GENERATED_CODEC_SENTINEL'

    try {
      writeFileSync(sourceAssetPath, `globalThis.${staleMarker} = true;`)
      await execFileAsync(tsxBinary, ['--tsconfig', previewTsconfigPath, probePath, resultPath], {
        timeout: 120_000
      })
      const result = JSON.parse(readFileSync(resultPath, 'utf8')) as SerializedPreview

      expect(result.codecSource).not.toContain(staleMarker)
      expect(result.codecSource).toContain('compactEncode')
    } finally {
      unlinkSync(sourceAssetPath)
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, 120_000)

  it('evaluates the bundled codec standalone and matches the Node codec', () => {
    const context: Record<string, unknown> = {}
    vm.runInNewContext(serialized.codecSource, context)

    const compactEncode = context.compactEncode as (m: unknown, s: unknown, p: number) => string
    const compactDecode = context.compactDecode as (m: unknown, r: unknown) => unknown
    expect(typeof compactEncode).toBe('function')
    expect(typeof compactDecode).toBe('function')

    expect(JSON.parse(compactEncode(serialized.scoIndex, SAVED_STATE, 100))).toEqual(
      encodeSuspendData(serialized.scoIndex, SAVED_STATE, 100)
    )
    const encoded = JSON.stringify(encodeSuspendData(serialized.scoIndex, SAVED_STATE, 100))
    expect(compactDecode(serialized.scoIndex, encoded)).toEqual(
      decodeSuspendData(serialized.scoIndex, encoded)
    )
  })

  it('installs window.scormBridge from the serialized preview runtime and persists writes through the mock', () => {
    const window = createPreviewWindow()

    // The dev mock installs its control surface first; the runtime must install
    // its bridge using the codec bundle generated from source.
    expect(window.scormDevTools).toBeDefined()
    expect(window.scormBridge).toBeDefined()

    expect(window.scormBridge.saveState(SAVED_STATE)).toBe(true)

    const cmi = window.scormDevTools.getCmiSnapshot()
    expect(cmi['cmi.core.lesson_location']).toBe('page:one')
    expect(cmi['cmi.core.lesson_status']).toBe('incomplete')
    // The suspend data the runtime wrote decodes back to the renderer-readable
    // state, so the injected preview really persisted through the mock LMS.
    expect(decodeSuspendData(serialized.scoIndex, cmi['cmi.suspend_data'])).toEqual({
      pages: {
        'page:one': {
          visited: true,
          completed: true,
          answers: { 'q-one': ['alpha', 'beta'] },
          videos: { 'video:lesson.mdx:0:1': 12.3 }
        }
      }
    })
  })
})
