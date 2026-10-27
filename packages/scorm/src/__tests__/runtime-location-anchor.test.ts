import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { ContentManifest } from '../content-manifest'
import { createScormRuntime } from '../runtime'

const manifest: ContentManifest = {
  schemaVersion: 1,
  title: 'Location anchor',
  lang: 'en',
  presentation: 'scroll',
  pages: {
    '0': { id: 'page:one', title: 'One', questions: {} }
  }
}

function createWindow(initialLocation = '') {
  const values: Record<string, string> = {
    'cmi.core.lesson_location': initialLocation,
    'cmi.core.lesson_status': ''
  }
  const window: Record<string, any> = {
    API: {
      LMSInitialize: () => 'true',
      LMSGetValue: (key: string) => values[key] ?? '',
      LMSSetValue: (key: string, value: string) => {
        values[key] = value
        return 'true'
      },
      LMSCommit: () => 'true',
      LMSFinish: () => 'true'
    },
    addEventListener: () => undefined
  }
  window.parent = window
  vm.runInNewContext(createScormRuntime(manifest), { window })
  return { window, values }
}

describe('SCORM runtime reading location', () => {
  it('persists a semantic location and anchor as one lesson location', () => {
    const { window, values } = createWindow()

    expect(
      window.scormBridge.saveState({
        location: 'page:one',
        anchor: 'abc12345',
        pages: {}
      })
    ).toBe(true)

    expect(values['cmi.core.lesson_location']).toBe('page:one#abc12345')
  })

  it('keeps a legacy page-only location unchanged', () => {
    const { window, values } = createWindow()

    window.scormBridge.saveState({ location: 'page:one', pages: {} })

    expect(values['cmi.core.lesson_location']).toBe('page:one')
  })

  it('does not append an anchor to an already encoded location', () => {
    const { window, values } = createWindow()

    window.scormBridge.saveState({
      location: 'page:one#abc12345',
      anchor: 'abc12345',
      pages: {}
    })

    expect(values['cmi.core.lesson_location']).toBe('page:one#abc12345')
  })

  it('restores the encoded location for the renderer to decode', () => {
    const { window } = createWindow('page:one#abc12345')

    expect(window.scormBridge.getResumeState()).toEqual({
      location: 'page:one#abc12345',
      pages: {}
    })
  })
})
