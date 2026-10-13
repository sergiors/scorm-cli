import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { ContentManifest } from '../content-manifest'
import { createScormRuntime } from '../runtime'

const manifest: ContentManifest = {
  schemaVersion: 1,
  title: 'Runtime events',
  lang: 'en',
  presentation: 'scroll',
  pages: {
    '0': { id: 'page-one', title: 'One', questions: {} }
  }
}

const runtime = createScormRuntime(manifest)

const suspendManifest: ContentManifest = {
  schemaVersion: 1,
  title: 'Suspend events',
  lang: 'en',
  presentation: 'scroll',
  pages: {
    '0': {
      id: 'page-one',
      title: 'One',
      questions: {
        '0': {
          id: 'q-one',
          type: 'multiple-choice',
          prompt: '',
          correctAnswers: [],
          options: {
            '0': { value: 'alpha', label: 'Alpha' },
            '1': { value: 'beta', label: 'Beta' }
          }
        }
      }
    }
  }
}

/** A valid compact payload that already carries page progress and answers. */
const initialSuspendData = JSON.stringify({
  v: 1,
  p: 50,
  x: '1',
  d: { '0': { a: { '0': [0, 1] } } }
})

interface CreateWindowOptions {
  devtools?: boolean
  console?: boolean
  /** Raw suspend_data returned by the mock LMS for `cmi.suspend_data` reads. */
  suspendData?: string
  /** Makes every `LMSGetValue` call throw, simulating a failing read. */
  getValueThrows?: boolean
  /** Removes `LMSGetValue` entirely, simulating an unsupported method. */
  getValueMissing?: boolean
  /** Makes `LMSSetValue` of `cmi.suspend_data` return `'false'`. */
  setValueRejectsSuspendData?: boolean
  /** Makes `LMSSetValue` of `cmi.suspend_data` throw, simulating a failing write. */
  setValueThrowsSuspendData?: boolean
}

/**
 * Runs the generated runtime inside a vm sandbox with a mock LMS API and a
 * console spy, mirroring how `scorm preview` injects it into the page.
 */
function createWindow(options: CreateWindowOptions = {}) {
  const logs: unknown[][] = []
  const api: Record<string, unknown> = {
    LMSInitialize: () => 'true',
    LMSGetValue: (key?: string) => {
      if (options.getValueThrows) throw new Error('read failed')
      return options.suspendData !== undefined && key === 'cmi.suspend_data'
        ? options.suspendData
        : ''
    },
    LMSSetValue: (key?: string) => {
      if (key === 'cmi.suspend_data' && options.setValueThrowsSuspendData) {
        throw new Error('write failed')
      }
      if (key === 'cmi.suspend_data' && options.setValueRejectsSuspendData) {
        return 'false'
      }
      return 'true'
    },
    LMSCommit: () => 'true',
    LMSFinish: () => 'true'
  }
  if (options.getValueMissing) delete api.LMSGetValue
  const window: Record<string, any> = { API: api }
  if (options.devtools !== false) window.__SCORM_DEVTOOLS__ = true
  if (options.console !== false) {
    window.console = { debug: (...args: unknown[]) => logs.push(args) }
  }
  window.parent = window
  window.addEventListener = () => {}
  return { window, logs }
}

describe('SCORM runtime dev event logging', () => {
  it('logs every event to the console with no cap', () => {
    const { window, logs } = createWindow()
    vm.runInNewContext(runtime, { window })

    // Startup discovery, initialize, resume reads/writes and commit.
    const startupCount = logs.length
    expect(startupCount).toBeGreaterThan(0)

    for (let index = 0; index < 40; index += 1) {
      window.scormBridge.saveState({
        location: `page-${index}`,
        pages: { 'page-one': { visited: true } }
      })
    }

    // Each save writes lesson_location, then suspend_data, then commits.
    expect(logs.length).toBe(startupCount + 40 * 3)
    expect(logs.length).toBeGreaterThan(100)

    for (const args of logs) {
      expect(args).toHaveLength(2)
      expect(args[0]).toBe('[scorm]')
      const event = args[1] as Record<string, unknown>
      expect(event).toMatchObject({
        name: expect.any(String),
        at: expect.any(Number),
        details: expect.any(Object)
      })
      expect(Object.keys(event).sort()).toEqual(['at', 'details', 'name'])
    }
  })

  it('does not log when dev tools are disabled', () => {
    const { window, logs } = createWindow({
      devtools: false,
      suspendData: initialSuspendData
    })
    vm.runInNewContext(runtime, { window })

    window.scormBridge.saveState({
      location: 'page-one',
      pages: { 'page-one': { visited: true } }
    })

    expect(logs).toHaveLength(0)
  })

  it('does not throw when no console is available', () => {
    const { window } = createWindow({ console: false })

    expect(() => vm.runInNewContext(runtime, { window })).not.toThrow()
    expect(() => window.scormBridge.saveState({ location: 'page-one', pages: {} })).not.toThrow()
  })

  it('logs the complete serialized suspend_data on read and write events', () => {
    const { window, logs } = createWindow({ suspendData: initialSuspendData })
    vm.runInNewContext(createScormRuntime(suspendManifest), { window })

    window.scormBridge.saveState({
      location: 'page-one',
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { 'q-one': ['alpha', 'beta'] }
        }
      }
    })

    const events = logs.map((args) => args[1] as { name: string; details: Record<string, unknown> })
    const readEvent = events.find(
      (event) => event.name === 'lms.get-value' && event.details.key === 'cmi.suspend_data'
    )
    const writeEvent = events.find(
      (event) => event.name === 'lms.set-value' && event.details.key === 'cmi.suspend_data'
    )

    // Reads carry the raw LMS value in both `value` and `result`.
    expect(readEvent?.details.value).toBe(initialSuspendData)
    expect(readEvent?.details.result).toBe(initialSuspendData)
    expect(readEvent?.details.length).toBe(initialSuspendData.length)

    // Writes carry the full encoded payload, not just its length.
    const serialized = writeEvent?.details.value as string
    expect(typeof serialized).toBe('string')
    expect(writeEvent?.details.length).toBe(serialized.length)
    expect(JSON.parse(serialized)).toEqual({
      v: 1,
      p: 100,
      x: '1',
      d: { '0': { a: { '0': [0, 1] } } }
    })

    expect(JSON.stringify([readEvent, writeEvent])).not.toContain('redacted')
  })

  it('retains the full serialized suspend_data when the LMS rejects the write', () => {
    const scenarios = [
      { label: 'returns false', options: { setValueRejectsSuspendData: true } },
      { label: 'throws', options: { setValueThrowsSuspendData: true } }
    ] as const

    for (const scenario of scenarios) {
      const { window, logs } = createWindow(scenario.options)
      vm.runInNewContext(createScormRuntime(suspendManifest), { window })

      const saved = window.scormBridge.saveState({
        location: 'page-one',
        pages: {
          'page-one': {
            visited: true,
            completed: true,
            answers: { 'q-one': ['alpha', 'beta'] }
          }
        }
      })
      expect(saved, scenario.label).toBe(false)

      const writeEvent = logs
        .map((args) => args[1] as { name: string; details: Record<string, unknown> })
        .find((event) => event.name === 'lms.set-value' && event.details.key === 'cmi.suspend_data')

      expect(writeEvent?.details.method, scenario.label).toBe('LMSSetValue')

      // The dev event keeps the complete attempted payload and its length,
      // even though the LMS rejected it.
      const serialized = writeEvent?.details.value as string
      expect(typeof serialized, scenario.label).toBe('string')
      expect(writeEvent?.details.length, scenario.label).toBe(serialized.length)
      expect(JSON.parse(serialized), scenario.label).toEqual({
        v: 1,
        p: 100,
        x: '1',
        d: { '0': { a: { '0': [0, 1] } } }
      })

      // ...and records how the write failed.
      if (scenario.label === 'returns false') {
        expect(writeEvent?.details.result, scenario.label).toBe('false')
      } else {
        expect(writeEvent?.details.result, scenario.label).toBe('')
        expect(writeEvent?.details.error, scenario.label).toBe('write failed')
      }
    }
  })

  it('does not report the suspend_data key as data when a read throws', () => {
    const { window, logs } = createWindow({ getValueThrows: true })
    vm.runInNewContext(createScormRuntime(suspendManifest), { window })

    const readEvent = logs
      .map((args) => args[1] as { name: string; details: Record<string, unknown> })
      .find((event) => event.name === 'lms.get-value' && event.details.key === 'cmi.suspend_data')

    expect(readEvent?.details.method).toBe('LMSGetValue')
    expect(readEvent?.details.result).toBe('')
    expect(readEvent?.details.error).toBe('read failed')
    expect(readEvent?.details).not.toHaveProperty('value')
    expect(readEvent?.details).not.toHaveProperty('length')
  })

  it('does not report the suspend_data key as data when a read is unavailable', () => {
    const { window, logs } = createWindow({ getValueMissing: true })
    vm.runInNewContext(createScormRuntime(suspendManifest), { window })

    const readEvent = logs
      .map((args) => args[1] as { name: string; details: Record<string, unknown> })
      .find((event) => event.name === 'lms.get-value' && event.details.key === 'cmi.suspend_data')

    expect(readEvent?.details.method).toBe('LMSGetValue')
    expect(readEvent?.details.reason).toBe('method-unavailable')
    expect(readEvent?.details).not.toHaveProperty('value')
    expect(readEvent?.details).not.toHaveProperty('length')
  })
})

describe('SCORM 2004 runtime', () => {
  it('discovers API_1484_11 and maps lifecycle, location, suspend data, and completion', () => {
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
    const parent: Record<string, unknown> = { API_1484_11: api }
    const window: any = {
      __SCORM_DEVTOOLS__: true,
      parent,
      console: { debug: () => undefined },
      addEventListener: () => undefined
    }

    vm.runInNewContext(createScormRuntime(manifest, '2004'), { window })
    expect(window.scormBridge.getLocation()).toBe('resume-here')
    expect(window.scormBridge.restoreState()).toEqual({ location: 'resume-here', pages: {} })

    const saved = window.scormBridge.saveState({
      location: 'next-location',
      pages: { 'page-one': { visited: true, completed: true } }
    })
    expect(saved).toBe(true)
    expect(values['cmi.location']).toBe('next-location')
    expect(JSON.parse(values['cmi.suspend_data']!)).toEqual({ v: 1, p: 100, x: '1' })
    expect(window.scormBridge.restoreState()).toEqual({
      location: 'next-location',
      pages: { 'page-one': { visited: true, completed: true } }
    })

    const longLocation = 'x'.repeat(5000)
    expect(
      window.scormBridge.saveState({
        location: longLocation,
        pages: { 'page-one': { visited: true } }
      })
    ).toBe(true)
    expect(values['cmi.location']).toBe(longLocation)

    window.scormBridge.markCompleted()
    window.scormBridge.finish()

    expect(values['cmi.completion_status']).toBe('completed')
    expect(calls).toContainEqual(['Initialize', ''])
    expect(calls).toContainEqual(['GetValue', 'cmi.completion_status'])
    expect(calls).toContainEqual(['GetValue', 'cmi.location'])
    expect(calls).toContainEqual(['GetValue', 'cmi.suspend_data'])
    expect(calls).toContainEqual(['SetValue', 'cmi.completion_status', 'incomplete'])
    expect(calls).toContainEqual(['SetValue', 'cmi.location', 'next-location'])
    expect(calls).toContainEqual(['SetValue', 'cmi.suspend_data', values['cmi.suspend_data']!])
    expect(calls).toContainEqual(['SetValue', 'cmi.completion_status', 'completed'])
    expect(calls).toContainEqual(['Commit', ''])
    expect(calls).toContainEqual(['Terminate', ''])
    expect(
      calls.some(
        ([, key]) =>
          typeof key === 'string' && (key === 'cmi.success_status' || key.startsWith('cmi.score'))
      )
    ).toBe(false)
    expect(values).not.toHaveProperty('cmi.success_status')
    expect(values).not.toHaveProperty('cmi.score.raw')
  })

  it('uses SCORM 2004 API method names in semantic event details', () => {
    const logs: unknown[][] = []
    const calls: Array<[string, ...string[]]> = []
    const api = {
      Initialize: (value: string) => (calls.push(['Initialize', value]), 'true'),
      GetValue: (key: string) => (calls.push(['GetValue', key]), ''),
      SetValue: (key: string, value: string) => (calls.push(['SetValue', key, value]), 'true'),
      Commit: (value: string) => (calls.push(['Commit', value]), 'true'),
      Terminate: (value: string) => (calls.push(['Terminate', value]), 'true')
    }
    const window: any = {
      __SCORM_DEVTOOLS__: true,
      API_1484_11: api,
      parent: null,
      console: { debug: (...args: unknown[]) => logs.push(args) },
      addEventListener: () => undefined
    }
    window.parent = window
    vm.runInNewContext(createScormRuntime(manifest, '2004'), { window })
    window.scormBridge.finish()

    const methods = logs.map((args) => (args[1] as { details: { method?: string } }).details.method)
    expect(methods).toContain('Initialize')
    expect(methods).toContain('GetValue')
    expect(methods).toContain('SetValue')
    expect(methods).toContain('Commit')
    expect(methods).toContain('Terminate')
    expect(methods).not.toContain('LMSInitialize')
    expect(calls).toContainEqual(['SetValue', 'cmi.exit', 'suspend'])
  })
})
