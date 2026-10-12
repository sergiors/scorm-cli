import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { scormDevMock } from '../mock'

const preferenceKey = 'scorm-cli:preview:persist-cmi'
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

function createMock(storage: MemoryStorage) {
  const window: Record<string, any> = { localStorage: storage }
  vm.runInNewContext(scormDevMock, { window })
  return window
}

describe('SCORM dev mock CMI persistence', () => {
  it('defaults to enabled and stores that preference on first run', () => {
    const storage = new MemoryStorage()
    const window = createMock(storage)

    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(true)
    expect(storage.getItem(preferenceKey)).toBe('true')
  })

  it('restores existing state when the preference is absent', () => {
    const storage = new MemoryStorage()
    storage.setItem(stateKey, JSON.stringify({ 'cmi.core.lesson_location': 'existing-lesson' }))

    const window = createMock(storage)
    expect(storage.getItem(preferenceKey)).toBe('true')
    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(true)
    expect(window.API.LMSInitialize('')).toBe('true')
    expect(window.API.LMSGetValue('cmi.core.lesson_location')).toBe('existing-lesson')
  })

  it('saves CMI on first run and restores it after reload', () => {
    const storage = new MemoryStorage()
    const firstRun = createMock(storage)

    expect(firstRun.API.LMSInitialize('')).toBe('true')
    expect(firstRun.API.LMSSetValue('cmi.core.lesson_location', 'lesson-2')).toBe('true')
    expect(JSON.parse(storage.getItem(stateKey)!)).toMatchObject({
      'cmi.core.lesson_location': 'lesson-2'
    })

    const reloaded = createMock(storage)
    expect(reloaded.scormDevTools.getCmiPersistenceEnabled()).toBe(true)
    expect(reloaded.API.LMSInitialize('')).toBe('true')
    expect(reloaded.API.LMSGetValue('cmi.core.lesson_location')).toBe('lesson-2')
  })

  it('keeps an explicit false preference disabled and clears saved state', () => {
    const storage = new MemoryStorage()
    const firstRun = createMock(storage)
    expect(firstRun.API.LMSInitialize('')).toBe('true')
    expect(firstRun.API.LMSSetValue('cmi.core.lesson_location', 'lesson-2')).toBe('true')
    expect(storage.getItem(stateKey)).not.toBeNull()

    firstRun.scormDevTools.setCmiPersistenceEnabled(false)
    expect(storage.getItem(preferenceKey)).toBe('false')
    expect(storage.getItem(stateKey)).toBeNull()

    storage.setItem(stateKey, JSON.stringify({ 'cmi.core.lesson_location': 'stale' }))
    const reloaded = createMock(storage)
    expect(reloaded.scormDevTools.getCmiPersistenceEnabled()).toBe(false)
    expect(storage.getItem(stateKey)).toBeNull()
    expect(reloaded.API.LMSInitialize('')).toBe('true')
    expect(reloaded.API.LMSGetValue('cmi.core.lesson_location')).toBe('')
  })

  it('honors an explicit true preference and restores saved CMI', () => {
    const storage = new MemoryStorage()
    storage.setItem(preferenceKey, 'true')
    storage.setItem(stateKey, JSON.stringify({ 'cmi.core.lesson_location': 'lesson-3' }))

    const window = createMock(storage)
    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(true)
    expect(window.API.LMSInitialize('')).toBe('true')
    expect(window.API.LMSGetValue('cmi.core.lesson_location')).toBe('lesson-3')
  })

  it('returns detached complete snapshots from the native flat CMI map', () => {
    const window = createMock(new MemoryStorage())
    const snapshot = window.scormDevTools.getCmiSnapshot()

    expect(snapshot).toEqual({
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': '',
      'cmi.core.total_time': '0000:00:00.00'
    })
    snapshot['cmi.core.lesson_location'] = 'changed-outside'
    snapshot.extra = 'not-in-cmi'
    expect(window.scormDevTools.getCmiSnapshot()).toEqual({
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': '',
      'cmi.core.total_time': '0000:00:00.00'
    })
  })

  it('notifies with fresh full replacement snapshots after successful SetValue only', () => {
    const window = createMock(new MemoryStorage())
    const snapshots: Array<Record<string, string>> = []
    window.scormDevTools.subscribeToCmi((snapshot: Record<string, string>) =>
      snapshots.push(snapshot)
    )

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toEqual(window.scormDevTools.getCmiSnapshot())
    expect(window.API.LMSInitialize('')).toBe('true')
    expect(snapshots[1]).toEqual({
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': '',
      'cmi.core.total_time': '0000:00:00.00',
      'cmi.core.session_time': '0000:00:00.00'
    })
    expect(window.API.LMSSetValue('cmi.core.lesson_location', 'page-1')).toBe('true')
    expect(window.API.LMSSetValue('cmi.suspend_data', 'state')).toBe('true')
    expect(window.API.LMSCommit('')).toBe('true')
    expect(window.API.LMSGetValue('cmi.core.lesson_location')).toBe('page-1')
    expect(window.API.LMSSetValue('cmi.core.lesson_status', 'invalid-status')).toBe('false')

    expect(snapshots).toHaveLength(4)
    expect(snapshots[2]).toEqual({
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': 'page-1',
      'cmi.core.total_time': '0000:00:00.00',
      'cmi.core.session_time': '0000:00:00.00'
    })
    expect(snapshots[3]).toEqual({
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': 'page-1',
      'cmi.core.total_time': '0000:00:00.00',
      'cmi.core.session_time': '0000:00:00.00',
      'cmi.suspend_data': 'state'
    })
    expect(snapshots[0]).not.toBe(snapshots[1])
    expect(snapshots[1]).not.toBe(snapshots[2])
    expect(snapshots[2]).not.toBe(snapshots[3])
  })

  it('hydrates subscribers with restored CMI and unsubscribes cleanly', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      stateKey,
      JSON.stringify({
        'cmi.core.lesson_location': 'restored-page',
        'cmi.suspend_data': 'restored-state'
      })
    )
    const window = createMock(storage)
    const snapshots: Array<Record<string, string>> = []
    const unsubscribe = window.scormDevTools.subscribeToCmi((snapshot: Record<string, string>) =>
      snapshots.push(snapshot)
    )

    expect(snapshots).toEqual([
      {
        'cmi.core.lesson_status': '',
        'cmi.core.lesson_location': 'restored-page',
        'cmi.core.total_time': '0000:00:00.00',
        'cmi.suspend_data': 'restored-state'
      }
    ])
    unsubscribe()
    window.API.LMSInitialize('')
    window.API.LMSSetValue('cmi.core.lesson_location', 'later-page')
    expect(snapshots).toHaveLength(1)
  })

  it('replaces snapshots on version resets without leaking fields between versions', () => {
    const window = createMock(new MemoryStorage())
    const snapshots: Array<Record<string, string>> = []
    window.scormDevTools.subscribeToCmi((snapshot: Record<string, string>) =>
      snapshots.push(snapshot)
    )
    window.API.LMSInitialize('')
    window.API.LMSSetValue('cmi.suspend_data', 'old-state')

    window.scormDevTools.setScormVersion('2004')
    expect(snapshots.at(-1)).toEqual({
      'cmi.completion_status': '',
      'cmi.location': '',
      'cmi.total_time': 'PT0S'
    })
    expect(window.scormDevTools.getCmiSnapshot()).not.toHaveProperty('cmi.suspend_data')

    window.API_1484_11.Initialize('')
    window.API_1484_11.SetValue('cmi.suspend_data', '2004-state')
    window.scormDevTools.setScormVersion('1.2')
    expect(snapshots.at(-1)).toEqual({
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': '',
      'cmi.core.total_time': '0000:00:00.00'
    })
    expect(window.scormDevTools.getCmiSnapshot()).not.toHaveProperty('cmi.location')
    expect(window.scormDevTools.getCmiSnapshot()).not.toHaveProperty('cmi.suspend_data')
  })

  it('logs dev events straight to the console and buffers nothing', () => {
    const storage = new MemoryStorage()
    storage.setItem(stateKey, JSON.stringify({ 'cmi.core.lesson_location': 'saved' }))
    const logs: unknown[][] = []
    const window: Record<string, any> = {
      localStorage: storage,
      console: { debug: (...args: unknown[]) => logs.push(args) }
    }

    vm.runInNewContext(scormDevMock, { window })

    expect(window.__SCORM_DEV_EVENT_BUFFER__).toBeUndefined()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toHaveLength(2)
    expect(logs[0]?.[0]).toBe('[scorm]')
    const event = logs[0]?.[1] as Record<string, unknown>
    expect(event).toMatchObject({
      name: 'cmi.persistence-restored',
      details: { count: 1 }
    })
    expect(Object.keys(event).sort()).toEqual(['at', 'details', 'name'])
  })

  it('reports storage errors through console.debug', () => {
    const logs: unknown[][] = []
    const window: Record<string, any> = {
      console: { debug: (...args: unknown[]) => logs.push(args) }
    }
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage unavailable')
      }
    })

    vm.runInNewContext(scormDevMock, { window })

    expect(
      logs.some((args) => {
        const event = args[1] as { name?: string } | undefined
        return event?.name === 'cmi.persistence-error'
      })
    ).toBe(true)
  })

  it('does not crash when localStorage is unavailable', () => {
    const window: Record<string, any> = {}
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage unavailable')
      }
    })

    expect(() => vm.runInNewContext(scormDevMock, { window })).not.toThrow()
    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(false)
    expect(window.API.LMSInitialize('')).toBe('true')
    expect(window.API.LMSSetValue('cmi.core.lesson_location', 'lesson-2')).toBe('true')
  })

  it.each([
    {
      version: '1.2',
      apiName: 'API',
      initialize: 'LMSInitialize',
      get: 'LMSGetValue',
      set: 'LMSSetValue',
      commit: 'LMSCommit',
      terminate: 'LMSFinish',
      totalKey: 'cmi.core.total_time',
      sessionKey: 'cmi.core.session_time',
      initial: '0000:00:00.00',
      first: '0001:02:03.45',
      second: '0001:02:04.45',
      nextSession: 'PT1S'
    },
    {
      version: '2004',
      apiName: 'API_1484_11',
      initialize: 'Initialize',
      get: 'GetValue',
      set: 'SetValue',
      commit: 'Commit',
      terminate: 'Terminate',
      totalKey: 'cmi.total_time',
      sessionKey: 'cmi.session_time',
      initial: 'PT0S',
      first: 'PT1H2M3.45S',
      second: 'PT1H2M4.45S',
      nextSession: '0000:00:01.00'
    }
  ])('accumulates read-only $version total_time only on successful terminate', (scenario) => {
    const storage = new MemoryStorage()
    const window = createMock(storage)
    if (scenario.version === '2004') window.scormDevTools.setScormVersion('2004')
    const api = window[scenario.apiName]
    const snapshots: Array<Record<string, string>> = []
    window.scormDevTools.subscribeToCmi((snapshot: Record<string, string>) =>
      snapshots.push(snapshot)
    )

    expect(api[scenario.initialize]('')).toBe('true')
    expect(api[scenario.get](scenario.totalKey)).toBe(scenario.initial)
    expect(api[scenario.set](scenario.totalKey, scenario.first)).toBe('false')
    expect(api[scenario.set](scenario.sessionKey, scenario.first)).toBe('true')
    expect(api[scenario.commit]('')).toBe('true')
    expect(api[scenario.get](scenario.totalKey)).toBe(scenario.initial)
    expect(api[scenario.terminate]('')).toBe('true')
    expect(api[scenario.get](scenario.totalKey)).toBe('')
    expect(window.scormDevTools.getCmiSnapshot()[scenario.totalKey]).toBe(scenario.first)
    expect(snapshots.at(-1)?.[scenario.totalKey]).toBe(scenario.first)
    expect(JSON.parse(storage.getItem(stateKey)!)[scenario.totalKey]).toBe(scenario.first)
    expect(api[scenario.terminate]('')).toBe('false')

    const reloaded = createMock(storage)
    const nextApi = reloaded[scenario.apiName]
    const nextSnapshots: Array<Record<string, string>> = []
    reloaded.scormDevTools.subscribeToCmi((snapshot: Record<string, string>) =>
      nextSnapshots.push(snapshot)
    )
    expect(nextApi[scenario.initialize]('')).toBe('true')
    expect(nextApi[scenario.get](scenario.sessionKey)).toBe(scenario.initial)
    expect(nextApi[scenario.get](scenario.totalKey)).toBe(scenario.first)
    expect(nextSnapshots.at(-1)).toEqual({
      ...nextSnapshots[0],
      [scenario.sessionKey]: scenario.initial
    })
    expect(JSON.parse(storage.getItem(stateKey)!)[scenario.sessionKey]).toBe(scenario.initial)
    expect(nextApi[scenario.set](scenario.sessionKey, scenario.nextSession)).toBe('true')
    expect(nextApi[scenario.commit]('')).toBe('true')
    expect(reloaded.scormDevTools.getCmiSnapshot()[scenario.totalKey]).toBe(scenario.first)
    expect(nextApi[scenario.terminate]('')).toBe('true')
    expect(reloaded.scormDevTools.getCmiSnapshot()[scenario.totalKey]).toBe(scenario.second)
  })
})
