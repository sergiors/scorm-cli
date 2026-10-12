import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createScormRuntime, formatScorm12Duration, formatScorm2004Duration } from '../runtime'

const manifest = {
  schemaVersion: 1 as const,
  title: '',
  lang: 'en',
  presentation: 'scroll' as const,
  pages: {}
}

function createRuntime(version: '1.2' | '2004', now: () => number, initializeResult = 'true') {
  const calls: Array<[string, ...string[]]> = []
  const values: Record<string, string> = {}
  const api: Record<string, (key?: string, value?: string) => string> = {}
  const method =
    version === '1.2'
      ? {
          initialize: 'LMSInitialize',
          get: 'LMSGetValue',
          set: 'LMSSetValue',
          commit: 'LMSCommit',
          terminate: 'LMSFinish'
        }
      : {
          initialize: 'Initialize',
          get: 'GetValue',
          set: 'SetValue',
          commit: 'Commit',
          terminate: 'Terminate'
        }
  api[method.initialize] = (parameter) => (
    calls.push([method.initialize, parameter ?? '']),
    initializeResult
  )
  api[method.get] = (key) => (calls.push([method.get, key ?? '']), values[key ?? ''] ?? '')
  api[method.set] = (key, value) => {
    calls.push([method.set, key ?? '', value ?? ''])
    values[key ?? ''] = value ?? ''
    return 'true'
  }
  api[method.commit] = (parameter) => (calls.push([method.commit, parameter ?? '']), 'true')
  api[method.terminate] = (parameter) => (calls.push([method.terminate, parameter ?? '']), 'true')
  const window: Record<string, any> = {
    [version === '1.2' ? 'API' : 'API_1484_11']: api,
    performance: { now },
    addEventListener: () => undefined
  }
  window.parent = window
  vm.runInNewContext(createScormRuntime(manifest, version), { window })
  return {
    window,
    api,
    calls,
    values,
    setMethod: method.set,
    commitMethod: method.commit,
    terminateMethod: method.terminate
  }
}

describe('semantic SCORM score and session timing', () => {
  it('formats elapsed durations deterministically at centisecond boundaries', () => {
    expect(formatScorm12Duration(0)).toBe('0000:00:00.00')
    expect(formatScorm12Duration(9)).toBe('0000:00:00.01')
    expect(formatScorm12Duration(10)).toBe('0000:00:00.01')
    expect(formatScorm12Duration(3_723_456)).toBe('0001:02:03.46')
    expect(formatScorm12Duration(36_000_000)).toBe('0010:00:00.00')
    expect(formatScorm2004Duration(0)).toBe('PT0S')
    expect(formatScorm2004Duration(10)).toBe('PT0.01S')
    expect(formatScorm2004Duration(3_723_456)).toBe('PT1H2M3.46S')
  })

  it.each([
    {
      version: '1.2' as const,
      expected: [
        ['cmi.core.score.min', '0'],
        ['cmi.core.score.max', '100'],
        ['cmi.core.score.raw', '33.33']
      ]
    },
    {
      version: '2004' as const,
      expected: [
        ['cmi.score.min', '0'],
        ['cmi.score.max', '100'],
        ['cmi.score.raw', '33.33'],
        ['cmi.score.scaled', '0.3333']
      ]
    }
  ])('maps semantic score only to SCORM $version score elements', ({ version, expected }) => {
    const { window, calls, setMethod, commitMethod } = createRuntime(version, () => 0)
    expect(window.scormBridge.setScore(undefined)).toBe(false)
    expect(window.scormBridge.setScore({ earned: 1, possible: 3 })).toBe(true)
    const scoreWrites = calls.filter(
      ([method, key]) => method === setMethod && key?.includes('score')
    )
    expect(scoreWrites.map(([, key, value]) => [key, value])).toEqual(expected)
    expect(
      scoreWrites.some(
        ([, key]) => key?.includes('success_status') || key?.includes('lesson_status')
      )
    ).toBe(false)
    const scoreWriteIndexes = calls.flatMap(([method, key], index) =>
      method === setMethod && key?.includes('score') ? [index] : []
    )
    const scoreCommitIndex = calls.findIndex(
      ([method], index) => method === commitMethod && index > scoreWriteIndexes[0]!
    )
    expect(scoreCommitIndex).toBeGreaterThan(scoreWriteIndexes.at(-1)!)
  })

  it('clamps scores and performs no writes for absent or empty scores', () => {
    const { window, calls, setMethod } = createRuntime('2004', () => 0)
    const callsAfterInitialize = calls.length
    expect(window.scormBridge.setScore(undefined)).toBe(false)
    expect(window.scormBridge.setScore({ earned: 0, possible: 0 })).toBe(false)
    expect(window.scormBridge.setScore({ earned: Number.NaN, possible: 1 })).toBe(false)
    expect(calls).toHaveLength(callsAfterInitialize)
    expect(calls.filter(([method, key]) => method === setMethod && key?.includes('score'))).toEqual(
      []
    )

    expect(window.scormBridge.setScore({ earned: 2, possible: 1 })).toBe(true)
    expect(
      calls
        .filter(([method, key]) => method === setMethod && key?.includes('score'))
        .map(([, key, value]) => [key, value])
    ).toEqual([
      ['cmi.score.min', '0'],
      ['cmi.score.max', '100'],
      ['cmi.score.raw', '100'],
      ['cmi.score.scaled', '1']
    ])
  })

  it('checks each score write, skips commit after a rejected write, and reports commit failure', () => {
    const { window, api, calls, setMethod, commitMethod } = createRuntime('2004', () => 0)
    const originalSet = api[setMethod]
    api[setMethod] = (key, value) => {
      if (key === 'cmi.score.max') {
        calls.push([setMethod, key ?? '', value ?? ''])
        return 'false'
      }
      return originalSet(key, value)
    }

    const commitsBeforeFailedScore = calls.filter(([method]) => method === commitMethod).length
    expect(window.scormBridge.setScore({ earned: 1, possible: 2 })).toBe(false)
    expect(
      calls.filter(([method, key]) => method === setMethod && key?.includes('score'))
    ).toHaveLength(4)
    expect(calls.filter(([method]) => method === commitMethod)).toHaveLength(
      commitsBeforeFailedScore
    )

    api[setMethod] = originalSet
    api[commitMethod] = () => {
      calls.push([commitMethod, ''])
      return 'false'
    }
    expect(window.scormBridge.setScore({ earned: 1, possible: 2 })).toBe(false)
    const lastScoreWrite = calls
      .map(([method, key], index) => (method === setMethod && key?.includes('score') ? index : -1))
      .filter((index) => index >= 0)
      .at(-1)!
    const lastCommit = calls
      .map(([method], index) => (method === commitMethod ? index : -1))
      .at(-1)!
    expect(lastCommit).toBeGreaterThan(lastScoreWrite)
  })

  it('does not write session_time when Initialize fails', () => {
    const { window, calls, setMethod } = createRuntime('1.2', () => 0, 'false')
    window.scormBridge.finish()
    expect(
      calls.filter(([method, key]) => method === setMethod && key?.includes('session_time'))
    ).toEqual([])
  })

  it.each([
    { version: '1.2' as const, expectedKey: 'cmi.core.session_time', expected: '0002:03:04.57' },
    { version: '2004' as const, expectedKey: 'cmi.session_time', expected: 'PT2H3M4.57S' }
  ])(
    'writes $version session_time once before commit and terminate',
    ({ version, expectedKey, expected }) => {
      let clock = 10
      const { window, calls, values, setMethod, commitMethod, terminateMethod } = createRuntime(
        version,
        () => clock
      )
      clock = 7_384_580
      window.scormBridge.finish()
      window.scormBridge.finish()

      expect(values[expectedKey]).toBe(expected)
      expect(values).not.toHaveProperty('cmi.core.total_time')
      expect(values).not.toHaveProperty('cmi.total_time')
      const sessionWrite = calls.findIndex(
        ([method, key]) => method === setMethod && key === expectedKey
      )
      const commit = calls.map(([method]) => method).lastIndexOf(commitMethod)
      const terminate = calls.findIndex(([method]) => method === terminateMethod)
      expect(sessionWrite).toBeGreaterThan(-1)
      expect(sessionWrite).toBeLessThan(commit)
      expect(commit).toBeLessThan(terminate)
      expect(
        calls.filter(([method, key]) => method === setMethod && key === expectedKey)
      ).toHaveLength(1)
    }
  )
})
