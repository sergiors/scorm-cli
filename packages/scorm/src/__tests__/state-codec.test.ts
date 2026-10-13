import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { ContentPackage, PlayerState } from '@scorm-cli/core'
import { createContentManifest } from '../content-manifest'
import { decodeSuspendData, encodeSuspendData } from '../state-codec'
import { createScormRuntime } from '../runtime'

const packageContent: ContentPackage = {
  metadata: { title: 'Codec test' },
  presentation: {
    type: 'scroll',
    pages: ['page-one', 'page-two'].map((id, pageIndex) => ({
      type: 'page',
      id,
      source: `${id}.mdx`,
      metadata: { title: id },
      content: [
        {
          type: 'questionnaire',
          id: `quiz-${pageIndex}`,
          contributesToScore: true,
          questions: [
            {
              type: 'question',
              id: 'q1',
              questionType: 'multiple-choice',
              prompt: [
                {
                  type: 'paragraph',
                  children: [{ type: 'text', value: 'Private prompt' }]
                }
              ],
              options: [
                {
                  value: 'red',
                  correct: true,
                  content: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Red label' }]
                    }
                  ]
                },
                {
                  value: 'blue',
                  correct: false,
                  content: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Blue label' }]
                    }
                  ]
                },
                {
                  value: 'green',
                  correct: false,
                  content: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Green label' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }))
  }
}
const manifest = createContentManifest(packageContent)

describe('compact suspend-data codec', () => {
  it('encodes only compact indexes and decodes answers through the same manifest', () => {
    const state: PlayerState = {
      location: 'must-not-persist',
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { q1: ['green', 'red'] }
        },
        'page-two': { visited: false, answers: { q1: ['blue'] } }
      }
    }
    const encoded = encodeSuspendData(manifest, state, 50)
    expect(encoded).toEqual({
      v: 1,
      p: 50,
      x: '10',
      d: { '0': { a: { '0': [0, 2] } }, '1': { a: { '0': [1] } } }
    })
    expect(Object.keys(encoded).sort()).toEqual(['d', 'p', 'v', 'x'])
    const serialized = JSON.stringify(encoded)
    expect(serialized).not.toMatch(/location|Private prompt|Red label|correct|red|blue|green/)
    expect(decodeSuspendData(manifest, serialized)).toEqual({
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { q1: ['red', 'green'] }
        },
        'page-two': { answers: { q1: ['blue'] } }
      }
    })
  })

  it('keeps video-free payloads unchanged and stores valid positions as deciseconds', () => {
    const videoManifest = structuredClone(manifest)
    videoManifest.videos = {
      'video-a': { src: 'a.mp4', provider: 'native', pageId: 'page-one' },
      'video-b': { src: 'https://youtu.be/abc', provider: 'youtube', pageId: 'page-one' },
      'video-c': { src: 'c.mp4', provider: 'native', pageId: 'page-one' },
      'video-d': { src: 'd.mp4', provider: 'native', pageId: 'page-two' },
      'video-e': { src: 'e.mp4', provider: 'native', pageId: 'page-two' }
    }
    const legacyState: PlayerState = { pages: {} }
    expect(encodeSuspendData(manifest, legacyState, 0)).toEqual({ v: 1, p: 0, x: '00' })
    expect(JSON.stringify(encodeSuspendData(manifest, legacyState, 0))).toBe(
      '{"v":1,"p":0,"x":"00"}'
    )
    expect(encodeSuspendData(videoManifest, legacyState, 0)).toEqual({
      v: 1,
      p: 0,
      x: '00'
    })

    const encoded = encodeSuspendData(
      videoManifest,
      {
        pages: {
          'page-one': {
            videos: {
              'video-a': 12.34,
              'video-b': -1,
              'video-c': Number.POSITIVE_INFINITY,
              negative: -1,
              infinite: Number.POSITIVE_INFINITY,
              nan: Number.NaN
            }
          },
          'page-two': { videos: { 'video-d': Number.NaN, 'video-e': 0.06 } }
        }
      },
      0
    )
    expect(encoded).toEqual({
      v: 1,
      p: 0,
      x: '00',
      d: { '0': { t: { 'video-a': 123 } }, '1': { t: { 'video-e': 1 } } }
    })
    expect(encoded).not.toHaveProperty('t')
    expect(decodeSuspendData(videoManifest, encoded)).toEqual({
      pages: {
        'page-one': { videos: { 'video-a': 12.3 } },
        'page-two': { videos: { 'video-e': 0.1 } }
      }
    })
  })

  it('restores video positions by stable ID across additions, reordering, and deletions', () => {
    const originalManifest = structuredClone(manifest)
    originalManifest.videos = {
      'video-a': { src: 'a.mp4', provider: 'native', pageId: 'page-one' },
      'video-b': { src: 'b.mp4', provider: 'native', pageId: 'page-two' },
      'video-c': { src: 'c.mp4', provider: 'native', pageId: 'page-one' }
    }
    const encoded = encodeSuspendData(
      originalManifest,
      {
        pages: {
          'page-one': { videos: { 'video-a': 1.1, 'video-c': 3.3 } },
          'page-two': { videos: { 'video-b': 2.2 } }
        }
      },
      0
    )
    expect(encoded.d).toEqual({
      '0': { t: { 'video-a': 11, 'video-c': 33 } },
      '1': { t: { 'video-b': 22 } }
    })
    expect(encoded).not.toHaveProperty('t')

    const updatedManifest = structuredClone(manifest)
    updatedManifest.videos = {
      'video-new': { src: 'new.mp4', provider: 'native', pageId: 'page-two' },
      'video-b': { src: 'b.mp4', provider: 'native', pageId: 'page-one' },
      'video-a': { src: 'a.mp4', provider: 'native', pageId: 'page-two' }
    }
    expect(decodeSuspendData(updatedManifest, encoded)).toEqual({
      pages: {
        'page-one': { videos: { 'video-b': 2.2 } },
        'page-two': { videos: { 'video-a': 1.1 } }
      }
    })

    delete updatedManifest.pages['1']
    expect(decodeSuspendData(updatedManifest, encoded)).toEqual({
      pages: { 'page-one': { videos: { 'video-b': 2.2 } } }
    })
  })

  it('decodes payloads without video data and ignores invalid or unknown video IDs', () => {
    const videoManifest = structuredClone(manifest)
    videoManifest.videos = {
      'video-a': { src: 'a.mp4', provider: 'native', pageId: 'page-one' },
      'video-b': { src: 'b.mp4', provider: 'native', pageId: 'page-two' }
    }
    expect(decodeSuspendData(videoManifest, { v: 1, p: 0, x: '00' })).toEqual({ pages: {} })
    expect(
      decodeSuspendData(videoManifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          '0': { t: { 'video-a': 15, 'video-b': -1, removed: 20, fractional: 1.5 } }
        },
        t: { 'video-b': 25 }
      })
    ).toEqual({ pages: { 'page-one': { videos: { 'video-a': 1.5 } } } })
  })

  it('decodes stable video IDs across page reorder and keeps them independent of page indexes', () => {
    const videoManifest = structuredClone(manifest)
    const firstPage = videoManifest.pages['0']!
    videoManifest.pages['0'] = videoManifest.pages['1']!
    videoManifest.pages['1'] = firstPage
    videoManifest.videos = {
      'video-a': { src: 'a.mp4', provider: 'native', pageId: 'page-two' },
      'video-b': { src: 'b.mp4', provider: 'native', pageId: 'page-one' }
    }
    expect(
      decodeSuspendData(videoManifest, {
        v: 1,
        p: 0,
        x: '000',
        d: {
          '0': { a: { '0': 1 }, t: { 'video-a': 11 } },
          '1': { t: { 'video-b': 22 } }
        }
      })
    ).toEqual({
      pages: {
        'page-one': { videos: { 'video-b': 2.2 } },
        'page-two': { videos: { 'video-a': 1.1 } }
      }
    })
  })

  it('drops duplicate, unknown, unsafe, and malformed nested video data', () => {
    const videoManifest = structuredClone(manifest)
    videoManifest.videos = {
      'video-a': { src: 'a.mp4', provider: 'native', pageId: 'page-one' }
    }
    expect(
      decodeSuspendData(videoManifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          '0': { t: { 'video-a': 11, removed: 20, constructor: 30, fractional: 1.5 } },
          '1': { t: { 'video-a': 12 } },
          '2': { t: null }
        }
      })
    ).toEqual({ pages: {} })
  })

  it('nests single answers under each page so question indexes are page-local', () => {
    const singleChoiceManifest = structuredClone(manifest)
    Object.values(singleChoiceManifest.pages).forEach((page) => {
      page.questions['0']!.type = 'single-choice'
    })
    const encoded = encodeSuspendData(
      singleChoiceManifest,
      {
        pages: {
          'page-one': { answers: { q1: 'blue' } },
          'page-two': { answers: { q1: 'green' } }
        }
      },
      0
    )
    expect(encoded).toEqual({
      v: 1,
      p: 0,
      x: '00',
      d: { '0': { a: { '0': 1 } }, '1': { a: { '0': 2 } } }
    })
    expect(Object.keys(encoded).sort()).toEqual(['d', 'p', 'v', 'x'])
    expect(decodeSuspendData(singleChoiceManifest, JSON.stringify(encoded))).toEqual({
      pages: {
        'page-one': { answers: { q1: 'blue' } },
        'page-two': { answers: { q1: 'green' } }
      }
    })
  })

  it('handles string answers, omits unknown values, and clamps progress bounds', () => {
    const single: ContentPackage = {
      ...packageContent,
      presentation: {
        type: 'grid',
        items: [
          {
            type: 'item',
            id: 'item',
            source: 'item',
            metadata: { title: 'Item' },
            content: [
              {
                type: 'questionnaire',
                id: 'q',
                contributesToScore: true,
                questions: [
                  {
                    type: 'question',
                    id: 'str-q',
                    questionType: 'single-choice',
                    prompt: [],
                    options: [
                      { value: 'yes', correct: true, content: [] },
                      { value: 'no', correct: false, content: [] }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }
    const dictionary = createContentManifest(single)
    expect(
      encodeSuspendData(
        dictionary,
        {
          pages: {
            item: { visited: true, answers: { 'str-q': 'no', unknown: 'yes' } }
          }
        },
        -5
      )
    ).toEqual({
      v: 1,
      p: 0,
      x: '1',
      d: { '0': { a: { '0': 1 } } }
    })
    expect(encodeSuspendData(dictionary, { pages: {} }, 101)).toEqual({
      v: 1,
      p: 100,
      x: '0'
    })
    expect(decodeSuspendData(dictionary, { v: 1, p: 151, x: '1' })).toEqual({
      pages: {}
    })
    expect(decodeSuspendData(dictionary, { v: 1, p: 99, x: '1' })).toEqual({
      pages: { item: { visited: true } }
    })
  })

  it('rounds finite progress and safely handles non-finite progress', () => {
    expect(encodeSuspendData(manifest, { pages: {} }, 49.6).p).toBe(50)
    expect(encodeSuspendData(manifest, { pages: {} }, Number.NaN).p).toBe(0)
    expect(encodeSuspendData(manifest, { pages: {} }, Number.POSITIVE_INFINITY).p).toBe(0)

    expect(decodeSuspendData(manifest, { v: 1, p: 24, x: '00' })).toEqual({ pages: {} })
    expect(decodeSuspendData(manifest, { v: 1, p: 25, x: '00' })).toEqual({
      pages: {
        'page-one': { visited: true, completed: true }
      }
    })
  })

  it('returns a fresh state for malformed data and unsupported versions', () => {
    for (const raw of [
      'no json',
      '{"v":2,"p":0,"x":"00"}',
      '{"v":1,"p":101,"x":"00"}',
      '{"v":1,"p":0,"x":"bad"}'
    ]) {
      expect(decodeSuspendData(manifest, raw)).toEqual({ pages: {} })
    }
  })

  it('ignores malformed answer namespaces while preserving valid progress', () => {
    for (const d of [null, [], 'invalid', 42]) {
      expect(decodeSuspendData(manifest, { v: 1, p: 0, x: '10', d })).toEqual({
        pages: { 'page-one': { visited: true } }
      })
    }
    expect(
      decodeSuspendData(manifest, {
        v: 1,
        p: 0,
        x: '00',
        d: { '0': null, '1': { a: [] } }
      })
    ).toEqual({ pages: {} })
  })

  it('ignores page, question, and option indexes outside the manifest', () => {
    expect(
      decodeSuspendData(manifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          '0': { a: { '0': 99, '99': 0 } },
          '1': { a: { '0': [0, 99] } },
          '99': { a: { '0': 1 } }
        }
      })
    ).toEqual({ pages: { 'page-two': { answers: { q1: ['red'] } } } })
  })

  it('uses the embedded manifest for LMS resume/save while keeping location separate', () => {
    const initial = encodeSuspendData(
      manifest,
      { pages: { 'page-one': { visited: true, answers: { q1: ['blue'] } } } },
      50
    )
    const values: Record<string, string> = {
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': 'page:resume',
      'cmi.suspend_data': JSON.stringify(initial)
    }
    const window: any = {
      __SCORM_DEVTOOLS__: true,
      parent: null,
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
      addEventListener: () => undefined,
      dispatchEvent: () => undefined,
      CustomEvent: class {}
    }
    window.parent = window
    vm.runInNewContext(createScormRuntime(manifest), { window })
    expect(window.scormBridge.getResumeState()).toEqual({
      location: 'page:resume',
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { q1: ['blue'] }
        }
      }
    })
    expect(
      window.scormBridge.saveState({
        location: 'page:next',
        pages: {
          'page-two': { visited: true, answers: { q1: ['green', 'red'] } }
        }
      })
    ).toBe(true)
    expect(values['cmi.core.lesson_location']).toBe('page:next')
    const compact = JSON.parse(values['cmi.suspend_data']!)
    expect(compact).toEqual({
      v: 1,
      p: 0,
      x: '01',
      d: { '1': { a: { '0': [0, 2] } } }
    })
    expect(compact).toEqual(
      encodeSuspendData(
        manifest,
        {
          location: 'page:next',
          pages: {
            'page-two': { visited: true, answers: { q1: ['green', 'red'] } }
          }
        },
        0
      )
    )
    expect(JSON.stringify(compact)).not.toMatch(/page:next|green|red|Private prompt/)
  })

  it('rejects oversized SCORM 1.2 data without writing it, while saving location and committing', () => {
    const manyPages: ContentPackage = {
      metadata: { title: 'Large' },
      presentation: {
        type: 'grid',
        items: Array.from({ length: 4100 }, (_, index) => ({
          type: 'item' as const,
          id: `item-${index}`,
          source: 'item',
          metadata: { title: 'Item' },
          content: []
        }))
      }
    }
    const largeManifest = createContentManifest(manyPages)
    const calls: string[][] = []
    const values: Record<string, string> = {}
    const events: any[] = []
    const window: any = {
      __SCORM_DEVTOOLS__: true,
      parent: null,
      API: {
        LMSInitialize: () => 'true',
        LMSGetValue: (key: string) => values[key] ?? '',
        LMSSetValue: (key: string, value: string) => {
          calls.push([key, value])
          values[key] = value
          return 'true'
        },
        LMSCommit: () => {
          calls.push(['commit'])
          return 'true'
        },
        LMSFinish: () => 'true'
      },
      addEventListener: () => undefined,
      console: {
        debug: (_prefix: string, event: { name: string }) => events.push(event)
      }
    }
    window.parent = window
    vm.runInNewContext(createScormRuntime(largeManifest), { window })
    expect(window.scormBridge.saveState({ location: 'still-saved', pages: {} })).toBe(false)
    expect(calls).toContainEqual(['cmi.core.lesson_location', 'still-saved'])
    expect(calls.some(([key]) => key === 'cmi.suspend_data')).toBe(false)
    expect(calls.at(-1)).toEqual(['commit'])
    expect(events.some((event) => event.name === 'lms.suspend-data-too-large')).toBe(true)
  })
})
