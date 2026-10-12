import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { ContentManifest } from '../content-manifest'
import { scormDevMock } from '../mock'
import { createScormPreviewRuntime } from '../runtime'

const versionKey = 'scorm-cli:preview:scorm-version'
const stateKey = 'scorm-cli:preview:cmi-state'

class MemoryStorage {
  private values = new Map<string, string>()

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

function has(window: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(window, key)
}

/** Runs the injected dev mock exactly like the preview: mock first, alone. */
function createMockWindow(storage: MemoryStorage): Record<string, any> {
  const window: Record<string, any> = { localStorage: storage }
  vm.runInNewContext(scormDevMock, { window })
  return window
}

const manifest: ContentManifest = {
  schemaVersion: 1,
  title: 'Preview version',
  lang: 'en',
  presentation: 'scroll',
  pages: {
    '0': { id: 'page-one', title: 'One', questions: {} }
  }
}

const previewRuntime = createScormPreviewRuntime(manifest)

/** Runs the mock then the version-aware preview runtime, in injection order. */
function createPreviewWindow(storage: MemoryStorage): Record<string, any> {
  const window = createMockWindow(storage)
  window.parent = window
  window.console = { debug: () => undefined }
  window.addEventListener = () => undefined
  vm.runInNewContext(previewRuntime, { window })
  return window
}

describe('SCORM preview version selection', () => {
  it('defaults to SCORM 1.2 and installs only the 1.2 API global', () => {
    const storage = new MemoryStorage()
    const window = createMockWindow(storage)

    expect(window.scormDevTools.getScormVersion()).toBe('1.2')
    expect(window.scormDevTools.getApiName()).toBe('API')
    expect(storage.getItem(versionKey)).toBe('1.2')
    expect(typeof window.API.LMSInitialize).toBe('function')
    expect(has(window, 'API_1484_11')).toBe(false)
  })

  it('restores a persisted SCORM 2004 selection and installs only the 2004 API global', () => {
    const storage = new MemoryStorage()
    storage.setItem(versionKey, '2004')
    const window = createMockWindow(storage)

    expect(window.scormDevTools.getScormVersion()).toBe('2004')
    expect(window.scormDevTools.getApiName()).toBe('API_1484_11')
    expect(typeof window.API_1484_11.Initialize).toBe('function')
    expect(typeof window.API_1484_11.Terminate).toBe('function')
    // The opposite global is never installed, so no wrong method names leak.
    expect(has(window, 'API')).toBe(false)
    expect(window.API_1484_11.LMSInitialize).toBeUndefined()
  })

  it('falls back to SCORM 1.2 for an invalid preference and repairs it', () => {
    const storage = new MemoryStorage()
    storage.setItem(versionKey, '1.3')
    const window = createMockWindow(storage)

    expect(window.scormDevTools.getScormVersion()).toBe('1.2')
    expect(storage.getItem(versionKey)).toBe('1.2')
    expect(has(window, 'API')).toBe(true)
    expect(has(window, 'API_1484_11')).toBe(false)
  })

  it('switches versions, clears the saved CMI state and replaces the API global', () => {
    const storage = new MemoryStorage()
    const window = createMockWindow(storage)

    window.API.LMSInitialize('')
    window.API.LMSSetValue('cmi.core.lesson_location', 'lesson-1')
    expect(storage.getItem(stateKey)).not.toBeNull()

    window.scormDevTools.setScormVersion('2004')

    expect(window.scormDevTools.getScormVersion()).toBe('2004')
    expect(window.scormDevTools.getApiName()).toBe('API_1484_11')
    expect(storage.getItem(versionKey)).toBe('2004')
    expect(storage.getItem(stateKey)).toBeNull()
    expect(has(window, 'API')).toBe(false)
    expect(typeof window.API_1484_11.SetValue).toBe('function')

    // The fresh API starts from a clean CMI state.
    expect(window.API_1484_11.Initialize('')).toBe('true')
    expect(window.API_1484_11.GetValue('cmi.location')).toBe('')
  })

  it('finishes the active bridge before replacing the API global on switch', () => {
    const storage = new MemoryStorage()
    const window = createMockWindow(storage)
    const previousApi = window.API
    const events: string[] = []

    window.scormBridge = {
      finish: () => {
        events.push('finish')
        // The outgoing API must still be installed while the bridge finishes.
        events.push(window.API === previousApi ? 'api-intact' : 'api-replaced')
      }
    }

    window.scormDevTools.setScormVersion('2004')

    expect(events).toEqual(['finish', 'api-intact'])
    expect(window.API).toBeUndefined()
    expect(typeof window.API_1484_11.Initialize).toBe('function')
  })

  it('treats reselecting the active version as a no-op', () => {
    const storage = new MemoryStorage()
    storage.setItem(versionKey, '2004')
    const window = createMockWindow(storage)
    const api = window.API_1484_11

    api.Initialize('')
    api.SetValue('cmi.location', 'resume-here')
    expect(storage.getItem(stateKey)).not.toBeNull()

    window.scormDevTools.setScormVersion('2004')

    // Same API object, same live CMI values, saved state untouched.
    expect(window.API_1484_11).toBe(api)
    expect(window.API_1484_11.GetValue('cmi.location')).toBe('resume-here')
    expect(storage.getItem(versionKey)).toBe('2004')
    expect(storage.getItem(stateKey)).not.toBeNull()
  })

  it('keeps the selected version across script re-evaluation and content reloads', () => {
    const storage = new MemoryStorage()
    storage.setItem(versionKey, '2004')

    const first = createPreviewWindow(storage)
    expect(first.scormDevTools.getScormVersion()).toBe('2004')
    expect(first.__SCORM_PREVIEW_VERSION__).toBe('2004')

    // A content hot-reload re-evaluates the scripts against the same storage.
    const reloaded = createPreviewWindow(storage)
    expect(reloaded.scormDevTools.getScormVersion()).toBe('2004')
    expect(reloaded.__SCORM_PREVIEW_VERSION__).toBe('2004')
    expect(has(reloaded, 'API_1484_11')).toBe(true)
    expect(has(reloaded, 'API')).toBe(false)
  })
})

describe('SCORM version-aware preview runtime', () => {
  it('binds to the SCORM 2004 API mapping when the mock selected 2004', () => {
    const calls: Array<[string, ...string[]]> = []
    const values: Record<string, string> = {
      'cmi.completion_status': 'incomplete',
      'cmi.location': 'resume-here',
      'cmi.suspend_data': JSON.stringify({ v: 1, p: 0, x: '0' })
    }
    const api = {
      Initialize: (value: string) => (calls.push(['Initialize', value]), 'true'),
      GetValue: (key: string) => (calls.push(['GetValue', key]), values[key] ?? ''),
      SetValue: (key: string, value: string) => {
        calls.push(['SetValue', key, value])
        values[key] = value
        return 'true'
      },
      Commit: (value: string) => (calls.push(['Commit', value]), 'true'),
      Terminate: (value: string) => (calls.push(['Terminate', value]), 'true')
    }
    const window: Record<string, any> = {
      __SCORM_DEVTOOLS__: true,
      __SCORM_PREVIEW_VERSION__: '2004',
      API_1484_11: api,
      console: { debug: () => undefined },
      addEventListener: () => undefined
    }
    window.parent = window

    vm.runInNewContext(previewRuntime, { window })

    expect(window.scormBridge.getLocation()).toBe('resume-here')
    window.scormBridge.saveState({
      location: 'next-location',
      pages: { 'page-one': { visited: true, completed: true } }
    })
    expect(values['cmi.location']).toBe('next-location')
    expect(calls).toContainEqual(['Initialize', ''])
    expect(calls.some(([method]) => method === 'LMSInitialize')).toBe(false)
  })

  it('binds to the SCORM 1.2 API mapping when the mock selected 1.2', () => {
    const calls: Array<[string, ...string[]]> = []
    const values: Record<string, string> = {}
    const api = {
      LMSInitialize: (value: string) => (calls.push(['LMSInitialize', value]), 'true'),
      LMSGetValue: (key: string) => (calls.push(['LMSGetValue', key]), values[key] ?? ''),
      LMSSetValue: (key: string, value: string) => {
        calls.push(['LMSSetValue', key, value])
        values[key] = value
        return 'true'
      },
      LMSCommit: (value: string) => (calls.push(['LMSCommit', value]), 'true'),
      LMSFinish: (value: string) => (calls.push(['LMSFinish', value]), 'true')
    }
    const window: Record<string, any> = {
      __SCORM_DEVTOOLS__: true,
      __SCORM_PREVIEW_VERSION__: '1.2',
      API: api,
      console: { debug: () => undefined },
      addEventListener: () => undefined
    }
    window.parent = window

    vm.runInNewContext(previewRuntime, { window })

    window.scormBridge.saveState({
      location: 'page-one',
      pages: { 'page-one': { visited: true, completed: true } }
    })
    expect(calls).toContainEqual(['LMSInitialize', ''])
    expect(calls).toContainEqual(['LMSSetValue', 'cmi.core.lesson_location', 'page-one'])
    expect(calls.some(([method]) => method === 'Initialize')).toBe(false)
  })
})
