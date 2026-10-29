import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
const probePath = path.join(testDir, 'fixtures/keep-names-probe.ts')

/**
 * tsx compiles TypeScript with esbuild's `keepNames` transform, which wraps the
 * codec's nested helpers so their serialized source calls an ambient `__name`.
 * `pnpm preview` serves the runtime from source through tsx, so these tests
 * spawn tsx to serialize `browserCodecSource()` exactly as the browser would
 * receive it. Vitest's own transform does not use `keepNames`, so importing the
 * module here cannot reproduce the failure: without the injected shim the
 * generated script throws `__name is not defined` before `window.scormBridge`
 * can install, leaving `window.scormDevTools` (the mock) alone on the page.
 */
interface SerializedPreview {
  scoIndex: ScoIndex
  codecSource: string
  codecBody: string
  previewRuntime: string
  mock: string
}

let tempDir = ''
let serialized: SerializedPreview

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'scorm-keep-names-'))
  const resultPath = path.join(tempDir, 'result.json')
  try {
    await execFileAsync(tsxBinary, [probePath, resultPath], { timeout: 120_000 })
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
  it('serializes the codec with ambient __name references under tsx', () => {
    // Documents that this suite models the transform the preview really uses.
    // When this turns false, tsx no longer injects keepNames `__name` wrappers,
    // the shim in `browserCodecSource()` would be unnecessary and this
    // regression scenario has drifted.
    expect(
      serialized.codecBody,
      'expected the tsx-serialized codec to call an ambient __name helper'
    ).toContain('__name(')
  })

  it('evaluates the embedded codec source standalone without an ambient __name helper', () => {
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

    // The dev mock installs its control surface first; the runtime must still
    // install its bridge even though its serialized codec references `__name`.
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
