import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { ContentPackage } from '@scorm-cli/core'
import { createContentManifest } from '../content-manifest'
import { scormDevMock } from '../mock'
import { createScormRuntime } from '../runtime'

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

const content: ContentPackage = {
  metadata: { title: 'Resume test' },
  presentation: {
    type: 'tiles',
    items: [
      {
        type: 'item',
        id: 'types',
        source: 'types.mdx',
        metadata: { title: 'Types' },
        content: [
          {
            type: 'questionnaire',
            id: 'types-check',
            contributesToScore: true,
            revealCorrectAnswers: true,
            maxAttempts: 1,
            shuffleOptions: false,
            questions: [
              {
                type: 'question',
                id: 'types-question',
                questionType: 'multiple-choice',
                prompt: '',
                options: [
                  { value: 'string', correct: true, content: '' },
                  { value: 'array', correct: true, content: '' },
                  { value: 'number', correct: false, content: '' }
                ]
              }
            ]
          }
        ]
      },
      {
        type: 'item',
        id: 'functions',
        source: 'functions.mdx',
        metadata: { title: 'Functions' },
        content: []
      }
    ]
  }
}

describe('SCORM dev reload resume', () => {
  it('restores the location and compact player state through the dev mock and generated runtime', () => {
    const storage = new MemoryStorage()
    const manifest = createContentManifest(content)
    const runtime = createScormRuntime(manifest)
    const createWindow = () => {
      const window: Record<string, any> = { localStorage: storage }
      window.parent = window

      // Keep script order in sync with CLI dev: mock first, then manifest runtime.
      vm.runInNewContext(scormDevMock, { window })
      vm.runInNewContext(runtime, { window })
      return window
    }

    const firstWindow = createWindow()
    expect(firstWindow.scormDevTools.getCmiPersistenceEnabled()).toBe(true)
    expect(storage.getItem('scorm-cli:preview:persist-cmi')).toBe('true')
    expect(
      firstWindow.scormBridge.saveState(
        {
          location: 'page:types',
          pages: {
            types: {
              visited: true,
              answers: { 'types-question': ['array', 'string'] }
            }
          }
        },
        50
      )
    ).toBe(true)

    const secondWindow = createWindow()
    expect(secondWindow.scormDevTools.getCmiPersistenceEnabled()).toBe(true)
    expect(secondWindow.scormBridge.restoreState()).toEqual({
      location: 'page:types',
      pages: {
        types: {
          visited: true,
          answers: { 'types-question': ['string', 'array'] }
        }
      }
    })
  })
})

const scrollContent: ContentPackage = {
  metadata: { title: 'Scroll resume' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:one',
        source: 'one.mdx',
        metadata: { title: 'One' },
        content: []
      },
      {
        type: 'page',
        id: 'page:two',
        source: 'two.mdx',
        metadata: { title: 'Two' },
        content: [
          {
            type: 'questionnaire',
            id: 'two-check',
            contributesToScore: true,
            revealCorrectAnswers: true,
            maxAttempts: 1,
            shuffleOptions: false,
            questions: [
              {
                type: 'question',
                id: 'two-question',
                questionType: 'single-choice',
                prompt: '',
                options: [
                  { value: 'yes', correct: true, content: '' },
                  { value: 'no', correct: false, content: '' }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}

describe('SCORM dev reload resume (scroll)', () => {
  it('restores sequential completion and answers after a reload, keeping the location separate', () => {
    const storage = new MemoryStorage()
    const manifest = createContentManifest(scrollContent)
    const runtime = createScormRuntime(manifest)
    const createWindow = () => {
      const window: Record<string, any> = { localStorage: storage }
      window.parent = window
      vm.runInNewContext(scormDevMock, { window })
      vm.runInNewContext(runtime, { window })
      return window
    }

    const firstWindow = createWindow()
    expect(
      firstWindow.scormBridge.saveState(
        {
          location: 'page:two',
          pages: {
            'page:one': { completed: true },
            'page:two': { visited: true, answers: { 'two-question': 'yes' } }
          }
        },
        50
      )
    ).toBe(true)

    const secondWindow = createWindow()
    // Scroll completion is reconstructed from progress, answers decode through
    // the current manifest, and the location stays in its separate CMI element —
    // so a refresh restores the learner's answers/progress and the Scroll
    // presentation reopens at the saved `page:two` location.
    expect(secondWindow.scormBridge.restoreState()).toEqual({
      location: 'page:two',
      pages: {
        'page:one': { visited: true, completed: true },
        'page:two': { visited: true, answers: { 'two-question': 'yes' } }
      }
    })
  })

  it('restores only a non-negative safe-integer shuffle seed across a reload', () => {
    const storage = new MemoryStorage()
    const manifest = createContentManifest(scrollContent)
    const runtime = createScormRuntime(manifest)
    const createWindow = () => {
      const window: Record<string, any> = { localStorage: storage }
      window.parent = window
      vm.runInNewContext(scormDevMock, { window })
      vm.runInNewContext(runtime, { window })
      return window
    }

    const firstWindow = createWindow()
    // A valid seed survives the suspend-data round trip next to page state.
    expect(firstWindow.scormBridge.saveState({ shuffleSeed: 900000000, pages: {} }, 0)).toBe(true)

    const secondWindow = createWindow()
    // The dev runtime surfaces the CMI lesson location, which stays empty here.
    expect(secondWindow.scormBridge.restoreState()).toEqual({
      location: '',
      shuffleSeed: 900000000,
      pages: {}
    })

    // An invalid persisted seed is dropped instead of corrupting the state.
    expect(firstWindow.scormBridge.saveState({ shuffleSeed: -5, pages: {} }, 0)).toBe(true)
    expect(createWindow().scormBridge.restoreState()).toEqual({ location: '', pages: {} })
  })
})
