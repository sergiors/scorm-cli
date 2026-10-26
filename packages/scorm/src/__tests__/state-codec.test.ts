import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { ContentPackage, PlayerState } from '@scorm-cli/core'
import { createContentManifest } from '../content-manifest'
import { decodeSuspendData, encodeSuspendData } from '../state-codec'
import { createScormRuntime } from '../runtime'
import type { ContentManifest } from '../content-manifest'

type VideoFixture = [id: string, src: string, provider: 'native' | 'youtube' | 'vimeo']

function assignVideos(manifest: ContentManifest, byPage: Record<string, VideoFixture[]>): void {
  Object.values(manifest.pages).forEach((page) => {
    const videos = byPage[page.id]
    if (videos) {
      page.videos = Object.fromEntries(
        videos.map(([id, src, provider], videoIndex) => [String(videoIndex), { id, src, provider }])
      )
    }
  })
}

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
              prompt: 'Private prompt',
              options: [
                {
                  value: 'red',
                  correct: true,
                  content: 'Red label'
                },
                {
                  value: 'blue',
                  correct: false,
                  content: 'Blue label'
                },
                {
                  value: 'green',
                  correct: false,
                  content: 'Green label'
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
      d: { '0.a.0': [0, 2], '1.a.0': [1] }
    })
    expect(Object.keys(encoded).sort()).toEqual(['d', 'p', 'v', 'x'])
    const serialized = JSON.stringify(encoded)
    expect(serialized).not.toMatch(/location|Private prompt|Red label|correct|red|blue|green/)
    expect(serialized).not.toContain('{"a":')
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
    assignVideos(videoManifest, {
      'page-one': [
        ['video-a', 'a.mp4', 'native'],
        ['video-b', 'https://youtu.be/abc', 'youtube'],
        ['video-c', 'c.mp4', 'native']
      ],
      'page-two': [
        ['video-d', 'd.mp4', 'native'],
        ['video-e', 'e.mp4', 'native']
      ]
    })
    const emptyState: PlayerState = { pages: {} }
    expect(encodeSuspendData(manifest, emptyState, 0)).toEqual({ v: 1, p: 0, x: '00' })
    expect(JSON.stringify(encodeSuspendData(manifest, emptyState, 0))).toBe(
      '{"v":1,"p":0,"x":"00"}'
    )
    expect(encodeSuspendData(videoManifest, emptyState, 0)).toEqual({
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
              'video-c': 0,
              'video-b': -1,
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
      d: { '0.t.0': 123, '1.t.1': 1 }
    })
    expect(encoded).not.toHaveProperty('t')
    expect(JSON.stringify(encoded)).not.toMatch(/video-a|video-b|video-c|video-d|video-e/)
    expect(decodeSuspendData(videoManifest, encoded)).toEqual({
      pages: {
        'page-one': { videos: { 'video-a': 12.3 } },
        'page-two': { videos: { 'video-e': 0.1 } }
      }
    })
    expect(encodeSuspendData(videoManifest, decodeSuspendData(videoManifest, encoded), 0)).toEqual(
      encoded
    )
    expect(
      encodeSuspendData(videoManifest, { pages: { 'page-one': { videos: { 'video-a': 0 } } } }, 0)
    ).toEqual({ v: 1, p: 0, x: '00' })
  })

  it('restores positions by page-local video indexes and ignores removed indexes', () => {
    const originalManifest = structuredClone(manifest)
    assignVideos(originalManifest, {
      'page-one': [
        ['video-a', 'a.mp4', 'native'],
        ['video-c', 'c.mp4', 'native']
      ],
      'page-two': [['video-b', 'b.mp4', 'native']]
    })
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
      '0.t.0': 11,
      '0.t.1': 33,
      '1.t.0': 22
    })
    expect(encoded).not.toHaveProperty('t')

    const updatedManifest = structuredClone(manifest)
    assignVideos(updatedManifest, {
      'page-one': [['video-b', 'b.mp4', 'native']],
      'page-two': [
        ['video-new', 'new.mp4', 'native'],
        ['video-a', 'a.mp4', 'native']
      ]
    })
    expect(decodeSuspendData(updatedManifest, encoded)).toEqual({
      pages: {
        'page-one': { videos: { 'video-b': 1.1 } },
        'page-two': { videos: { 'video-new': 2.2 } }
      }
    })

    delete updatedManifest.pages['1']
    expect(decodeSuspendData(updatedManifest, encoded)).toEqual({
      pages: { 'page-one': { videos: { 'video-b': 1.1 } } }
    })
  })

  it('decodes payloads without video data and ignores invalid or unknown video indexes', () => {
    const videoManifest = structuredClone(manifest)
    assignVideos(videoManifest, {
      'page-one': [['video-a', 'a.mp4', 'native']],
      'page-two': [['video-b', 'b.mp4', 'native']]
    })
    expect(decodeSuspendData(videoManifest, { v: 1, p: 0, x: '00' })).toEqual({ pages: {} })
    expect(
      decodeSuspendData(videoManifest, {
        v: 1,
        p: 0,
        x: '00',
        d: { '0.t.0': 15, '0.t.1': -1, '0.t.removed': 20, '0.t.2': 1.5 },
        t: { 'video-b': 25 }
      })
    ).toEqual({ pages: { 'page-one': { videos: { 'video-a': 1.5 } } } })
  })

  it('rejects non-index video dictionary keys instead of serializing semantic IDs', () => {
    const malformedManifest = structuredClone(manifest)
    malformedManifest.pages['0']!.videos = {
      'video-a': { id: 'video-a', src: 'a.mp4', provider: 'native' }
    }
    expect(
      encodeSuspendData(
        malformedManifest,
        { pages: { 'page-one': { videos: { 'video-a': 12.3 } } } },
        0
      )
    ).toEqual({ v: 1, p: 0, x: '00' })
    expect(
      decodeSuspendData(malformedManifest, {
        v: 1,
        p: 0,
        x: '00',
        d: { '0.t.video-a': 123 }
      })
    ).toEqual({ pages: {} })
  })

  it('skips non-canonical manifest page indexes so encoded flat keys stay parseable', () => {
    const malformedManifest = structuredClone(manifest)
    malformedManifest.pages['01'] = {
      id: 'page-extra',
      title: 'Extra',
      questions: {
        '0': {
          id: 'q-extra',
          prompt: '',
          type: 'single-choice',
          options: { '0': { value: 'extra-a', label: 'Extra A' } },
          correctAnswers: ['extra-a']
        }
      },
      videos: { '0': { id: 'video-extra', src: 'extra.mp4', provider: 'native' } }
    }
    const encoded = encodeSuspendData(
      malformedManifest,
      {
        pages: {
          'page-one': { answers: { q1: ['blue'] } },
          'page-extra': {
            visited: true,
            answers: { 'q-extra': 'extra-a' },
            videos: { 'video-extra': 1.5 }
          }
        }
      },
      0
    )
    // The non-canonical page index contributes no flat answer/video keys; only
    // the valid page's key survives and every emitted key is parseable.
    expect(encoded).toEqual({ v: 1, p: 0, x: '001', d: { '0.a.0': [1] } })
    expect(decodeSuspendData(malformedManifest, encoded)).toEqual({
      pages: {
        'page-one': { answers: { q1: ['blue'] } },
        'page-extra': { visited: true }
      }
    })
  })

  it('skips non-canonical manifest question indexes so answer keys stay parseable', () => {
    const malformedManifest = structuredClone(manifest)
    malformedManifest.pages['0']!.questions['01'] = {
      id: 'q-extra',
      prompt: '',
      type: 'single-choice',
      options: { '0': { value: 'extra-a', label: 'Extra A' } },
      correctAnswers: ['extra-a']
    }
    const encoded = encodeSuspendData(
      malformedManifest,
      { pages: { 'page-one': { answers: { q1: ['blue'], 'q-extra': 'extra-a' } } } },
      0
    )
    expect(encoded).toEqual({ v: 1, p: 0, x: '00', d: { '0.a.0': [1] } })
    expect(decodeSuspendData(malformedManifest, encoded)).toEqual({
      pages: { 'page-one': { answers: { q1: ['blue'] } } }
    })
  })

  it('uses current page and video indexes and ignores semantic video IDs', () => {
    const videoManifest = structuredClone(manifest)
    assignVideos(videoManifest, {
      'page-one': [['current-a', 'a.mp4', 'native']],
      'page-two': [['current-b', 'b.mp4', 'native']]
    })
    expect(
      decodeSuspendData(videoManifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          '0.t.0': 11,
          '0.t.video-a': 99,
          '1.t.0': 22
        }
      })
    ).toEqual({
      pages: {
        'page-one': { videos: { 'current-a': 1.1 } },
        'page-two': { videos: { 'current-b': 2.2 } }
      }
    })
  })

  it('ignores missing and malformed video entries without rejecting valid state', () => {
    const videoManifest = structuredClone(manifest)
    assignVideos(videoManifest, {
      'page-one': [['video-a', 'a.mp4', 'native']]
    })
    expect(
      decodeSuspendData(videoManifest, {
        v: 1,
        p: 0,
        x: '10',
        d: {
          '0.t.0': 11,
          '0.t.1': -1,
          '0.t.removed': 20,
          '0.t.2': 1.5,
          '1.t.0': 12,
          '2.t.0': 12
        }
      })
    ).toEqual({ pages: { 'page-one': { visited: true, videos: { 'video-a': 1.1 } } } })
  })

  it('keeps single answers page-local through flat v1 keys', () => {
    const singleChoiceManifest = structuredClone(manifest)
    Object.values(singleChoiceManifest.pages).forEach((page) => {
      page.questions!['0']!.type = 'single-choice'
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
      d: { '0.a.0': 1, '1.a.0': 2 }
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
        type: 'tiles',
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
      d: { '0.a.0': 1 }
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
      '{"v":0,"p":0,"x":"00"}',
      '{"v":3,"p":0,"x":"00"}',
      '{"v":1,"p":101,"x":"00"}',
      '{"v":1,"p":0,"x":"bad"}'
    ]) {
      expect(decodeSuspendData(manifest, raw)).toEqual({ pages: {} })
    }
  })

  it('does not decode the retired nested v1 layout', () => {
    // Older payloads grouped entries under `d[pageIndex] = { a, t }`. That
    // nested shape is not the supported flat layout, so no answers or video
    // positions are restored from it. Top-level progress fields stay intact.
    expect(
      decodeSuspendData(manifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          '0': { a: { '0': [0, 2] }, t: { '0': 123 } },
          '1': { a: { '0': [1] } }
        }
      })
    ).toEqual({ pages: {} })
    expect(
      decodeSuspendData(manifest, {
        v: 1,
        p: 50,
        x: '10',
        d: { '0': { a: { '0': [0, 2] } } }
      })
    ).toEqual({ pages: { 'page-one': { visited: true, completed: true } } })
  })

  it('ignores malformed answer namespaces while preserving valid progress', () => {
    for (const d of [null, [], 'invalid', 42]) {
      expect(decodeSuspendData(manifest, { v: 1, p: 0, x: '10', d })).toEqual({
        pages: { 'page-one': { visited: true } }
      })
    }
    expect(decodeSuspendData(manifest, { v: 1, p: 0, x: '00', d: { '0.a.0': 99 } })).toEqual({
      pages: {}
    })
  })

  it('ignores page, question, and option indexes outside the manifest', () => {
    expect(
      decodeSuspendData(manifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          '0.a.0': 99,
          '0.a.99': 0,
          '1.a.0': [0, 99],
          '99.a.0': 1
        }
      })
    ).toEqual({ pages: { 'page-two': { answers: { q1: ['red'] } } } })
  })

  it('ignores malformed or unknown flat v1 keys without rejecting valid entries', () => {
    const videoManifest = structuredClone(manifest)
    assignVideos(videoManifest, { 'page-one': [['video-a', 'a.mp4', 'native']] })
    expect(
      decodeSuspendData(videoManifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          // Valid entries that must survive.
          '0.t.0': 123,
          '1.a.0': [0, 99],
          // Malformed keys: wrong segment count, non-canonical indexes, bad
          // kind, unknown page, prototype keys.
          '0.a': 1,
          '0.a.0.0': 1,
          '0.a.01': 1,
          '0.a.-1': 1,
          '0.a.x': 1,
          '0.z.0': 1,
          '99.a.0': 1,
          '0.a.99': 1,
          '__proto__.a.0': 1,
          '0.t.99': 55
        }
      })
    ).toEqual({
      pages: {
        'page-one': { videos: { 'video-a': 12.3 } },
        'page-two': { answers: { q1: ['red'] } }
      }
    })
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
      d: { '1.a.0': [0, 2] }
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

  it('round-trips mixed answers and video positions through flat v1 keys', () => {
    const mixedManifest = structuredClone(manifest)
    assignVideos(mixedManifest, {
      'page-one': [['video-a', 'a.mp4', 'native']],
      'page-two': [['video-b', 'b.mp4', 'native']]
    })
    const state: PlayerState = {
      pages: {
        'page-one': {
          visited: true,
          answers: { q1: ['green', 'red'] },
          videos: { 'video-a': 12.5 }
        },
        'page-two': { answers: { q1: ['blue'] }, videos: { 'video-b': 0.06 } }
      }
    }
    const encoded = encodeSuspendData(mixedManifest, state, 50)
    expect(encoded).toEqual({
      v: 1,
      p: 50,
      x: '10',
      d: {
        '0.a.0': [0, 2],
        '0.t.0': 125,
        '1.a.0': [1],
        '1.t.0': 1
      }
    })
    const serialized = JSON.stringify(encoded)
    // Flat keys only: no nested page namespaces or nested `a`/`t` objects.
    expect(serialized).not.toContain('{"a":')
    expect(serialized).not.toContain('{"t":')
    expect(serialized).not.toContain('"d":{"0":{')
    expect(decodeSuspendData(mixedManifest, serialized)).toEqual({
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { q1: ['red', 'green'] },
          videos: { 'video-a': 12.5 }
        },
        'page-two': { answers: { q1: ['blue'] }, videos: { 'video-b': 0.1 } }
      }
    })
    expect(
      encodeSuspendData(mixedManifest, decodeSuspendData(mixedManifest, serialized), 50)
    ).toEqual(encoded)
  })

  it('omits d for states with no valid answers or video positions', () => {
    const videoManifest = structuredClone(manifest)
    assignVideos(videoManifest, { 'page-one': [['video-a', 'a.mp4', 'native']] })
    expect(
      encodeSuspendData(videoManifest, { pages: { 'page-one': { visited: true } } }, 0)
    ).toEqual({ v: 1, p: 0, x: '10' })
    expect(JSON.stringify(encodeSuspendData(manifest, { pages: {} }, 0))).not.toContain('"d"')
  })

  it('keeps flat keys smaller than an equivalent nested grouping', () => {
    const mixedManifest = structuredClone(manifest)
    assignVideos(mixedManifest, {
      'page-one': [['video-a', 'a.mp4', 'native']],
      'page-two': [['video-b', 'b.mp4', 'native']]
    })
    const state: PlayerState = {
      pages: {
        'page-one': {
          visited: true,
          answers: { q1: ['green', 'red'] },
          videos: { 'video-a': 12.5 }
        },
        'page-two': { answers: { q1: ['blue'] }, videos: { 'video-b': 0.1 } }
      }
    }
    const encoded = encodeSuspendData(mixedManifest, state, 50)
    const flat = JSON.stringify(encoded.d)
    const grouped = JSON.stringify({
      '0': { a: { '0': [0, 2] }, t: { '0': 125 } },
      '1': { a: { '0': [1] }, t: { '0': 1 } }
    })
    expect(flat.length).toBeLessThan(grouped.length)
  })

  it('rejects oversized SCORM 1.2 data without writing it, while saving location and committing', () => {
    const manyPages: ContentPackage = {
      metadata: { title: 'Large' },
      presentation: {
        type: 'tiles',
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
