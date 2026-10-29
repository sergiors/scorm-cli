import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { ContentPackage, PlayerState, VideoProvider } from '@scorm-cli/core'
import { createScoIndex } from '../sco-index'
import { decodeSuspendData, encodeSuspendData } from '../state-codec'
import { createScormRuntime } from '../runtime'
import type { ScoIndex } from '../sco-index'

type VideoFixture = [id: string, src: string, provider: VideoProvider]

function assignVideos(scoIndex: ScoIndex, byPage: Record<string, VideoFixture[]>): void {
  Object.values(scoIndex.pages).forEach((page) => {
    const videos = byPage[page.id]
    if (videos) {
      page.videos = Object.fromEntries(
        videos.map(([id, src, provider], videoIndex) => [String(videoIndex), { id, src, provider }])
      )
    }
  })
}

/** A video entry with the authored watch fields the sco index copies from content. */
type RequiredVideoFixture = [
  id: string,
  src: string,
  provider: VideoProvider,
  minWatchTime?: number,
  duration?: number
]

function assignRequiredVideos(
  scoIndex: ScoIndex,
  byPage: Record<string, RequiredVideoFixture[]>
): void {
  Object.values(scoIndex.pages).forEach((page) => {
    const videos = byPage[page.id]
    if (videos) {
      page.videos = Object.fromEntries(
        videos.map(([id, src, provider, minWatchTime, duration], videoIndex) => [
          String(videoIndex),
          {
            id,
            src,
            provider,
            ...(minWatchTime !== undefined ? { minWatchTime } : {}),
            ...(duration !== undefined ? { duration } : {})
          }
        ])
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
          revealCorrectAnswers: true,
          maxAttempts: 1,
          shuffleOptions: false,
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
const scoIndex = createScoIndex(packageContent)

describe('compact suspend-data codec', () => {
  it('encodes only compact indexes and decodes answers through the same sco index', () => {
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
    const encoded = encodeSuspendData(scoIndex, state, 50)
    expect(encoded).toEqual({
      v: 2,
      p: 50,
      x: '10',
      d: { '0.a.0.0': [0, 2], '1.a.0.0': [1] }
    })
    expect(Object.keys(encoded).sort()).toEqual(['d', 'p', 'v', 'x'])
    const serialized = JSON.stringify(encoded)
    expect(serialized).not.toMatch(/location|Private prompt|Red label|correct|red|blue|green/)
    expect(serialized).not.toContain('{"a":')
    expect(decodeSuspendData(scoIndex, serialized)).toEqual({
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
    const videoIndex = structuredClone(scoIndex)
    assignVideos(videoIndex, {
      'page-one': [
        ['video-a', 'https://vimeo.com/a', 'vimeo'],
        ['video-b', 'https://youtu.be/abc', 'youtube'],
        ['video-c', 'https://vimeo.com/c', 'vimeo']
      ],
      'page-two': [
        ['video-d', 'https://youtu.be/d', 'youtube'],
        ['video-e', 'https://youtu.be/e', 'youtube']
      ]
    })
    const emptyState: PlayerState = { pages: {} }
    expect(encodeSuspendData(scoIndex, emptyState, 0)).toEqual({ v: 2, p: 0, x: '00' })
    expect(JSON.stringify(encodeSuspendData(scoIndex, emptyState, 0))).toBe(
      '{"v":2,"p":0,"x":"00"}'
    )
    expect(encodeSuspendData(videoIndex, emptyState, 0)).toEqual({
      v: 2,
      p: 0,
      x: '00'
    })

    const encoded = encodeSuspendData(
      videoIndex,
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
      v: 2,
      p: 0,
      x: '00',
      d: { '0.t.0': 123, '1.t.1': 1 }
    })
    expect(encoded).not.toHaveProperty('t')
    expect(JSON.stringify(encoded)).not.toMatch(/video-a|video-b|video-c|video-d|video-e/)
    expect(decodeSuspendData(videoIndex, encoded)).toEqual({
      pages: {
        'page-one': { videos: { 'video-a': 12.3 } },
        'page-two': { videos: { 'video-e': 0.1 } }
      }
    })
    expect(encodeSuspendData(videoIndex, decodeSuspendData(videoIndex, encoded), 0)).toEqual(
      encoded
    )
    expect(
      encodeSuspendData(videoIndex, { pages: { 'page-one': { videos: { 'video-a': 0 } } } }, 0)
    ).toEqual({ v: 2, p: 0, x: '00' })
  })

  it('restores positions by page-local video indexes and ignores removed indexes', () => {
    const originalIndex = structuredClone(scoIndex)
    assignVideos(originalIndex, {
      'page-one': [
        ['video-a', 'https://vimeo.com/a', 'vimeo'],
        ['video-c', 'https://vimeo.com/c', 'vimeo']
      ],
      'page-two': [['video-b', 'https://youtu.be/b', 'youtube']]
    })
    const encoded = encodeSuspendData(
      originalIndex,
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

    const updatedIndex = structuredClone(scoIndex)
    assignVideos(updatedIndex, {
      'page-one': [['video-b', 'https://youtu.be/b', 'youtube']],
      'page-two': [
        ['video-new', 'https://vimeo.com/new', 'vimeo'],
        ['video-a', 'https://vimeo.com/a', 'vimeo']
      ]
    })
    expect(decodeSuspendData(updatedIndex, encoded)).toEqual({
      pages: {
        'page-one': { videos: { 'video-b': 1.1 } },
        'page-two': { videos: { 'video-new': 2.2 } }
      }
    })

    // A removed page leaves the saved two-bit visited bitmap oversized for the
    // one-page scoIndex, so every page-indexed key — the positions included —
    // is discarded instead of being trusted against the wrong page list.
    delete updatedIndex.pages['1']
    expect(decodeSuspendData(updatedIndex, encoded)).toEqual({ pages: {} })
  })

  it('decodes payloads without video data and ignores invalid or unknown video indexes', () => {
    const videoIndex = structuredClone(scoIndex)
    assignVideos(videoIndex, {
      'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo']],
      'page-two': [['video-b', 'https://youtu.be/b', 'youtube']]
    })
    expect(decodeSuspendData(videoIndex, { v: 2, p: 0, x: '00' })).toEqual({ pages: {} })
    expect(
      decodeSuspendData(videoIndex, {
        v: 2,
        p: 0,
        x: '00',
        d: { '0.t.0': 15, '0.t.1': -1, '0.t.removed': 20, '0.t.2': 1.5 },
        t: { 'video-b': 25 }
      })
    ).toEqual({ pages: { 'page-one': { videos: { 'video-a': 1.5 } } } })
  })

  it('rejects non-index video dictionary keys instead of serializing semantic IDs', () => {
    const malformedIndex = structuredClone(scoIndex)
    malformedIndex.pages['0']!.videos = {
      'video-a': { id: 'video-a', src: 'https://vimeo.com/a', provider: 'vimeo' }
    }
    expect(
      encodeSuspendData(
        malformedIndex,
        { pages: { 'page-one': { videos: { 'video-a': 12.3 } } } },
        0
      )
    ).toEqual({ v: 2, p: 0, x: '00' })
    expect(
      decodeSuspendData(malformedIndex, {
        v: 2,
        p: 0,
        x: '00',
        d: { '0.t.video-a': 123 }
      })
    ).toEqual({ pages: {} })
  })

  it('skips non-canonical sco index page indexes so encoded flat keys stay parseable', () => {
    const malformedIndex = structuredClone(scoIndex)
    malformedIndex.pages['01'] = {
      id: 'page-extra',
      title: 'Extra',
      questionnaires: {
        '0': {
          id: 'quiz-extra',
          maxAttempts: 1,
          questions: {
            '0': {
              id: 'q-extra',
              prompt: '',
              type: 'single-choice',
              options: { '0': { value: 'extra-a', label: 'Extra A' } },
              correctAnswers: ['extra-a']
            }
          }
        }
      },
      videos: { '0': { id: 'video-extra', src: 'https://vimeo.com/extra', provider: 'vimeo' } }
    }
    const encoded = encodeSuspendData(
      malformedIndex,
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
    expect(encoded).toEqual({ v: 2, p: 0, x: '001', d: { '0.a.0.0': [1] } })
    expect(decodeSuspendData(malformedIndex, encoded)).toEqual({
      pages: {
        'page-one': { answers: { q1: ['blue'] } },
        'page-extra': { visited: true }
      }
    })
  })

  it('skips non-canonical sco index question indexes so answer keys stay parseable', () => {
    const malformedIndex = structuredClone(scoIndex)
    malformedIndex.pages['0']!.questionnaires!['0']!.questions['01'] = {
      id: 'q-extra',
      prompt: '',
      type: 'single-choice',
      options: { '0': { value: 'extra-a', label: 'Extra A' } },
      correctAnswers: ['extra-a']
    }
    const encoded = encodeSuspendData(
      malformedIndex,
      { pages: { 'page-one': { answers: { q1: ['blue'], 'q-extra': 'extra-a' } } } },
      0
    )
    expect(encoded).toEqual({ v: 2, p: 0, x: '00', d: { '0.a.0.0': [1] } })
    expect(decodeSuspendData(malformedIndex, encoded)).toEqual({
      pages: { 'page-one': { answers: { q1: ['blue'] } } }
    })
  })

  it('uses current page and video indexes and ignores semantic video IDs', () => {
    const videoIndex = structuredClone(scoIndex)
    assignVideos(videoIndex, {
      'page-one': [['current-a', 'https://vimeo.com/a', 'vimeo']],
      'page-two': [['current-b', 'https://youtu.be/b', 'youtube']]
    })
    expect(
      decodeSuspendData(videoIndex, {
        v: 2,
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
    const videoIndex = structuredClone(scoIndex)
    assignVideos(videoIndex, {
      'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo']]
    })
    expect(
      decodeSuspendData(videoIndex, {
        v: 2,
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

  it('encodes single-choice answers as scalar option indexes through four-part keys', () => {
    const singleChoiceIndex = structuredClone(scoIndex)
    Object.values(singleChoiceIndex.pages).forEach((page) => {
      page.questionnaires!['0']!.questions['0']!.type = 'single-choice'
    })
    const encoded = encodeSuspendData(
      singleChoiceIndex,
      {
        pages: {
          'page-one': { answers: { q1: 'blue' } },
          'page-two': { answers: { q1: 'green' } }
        }
      },
      0
    )
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '00',
      d: { '0.a.0.0': 1, '1.a.0.0': 2 }
    })
    expect(Object.keys(encoded).sort()).toEqual(['d', 'p', 'v', 'x'])
    expect(decodeSuspendData(singleChoiceIndex, JSON.stringify(encoded))).toEqual({
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
                revealCorrectAnswers: true,
                maxAttempts: 1,
                shuffleOptions: false,
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
    const dictionary = createScoIndex(single)
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
      v: 2,
      p: 0,
      x: '1',
      d: { '0.a.0.0': 1 }
    })
    expect(encodeSuspendData(dictionary, { pages: {} }, 101)).toEqual({
      v: 2,
      p: 100,
      x: '0'
    })
    expect(decodeSuspendData(dictionary, { v: 2, p: 151, x: '1' })).toEqual({
      pages: {}
    })
    expect(decodeSuspendData(dictionary, { v: 2, p: 99, x: '1' })).toEqual({
      pages: { item: { visited: true } }
    })
  })

  it('rounds finite progress and safely handles non-finite progress', () => {
    expect(encodeSuspendData(scoIndex, { pages: {} }, 49.6).p).toBe(50)
    expect(encodeSuspendData(scoIndex, { pages: {} }, Number.NaN).p).toBe(0)
    expect(encodeSuspendData(scoIndex, { pages: {} }, Number.POSITIVE_INFINITY).p).toBe(0)

    expect(decodeSuspendData(scoIndex, { v: 2, p: 24, x: '00' })).toEqual({ pages: {} })
    expect(decodeSuspendData(scoIndex, { v: 2, p: 25, x: '00' })).toEqual({
      pages: {
        'page-one': { visited: true, completed: true }
      }
    })
  })

  it('returns a fresh state for unsupported versions including the retired v1', () => {
    for (const raw of [
      'no json',
      '{"v":0,"p":0,"x":"00"}',
      // The v2 codec supports only v2 payloads, so a retired v1 payload —
      // whatever it carried — restores nothing.
      '{"v":1,"p":0,"x":"00"}',
      '{"v":3,"p":0,"x":"00"}',
      '{"v":2,"p":101,"x":"00"}',
      '{"v":2,"p":0,"x":"bad"}'
    ]) {
      expect(decodeSuspendData(scoIndex, raw)).toEqual({ pages: {} })
    }
  })

  it('rejects v1 payloads and retired non-flat answer shapes without losing progress', () => {
    // v1 payloads grouped entries under `d[pageIndex] = { a, t }`, and v1
    // answer keys flattened questions page-locally as `page.a.question`.
    // Neither shape exists under v2, so both restore no learner data; only the
    // supported four-part `page.a.questionnaire.question` keys decode.
    expect(
      decodeSuspendData(scoIndex, {
        v: 1,
        p: 50,
        x: '10',
        d: {
          '0': { a: { '0': [0, 2] }, t: { '0': 123 } },
          '1': { a: { '0': [1] } }
        }
      })
    ).toEqual({ pages: {} })
    expect(
      decodeSuspendData(scoIndex, {
        v: 2,
        p: 50,
        x: '10',
        d: {
          '0.a.0': [0, 2],
          '0': { a: { '0.0': [0, 2] } },
          '1.a.0.0': [1]
        }
      })
    ).toEqual({
      pages: {
        'page-one': { visited: true, completed: true },
        'page-two': { answers: { q1: ['blue'] } }
      }
    })
  })

  it('ignores malformed answer namespaces while preserving valid progress', () => {
    for (const d of [null, [], 'invalid', 42]) {
      expect(decodeSuspendData(scoIndex, { v: 2, p: 0, x: '10', d })).toEqual({
        pages: { 'page-one': { visited: true } }
      })
    }
    expect(decodeSuspendData(scoIndex, { v: 2, p: 0, x: '00', d: { '0.a.0.0': 99 } })).toEqual({
      pages: {}
    })
  })

  it('ignores page, question, and option indexes outside the sco index', () => {
    expect(
      decodeSuspendData(scoIndex, {
        v: 2,
        p: 0,
        x: '00',
        d: {
          '0.a.0.0': 99,
          '0.a.0.99': 0,
          '1.a.0.0': [0, 99],
          '99.a.0.0': 1
        }
      })
    ).toEqual({ pages: { 'page-two': { answers: { q1: ['red'] } } } })
  })

  it('ignores malformed or unknown four-part keys without rejecting valid entries', () => {
    const videoIndex = structuredClone(scoIndex)
    assignVideos(videoIndex, { 'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo']] })
    expect(
      decodeSuspendData(videoIndex, {
        v: 2,
        p: 0,
        x: '00',
        d: {
          // Valid entries that must survive.
          '0.t.0': 123,
          '1.a.0.0': [0, 99],
          // Malformed keys: wrong segment counts (including the retired
          // three-part `page.a.question` answer keys, which no longer parse),
          // non-canonical indexes, bad kind, unknown page, prototype keys.
          '0.a': 1,
          '0.a.0.0.0': 1,
          '0.a.01.0': 1,
          '0.a.0.01': 1,
          '0.a.0.-1': 1,
          '0.a.0.x': 1,
          '0.a.0': 1,
          '0.z.0': 1,
          '99.a.0.0': 1,
          '0.a.0.99': 1,
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

  it('retains answers decoded before an entry that throws on a malformed sco index question', () => {
    // resolveAnswer dereferences a sco index question's options record. A
    // question persisted without one makes its d entry throw mid-pass, and the
    // decoder keeps the answers decoded before that entry instead of
    // rejecting the whole restored state.
    const malformedIndex = structuredClone(scoIndex)
    malformedIndex.pages['0']!.questionnaires!['0']!.questions['1'] = {
      id: 'q-broken',
      prompt: '',
      type: 'single-choice',
      options: undefined as unknown as Record<string, { value: string; label: string }>,
      correctAnswers: []
    }
    expect(
      decodeSuspendData(malformedIndex, {
        v: 2,
        p: 0,
        x: '00',
        d: {
          // Valid entry decoded before the malformed question's entry.
          '0.a.0.0': [1],
          // Question index 1 lacks its options record, so resolving throws.
          '0.a.0.1': 1
        }
      })
    ).toEqual({
      pages: { 'page-one': { answers: { q1: ['blue'] } } }
    })
  })

  it('uses the embedded sco index for LMS resume/save while keeping location separate', () => {
    const initial = encodeSuspendData(
      scoIndex,
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
    vm.runInNewContext(createScormRuntime(scoIndex), { window })
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
      v: 2,
      p: 0,
      x: '01',
      d: { '1.a.0.0': [0, 2] }
    })
    expect(compact).toEqual(
      encodeSuspendData(
        scoIndex,
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

  it('round-trips mixed answers and video positions through flat v2 keys', () => {
    const mixedIndex = structuredClone(scoIndex)
    assignVideos(mixedIndex, {
      'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo']],
      'page-two': [['video-b', 'https://youtu.be/b', 'youtube']]
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
    const encoded = encodeSuspendData(mixedIndex, state, 50)
    expect(encoded).toEqual({
      v: 2,
      p: 50,
      x: '10',
      d: {
        '0.a.0.0': [0, 2],
        '0.t.0': 125,
        '1.a.0.0': [1],
        '1.t.0': 1
      }
    })
    const serialized = JSON.stringify(encoded)
    // Flat keys only: no nested page namespaces or nested `a`/`t` objects.
    expect(serialized).not.toContain('{"a":')
    expect(serialized).not.toContain('{"t":')
    expect(serialized).not.toContain('"d":{"0":{')
    expect(decodeSuspendData(mixedIndex, serialized)).toEqual({
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
    expect(encodeSuspendData(mixedIndex, decodeSuspendData(mixedIndex, serialized), 50)).toEqual(
      encoded
    )
  })

  it('omits d for states with no valid answers or video positions', () => {
    const videoIndex = structuredClone(scoIndex)
    assignVideos(videoIndex, { 'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo']] })
    expect(encodeSuspendData(videoIndex, { pages: { 'page-one': { visited: true } } }, 0)).toEqual({
      v: 2,
      p: 0,
      x: '10'
    })
    expect(JSON.stringify(encodeSuspendData(scoIndex, { pages: {} }, 0))).not.toContain('"d"')
  })

  it('keeps flat keys smaller than an equivalent nested grouping', () => {
    const mixedIndex = structuredClone(scoIndex)
    assignVideos(mixedIndex, {
      'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo']],
      'page-two': [['video-b', 'https://youtu.be/b', 'youtube']]
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
    const encoded = encodeSuspendData(mixedIndex, state, 50)
    const flat = JSON.stringify(encoded.d)
    const grouped = JSON.stringify({
      '0': { a: { '0': { '0': [0, 2] } }, t: { '0': 125 } },
      '1': { a: { '0': { '0': [1] } }, t: { '0': 1 } }
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
    const largeIndex = createScoIndex(manyPages)
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
    vm.runInNewContext(createScormRuntime(largeIndex), { window })
    expect(window.scormBridge.saveState({ location: 'still-saved', pages: {} })).toBe(false)
    expect(calls).toContainEqual(['cmi.core.lesson_location', 'still-saved'])
    expect(calls.some(([key]) => key === 'cmi.suspend_data')).toBe(false)
    expect(calls.at(-1)).toEqual(['commit'])
    expect(events.some((event) => event.name === 'lms.suspend-data-too-large')).toBe(true)
  })
})

describe('accumulated video watch seconds in the suspend-data codec', () => {
  it('encodes watch seconds as flat w keys only where a requirement is authored', () => {
    const videoIndex = structuredClone(scoIndex)
    assignRequiredVideos(videoIndex, {
      'page-one': [
        ['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120],
        // No authored requirement: never a w key, whatever the state carries.
        ['video-b', 'https://youtu.be/b', 'youtube'],
        ['video-c', 'https://vimeo.com/c', 'vimeo', 25]
      ]
    })
    const state: PlayerState = {
      pages: {
        'page-one': {
          videos: { 'video-a': 41 },
          videoWatchSeconds: { 'video-a': 61.2, 'video-b': 50, 'video-c': 8.06 }
        }
      }
    }
    const encoded = encodeSuspendData(videoIndex, state, 0)
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '00',
      // The playback position and the accumulated watch time coexist as flat
      // keys. video-a's 61.2s total is capped at its authored 60s requirement.
      d: { '0.t.0': 410, '0.w.0': 600, '0.w.2': 81 }
    })
    // Semantic ids, requirements and watch wording never reach the payload.
    expect(JSON.stringify(encoded)).not.toMatch(/video-a|video-b|video-c|watch|minWatch/)

    const serialized = JSON.stringify(encoded)
    const decoded = decodeSuspendData(videoIndex, serialized)
    expect(decoded).toEqual({
      pages: {
        'page-one': {
          videos: { 'video-a': 41 },
          videoWatchSeconds: { 'video-a': 60, 'video-c': 8.1 }
        }
      }
    })
    expect(encodeSuspendData(videoIndex, decoded, 0)).toEqual(encoded)
  })

  it('caps persisted watch seconds at the authored requirement, with or without a duration', () => {
    const videoIndex = structuredClone(scoIndex)
    assignRequiredVideos(videoIndex, {
      'page-one': [
        ['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120],
        ['video-b', 'https://youtu.be/b', 'youtube', 60]
      ]
    })
    const encoded = encodeSuspendData(
      videoIndex,
      {
        pages: {
          'page-one': { videoWatchSeconds: { 'video-a': 300, 'video-b': 300 } }
        }
      },
      0
    )
    // Neither the authored duration nor its absence widens the cap: the stored
    // total never exceeds the minute the requirement asks for.
    expect(encoded).toEqual({ v: 2, p: 0, x: '00', d: { '0.w.0': 600, '0.w.1': 600 } })
    expect(decodeSuspendData(videoIndex, encoded)).toEqual({
      pages: { 'page-one': { videoWatchSeconds: { 'video-a': 60, 'video-b': 60 } } }
    })

    // A total within the cap persists at tenth-of-a-second precision.
    const precise = encodeSuspendData(
      videoIndex,
      { pages: { 'page-one': { videoWatchSeconds: { 'video-a': 45.67 } } } },
      0
    )
    expect(precise.d).toEqual({ '0.w.0': 457 })
    expect(decodeSuspendData(videoIndex, precise)).toEqual({
      pages: { 'page-one': { videoWatchSeconds: { 'video-a': 45.7 } } }
    })
  })

  it('maps watch seconds through the page-local video indexes of the current sco index', () => {
    const originalIndex = structuredClone(scoIndex)
    assignRequiredVideos(originalIndex, {
      'page-one': [
        ['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120],
        ['video-c', 'https://vimeo.com/c', 'vimeo', 25]
      ]
    })
    // Both totals stay within either requirement's cap, so the mapping, not
    // capping, is what the assertions observe.
    const encoded = encodeSuspendData(
      originalIndex,
      { pages: { 'page-one': { videoWatchSeconds: { 'video-a': 20.4, 'video-c': 8 } } } },
      0
    )
    expect(encoded.d).toEqual({ '0.w.0': 204, '0.w.1': 80 })

    const reorderedIndex = structuredClone(scoIndex)
    assignRequiredVideos(reorderedIndex, {
      'page-one': [
        ['video-c', 'https://vimeo.com/c', 'vimeo', 25],
        ['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120]
      ]
    })
    const restored = decodeSuspendData(reorderedIndex, encoded)
    expect(restored).toEqual({
      pages: { 'page-one': { videoWatchSeconds: { 'video-c': 20.4, 'video-a': 8 } } }
    })
    // The mapping is stable: re-encoding the restored state yields the same
    // indexes under the reordered scoIndex.
    expect(encodeSuspendData(reorderedIndex, restored, 0)).toEqual(encoded)

    // A page removed from the scoIndex contributes nothing.
    delete reorderedIndex.pages['0']
    expect(decodeSuspendData(reorderedIndex, encoded)).toEqual({ pages: {} })
  })

  it('ignores malformed w keys while keeping valid entries', () => {
    const videoIndex = structuredClone(scoIndex)
    assignRequiredVideos(videoIndex, {
      'page-one': [
        ['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120],
        ['video-b', 'https://youtu.be/b', 'youtube']
      ]
    })
    expect(
      decodeSuspendData(videoIndex, {
        v: 2,
        p: 0,
        x: '00',
        d: {
          // Valid entry that must survive.
          '0.w.0': 456,
          // video-b has no requirement, so its watch total is meaningless.
          '0.w.1': 45,
          '0.w.9': 99,
          '0.w.01': 1,
          '0.w.-1': 1,
          '0.w.2b': 5,
          '0.w.2': 0,
          '0.w': 1,
          '0.w.0.0': 1,
          '__proto__.w.0': 1,
          '9.w.0': 456
        }
      })
    ).toEqual({ pages: { 'page-one': { videoWatchSeconds: { 'video-a': 45.6 } } } })
  })

  it('drops page-indexed video position and watch keys when the visited bitmap is oversized', () => {
    const videoIndex = structuredClone(scoIndex)
    assignRequiredVideos(videoIndex, {
      'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120]],
      'page-two': [['video-b', 'https://youtu.be/b', 'youtube']]
    })
    const payload = {
      v: 2,
      p: 0,
      // Three pages' worth of visited bits cannot belong to a two-page
      // scoIndex, so every page-indexed key lost its meaning.
      x: '000',
      d: { '0.t.0': 410, '0.w.0': 600, '1.t.0': 220 }
    }
    // Position and watch keys alike restore nothing under an oversized bitmap.
    expect(decodeSuspendData(videoIndex, payload)).toEqual({ pages: {} })

    // The very same keys restore once the bitmap fits the page list, with the
    // watch total still capped at the requirement and every index honored.
    expect(
      decodeSuspendData(videoIndex, {
        ...payload,
        x: '00'
      })
    ).toEqual({
      pages: {
        'page-one': { videos: { 'video-a': 41 }, videoWatchSeconds: { 'video-a': 60 } },
        'page-two': { videos: { 'video-b': 22 } }
      }
    })
  })

  it('keeps payloads without watch seconds decoding while watch seconds stay absent', () => {
    const videoIndex = structuredClone(scoIndex)
    assignRequiredVideos(videoIndex, {
      'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120]]
    })
    // A payload without any `w` key decodes its position and never fabricates
    // accumulated watch time.
    expect(decodeSuspendData(videoIndex, { v: 2, p: 0, x: '00', d: { '0.t.0': 410 } })).toEqual({
      pages: { 'page-one': { videos: { 'video-a': 41 } } }
    })

    // Old renderer state that carried the previous `watchedVideos` frontier
    // field contributes nothing to the new flat keys, whatever it carries.
    const legacyIndex = structuredClone(scoIndex)
    assignVideos(legacyIndex, { 'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo']] })
    const legacyState = {
      pages: {
        'page-one': {
          // `watchedVideos` predates the accumulated model and is no longer a
          // declared page field, so the codec must overlook it entirely.
          watchedVideos: { 'video-a': 61.2 }
        }
      }
    } as unknown as PlayerState
    expect(encodeSuspendData(legacyIndex, legacyState, 0)).toEqual({ v: 2, p: 0, x: '00' })
    expect(decodeSuspendData(legacyIndex, { v: 2, p: 0, x: '00', d: { '0.w.0': 456 } })).toEqual({
      pages: {}
    })
  })

  it('carries accumulated watch seconds through the embedded LMS runtime', () => {
    const videoIndex = structuredClone(scoIndex)
    assignRequiredVideos(videoIndex, {
      'page-one': [['video-a', 'https://vimeo.com/a', 'vimeo', 60, 120]]
    })
    const initial = encodeSuspendData(
      videoIndex,
      {
        pages: {
          'page-one': {
            videos: { 'video-a': 41 },
            videoWatchSeconds: { 'video-a': 61.2 }
          }
        }
      },
      0
    )
    const values: Record<string, string> = {
      'cmi.suspend_data': JSON.stringify(initial),
      'cmi.core.lesson_location': 'page:resume'
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
    vm.runInNewContext(createScormRuntime(videoIndex), { window })

    // A resume restores the position and its accumulated watch time together,
    // with the total capped at the authored requirement.
    expect(window.scormBridge.getResumeState()).toEqual({
      location: 'page:resume',
      pages: {
        'page-one': {
          videos: { 'video-a': 41 },
          videoWatchSeconds: { 'video-a': 60 }
        }
      }
    })

    // A save writes both flat keys and never leaks the semantic video id; a
    // total beyond the requirement persists capped, not rewritten.
    expect(
      window.scormBridge.saveState({
        location: 'page:next',
        pages: {
          'page-one': {
            videos: { 'video-a': 55 },
            videoWatchSeconds: { 'video-a': 75 }
          }
        }
      })
    ).toBe(true)
    const compact = JSON.parse(values['cmi.suspend_data']!)
    expect(compact).toEqual({
      v: 2,
      p: 0,
      x: '00',
      d: { '0.t.0': 550, '0.w.0': 600 }
    })
    expect(JSON.stringify(compact)).not.toMatch(/video-a|watch/)
  })
})

describe('questionnaire attempt history in the suspend-data codec', () => {
  const attemptContent: ContentPackage = {
    metadata: { title: 'Attempts' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'alpha',
          source: 'alpha.mdx',
          metadata: { title: 'Alpha' },
          content: [
            {
              type: 'questionnaire',
              id: 'quiz-a',
              contributesToScore: true,
              revealCorrectAnswers: true,
              maxAttempts: 3,
              shuffleOptions: false,
              questions: [
                {
                  type: 'question',
                  id: 'qa1',
                  questionType: 'single-choice',
                  prompt: '',
                  options: [{ value: 'yes', correct: true, content: '' }]
                },
                {
                  type: 'question',
                  id: 'qa2',
                  questionType: 'single-choice',
                  prompt: '',
                  options: [{ value: 'yes', correct: false, content: '' }]
                }
              ]
            },
            {
              type: 'questionnaire',
              id: 'quiz-b',
              contributesToScore: true,
              revealCorrectAnswers: true,
              maxAttempts: 2,
              shuffleOptions: false,
              questions: [
                {
                  type: 'question',
                  id: 'qb1',
                  questionType: 'single-choice',
                  prompt: '',
                  options: [{ value: 'yes', correct: false, content: '' }]
                }
              ]
            },
            {
              // The authored cap of -1 grants unlimited submissions, so no
              // history length can exceed it.
              type: 'questionnaire',
              id: 'quiz-u',
              contributesToScore: true,
              revealCorrectAnswers: true,
              maxAttempts: -1,
              shuffleOptions: false,
              questions: [
                {
                  type: 'question',
                  id: 'qu1',
                  questionType: 'single-choice',
                  prompt: '',
                  options: [{ value: 'yes', correct: true, content: '' }]
                },
                {
                  type: 'question',
                  id: 'qu2',
                  questionType: 'single-choice',
                  prompt: '',
                  options: [{ value: 'yes', correct: false, content: '' }]
                }
              ]
            }
          ]
        },
        {
          type: 'page',
          id: 'beta',
          source: 'beta.mdx',
          metadata: { title: 'Beta' },
          content: [
            {
              // The parser normalizes the single-attempt default to an explicit
              // cap of one, which the sco index records unchanged.
              type: 'questionnaire',
              id: 'quiz-c',
              contributesToScore: true,
              revealCorrectAnswers: true,
              maxAttempts: 1,
              shuffleOptions: false,
              questions: [
                {
                  type: 'question',
                  id: 'qc1',
                  questionType: 'single-choice',
                  prompt: '',
                  options: [{ value: 'no', correct: false, content: '' }]
                }
              ]
            }
          ]
        }
      ]
    }
  }
  const attemptIndex = createScoIndex(attemptContent)

  it('round-trips active stepper questions as questionnaire-local indexes', () => {
    const state: PlayerState = {
      pages: {
        alpha: {
          activeQuestionnaireItems: {
            // quiz-a is questionnaire index 0; select its second local question.
            'quiz-a': 'qa2',
            // quiz-b is questionnaire index 1; index zero is meaningful.
            'quiz-b': 'qb1'
          }
        }
      }
    }
    const encoded = encodeSuspendData(attemptIndex, state, 0)
    expect(encoded).toEqual({ v: 2, p: 0, x: '00', d: { '0.i.0': 1, '0.i.1': 0 } })
    expect(decodeSuspendData(attemptIndex, JSON.stringify(encoded))).toEqual(state)
    expect(encodeSuspendData(attemptIndex, decodeSuspendData(attemptIndex, encoded), 0)).toEqual(
      encoded
    )
  })

  it('omits unknown active questions and ignores invalid or out-of-range active indexes', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            activeQuestionnaireItems: {
              'quiz-a': 'question:removed',
              'quiz-b': 'qa1',
              'quiz-u': 'qu1'
            }
          }
        }
      },
      0
    )
    expect(encoded).toEqual({ v: 2, p: 0, x: '00', d: { '0.i.2': 0 } })

    expect(
      decodeSuspendData(attemptIndex, {
        v: 2,
        p: 0,
        x: '00',
        d: {
          '0.i.0': 2, // quiz-a has only local positions 0 and 1.
          '0.i.1': 1, // quiz-b has only local position 0.
          '0.i.2': -1,
          '0.i.3': 0,
          '0.i.01': 0,
          '0.i.1.0': 0
        }
      })
    ).toEqual({ pages: {} })
  })

  it('encodes attempt histories and active retries as page-local q/r keys', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            visited: true,
            questionnaireAttempts: { 'quiz-a': [1, 0], 'quiz-b': [0] },
            activeQuestionnaireRetries: ['quiz-a']
          },
          beta: { questionnaireAttempts: { 'quiz-c': [1] } }
        }
      },
      0
    )
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '10',
      d: {
        '0.q.0': [1, 0],
        '0.r.0': 1,
        '0.q.1': [0],
        '1.q.0': [1]
      }
    })
    // Attempt counts travel as bare point counts; questionnaire or page ids
    // must never appear in the persisted payload.
    expect(JSON.stringify(encoded)).not.toMatch(/quiz-[abc]|Attempts|Alpha|Beta/)
  })

  it('round-trips a retry-in-progress payload back into the same semantic state', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            visited: true,
            questionnaireAttempts: { 'quiz-a': [1, 0], 'quiz-b': [0] },
            activeQuestionnaireRetries: ['quiz-a']
          },
          beta: { questionnaireAttempts: { 'quiz-c': [1] } }
        }
      },
      0
    )
    const restored = decodeSuspendData(attemptIndex, JSON.stringify(encoded))
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-a': [1, 0], 'quiz-b': [0] },
          activeQuestionnaireRetries: ['quiz-a']
        },
        beta: { questionnaireAttempts: { 'quiz-c': [1] } }
      }
    })
    expect(encodeSuspendData(attemptIndex, restored, 0)).toEqual(encoded)
  })

  it('encodes a retry flag only when the history still has an attempt left', () => {
    // quiz-b's history already fills its cap of two, so it keeps its q entry
    // but the stale retry flag must not be persisted.
    const atCap = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            questionnaireAttempts: { 'quiz-b': [0, 0] },
            activeQuestionnaireRetries: ['quiz-b']
          }
        }
      },
      0
    )
    expect(atCap).toEqual({ v: 2, p: 0, x: '00', d: { '0.q.1': [0, 0] } })

    // A retry marker without a recorded attempt history carries nothing.
    expect(
      encodeSuspendData(
        attemptIndex,
        { pages: { alpha: { activeQuestionnaireRetries: ['quiz-a'] } } },
        0
      )
    ).toEqual({ v: 2, p: 0, x: '00' })
  })

  it('encodes unlimited histories without a length cap and keeps their retry flag', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            visited: true,
            // Six entries far exceed any finite cap, yet quiz-u is unlimited.
            questionnaireAttempts: { 'quiz-u': [1, 0, 2, 1, 0, 1] },
            // An unlimited cap always leaves another attempt, so the retry
            // flag persists beside the long history.
            activeQuestionnaireRetries: ['quiz-u']
          }
        }
      },
      0
    )
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '10',
      d: { '0.q.2': [1, 0, 2, 1, 0, 1], '0.r.2': 1 }
    })

    // The per-entry point bound still applies under an unlimited cap: a count
    // above quiz-u's question count makes the history unusable.
    const overCount = encodeSuspendData(
      attemptIndex,
      { pages: { alpha: { questionnaireAttempts: { 'quiz-u': [0, 3] } } } },
      0
    )
    expect(overCount.d?.['0.q.2']).toBeUndefined()
  })

  it('encodes unlimited completion markers and never their retry flag', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            visited: true,
            questionnaireAttempts: { 'quiz-u': [2, 1, 0, 2, 1] },
            completedQuestionnaires: ['quiz-u'],
            // A completed questionnaire can no longer be retried, unlimited
            // or not, so beside the completion no r key may persist.
            activeQuestionnaireRetries: ['quiz-u']
          }
        }
      },
      0
    )
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '10',
      d: { '0.q.2': [2, 1, 0, 2, 1], '0.c.2': 1 }
    })

    const restored = decodeSuspendData(attemptIndex, JSON.stringify(encoded))
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-u': [2, 1, 0, 2, 1] },
          completedQuestionnaires: ['quiz-u']
        }
      }
    })
    // The completion round-trips back into the very same payload.
    expect(encodeSuspendData(attemptIndex, restored, 0)).toEqual(encoded)
  })

  it('restores unlimited histories with the retry available beyond any finite cap', () => {
    const restored = decodeSuspendData(attemptIndex, {
      v: 2,
      p: 0,
      x: '10',
      d: {
        // Six entries far exceed quiz-a's cap of three, but quiz-u is
        // unlimited, so its long history restores under its semantic id.
        '0.q.2': [1, 0, 2, 1, 0, 2],
        // An unlimited cap always leaves another attempt, so the retry marker
        // is restored and the questionnaire stays editable.
        '0.r.2': 1,
        // quiz-a keeps its finite cap: five entries exceed it and the whole
        // entry restores nothing.
        '0.q.0': [1, 0, 1, 0, 0]
      }
    })
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-u': [1, 0, 2, 1, 0, 2] },
          activeQuestionnaireRetries: ['quiz-u']
        }
      }
    })

    // A stale retry beside a completed unlimited questionnaire is dropped.
    const completed = decodeSuspendData(attemptIndex, {
      v: 2,
      p: 0,
      x: '10',
      d: { '0.q.2': [1], '0.c.2': 1, '0.r.2': 1 }
    })
    expect(completed).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-u': [1] },
          completedQuestionnaires: ['quiz-u']
        }
      }
    })
  })

  it('skips histories that violate the attempt bounds instead of clamping them', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            questionnaireAttempts: {
              'quiz-a': [1, 0, 1, 0], // Four entries exceed maxAttempts 3.
              'quiz-b': [2], // The count exceeds quiz-b's single question.
              'quiz-c': [1] // quiz-c is not owned by this page.
            },
            activeQuestionnaireRetries: ['quiz-a', 'quiz-c']
          },
          beta: {
            questionnaireAttempts: {
              'quiz-a': [1], // quiz-a is not owned by this page.
              'quiz-c': [1.5] // A partial attempt count is not a point count.
            }
          }
        }
      },
      0
    )
    // Nothing survives validation, so no data section is emitted at all.
    expect(encoded).toEqual({ v: 2, p: 0, x: '00' })
  })

  it('skips questionnaires whose sco index bounds are not usable', () => {
    const unusable = structuredClone(attemptIndex)
    // An unusable authored cap is skipped outright, and so is a questionnaire
    // whose nested questions dictionary is missing: without question entries
    // there is no question count to bound an attempt history against.
    unusable.pages['0']!.questionnaires!['0']!.maxAttempts = 0
    const quizC = unusable.pages['1']!.questionnaires!['0']!
    delete (quizC as { questions?: unknown }).questions
    expect(
      encodeSuspendData(
        unusable,
        {
          pages: {
            alpha: { questionnaireAttempts: { 'quiz-a': [1] } },
            beta: { questionnaireAttempts: { 'quiz-c': [1] } }
          }
        },
        0
      )
    ).toEqual({ v: 2, p: 0, x: '00' })

    // A non-record nested questions dictionary is boundless in the same way.
    const nonRecord = structuredClone(attemptIndex)
    const nonRecordQuizC = nonRecord.pages['1']!.questionnaires!['0']!
    nonRecordQuizC.questions = [] as unknown as typeof nonRecordQuizC.questions
    expect(
      encodeSuspendData(
        nonRecord,
        { pages: { beta: { questionnaireAttempts: { 'quiz-c': [1] } } } },
        0
      )
    ).toEqual({ v: 2, p: 0, x: '00' })

    // A usable nested questions dictionary derives the bound from its own
    // entries: quiz-c owns a single question, so a history holding one point
    // count persists, while a count of two exceeds the derived bound.
    expect(
      encodeSuspendData(
        attemptIndex,
        { pages: { beta: { questionnaireAttempts: { 'quiz-c': [1] } } } },
        0
      )
    ).toEqual({ v: 2, p: 0, x: '00', d: { '1.q.0': [1] } })
    expect(
      encodeSuspendData(
        attemptIndex,
        { pages: { beta: { questionnaireAttempts: { 'quiz-c': [2] } } } },
        0
      )
    ).toEqual({ v: 2, p: 0, x: '00' })

    // A non-canonical questionnaire index also contributes no flat key.
    const malformed = structuredClone(attemptIndex)
    malformed.pages['0']!.questionnaires!['00'] = {
      id: 'quiz-x',
      maxAttempts: 2,
      questions: {
        '0': {
          id: 'qx',
          prompt: '',
          type: 'single-choice',
          options: {},
          correctAnswers: []
        }
      }
    }
    expect(
      encodeSuspendData(
        malformed,
        { pages: { alpha: { questionnaireAttempts: { 'quiz-x': [1], 'quiz-b': [0] } } } },
        0
      )
    ).toEqual({ v: 2, p: 0, x: '00', d: { '0.q.1': [0] } })
  })

  it('restores attempts under semantic ids and drops retries without attempts left', () => {
    const restored = decodeSuspendData(attemptIndex, {
      v: 2,
      p: 0,
      x: '10',
      d: {
        '0.q.0': [2, 1],
        '0.r.0': 1,
        '0.q.1': [0, 0],
        // quiz-b's history fills its cap, so this stale retry is not restored.
        '0.r.1': 1,
        '1.q.0': [0],
        // Only the exact retry flag 1 is meaningful.
        '1.r.0': 2
      }
    })
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-a': [2, 1], 'quiz-b': [0, 0] },
          activeQuestionnaireRetries: ['quiz-a']
        },
        beta: { questionnaireAttempts: { 'quiz-c': [0] } }
      }
    })
  })

  it('restores attempt histories before r/c markers regardless of payload key order', () => {
    // Suspend data travels as a JSON string, so a marker key can legitimately
    // precede the q entry carrying its questionnaire's history. Marker
    // resolution must observe that history all the same: the decoder may not
    // rely on q keys arriving first for restoration to succeed.
    const restored = decodeSuspendData(
      attemptIndex,
      JSON.stringify({
        v: 2,
        p: 0,
        x: '10',
        d: {
          // Both markers precede every q entry of their questionnaire.
          '0.r.0': 1,
          '0.c.2': 1,
          '0.q.0': [1, 0],
          '0.q.2': [1]
        }
      })
    )
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-a': [1, 0], 'quiz-u': [1] },
          activeQuestionnaireRetries: ['quiz-a'],
          completedQuestionnaires: ['quiz-u']
        }
      }
    })
  })

  it('ignores malformed q/r keys while preserving valid attempt entries', () => {
    const restored = decodeSuspendData(attemptIndex, {
      v: 2,
      p: 0,
      x: '10',
      d: {
        // Valid entries that must survive.
        '0.q.0': [1],
        // An over-cap count for quiz-c (one question) is rejected per entry.
        '1.q.0': [2],
        // Malformed keys: non-canonical or out-of-range questionnaire indexes,
        // wrong segment counts, unknown kinds, unknown pages, prototype keys.
        '0.q.01': [1],
        '0.q.-1': [1],
        '0.q.9': [1],
        '0.q': 1,
        '0.q.0.0': 1,
        // Invalid: only an exact flag of 1 with a restored attempt history is
        // meaningful, and quiz-c has no attempt history in this payload.
        '0.w.0': [1],
        '99.q.0': [1],
        '__proto__.q.0': 1,
        '1.r.0': 1,
        // An empty history cannot restore attempts.
        '0.q.1': []
      }
    })
    expect(restored).toEqual({
      pages: { alpha: { visited: true, questionnaireAttempts: { 'quiz-a': [1] } } }
    })
  })

  it('drops page-indexed attempts when the visited bitmap is oversized', () => {
    // A three-bit visited string cannot belong to a two-page scoIndex, so its
    // page-indexed q/r/c data is meaningless and restores nothing.
    expect(
      decodeSuspendData(attemptIndex, {
        v: 2,
        p: 0,
        x: '100',
        d: { '0.q.0': [1], '0.r.0': 1, '0.c.0': 1 }
      })
    ).toEqual({ pages: {} })
  })

  it('encodes completion with the history and never a stale retry flag', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            visited: true,
            questionnaireAttempts: { 'quiz-a': [1, 0] },
            completedQuestionnaires: ['quiz-a'],
            // A completed questionnaire can no longer be retried, so an active
            // retry marker beside the completion must not persist an r key.
            activeQuestionnaireRetries: ['quiz-a']
          },
          beta: { questionnaireAttempts: { 'quiz-c': [1] } }
        }
      },
      0
    )
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '10',
      d: {
        '0.q.0': [1, 0],
        '0.c.0': 1,
        '1.q.0': [1]
      }
    })

    // A still-pending questionnaire keeps its retry flag instead of the
    // completion marker.
    const stillPending = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            questionnaireAttempts: { 'quiz-b': [0] },
            activeQuestionnaireRetries: ['quiz-b']
          }
        }
      },
      0
    )
    expect(stillPending).toEqual({
      v: 2,
      p: 0,
      x: '00',
      d: { '0.q.1': [0], '0.r.1': 1 }
    })
  })

  it('round-trips a completed decision back into the same semantic state', () => {
    const encoded = encodeSuspendData(
      attemptIndex,
      {
        pages: {
          alpha: {
            visited: true,
            questionnaireAttempts: { 'quiz-a': [1, 0] },
            completedQuestionnaires: ['quiz-a']
          },
          beta: { questionnaireAttempts: { 'quiz-c': [0] } }
        }
      },
      0
    )
    const restored = decodeSuspendData(attemptIndex, JSON.stringify(encoded))
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-a': [1, 0] },
          completedQuestionnaires: ['quiz-a']
        },
        beta: { questionnaireAttempts: { 'quiz-c': [0] } }
      }
    })
    expect(encodeSuspendData(attemptIndex, restored, 0)).toEqual(encoded)
  })

  it('restores separate completion markers for each questionnaire index', () => {
    // quiz-a's result completed after a better retry while quiz-b's single
    // attempt completed immediately; each marker is page-local and keyed by its
    // own questionnaire index.
    const restored = decodeSuspendData(attemptIndex, {
      v: 2,
      p: 0,
      x: '10',
      d: {
        '0.q.0': [1, 2],
        '0.c.0': 1,
        '0.q.1': [0],
        '0.c.1': 1
      }
    })
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-a': [1, 2], 'quiz-b': [0] },
          completedQuestionnaires: ['quiz-a', 'quiz-b']
        }
      }
    })
    // Re-encoding emits one c flag per completed questionnaire.
    expect(encodeSuspendData(attemptIndex, restored, 0)).toEqual({
      v: 2,
      p: 0,
      x: '10',
      d: {
        '0.q.0': [1, 2],
        '0.c.0': 1,
        '0.q.1': [0],
        '0.c.1': 1
      }
    })

    // One pending questionnaire keeps the page's other completion intact.
    const oneCompleted = { ...restored }
    oneCompleted.pages = { ...restored.pages }
    oneCompleted.pages.alpha = {
      visited: true,
      questionnaireAttempts: { 'quiz-a': [1, 2], 'quiz-b': [0] },
      completedQuestionnaires: ['quiz-a']
    }
    expect(encodeSuspendData(attemptIndex, oneCompleted, 0)).toEqual({
      v: 2,
      p: 0,
      x: '10',
      d: {
        '0.q.0': [1, 2],
        '0.c.0': 1,
        '0.q.1': [0]
      }
    })
  })

  it('decodes completion markers only with a restored history and no retry', () => {
    const restored = decodeSuspendData(attemptIndex, {
      v: 2,
      p: 0,
      x: '10',
      d: {
        '0.q.0': [2, 1],
        '0.c.0': 1,
        // A completed questionnaire is never retried, so this stale flag is
        // not restored beside the completion.
        '0.r.0': 1,
        // quiz-c stays pending: it carries no completion marker.
        '1.q.0': [0]
      }
    })
    expect(restored).toEqual({
      pages: {
        alpha: {
          visited: true,
          questionnaireAttempts: { 'quiz-a': [2, 1] },
          completedQuestionnaires: ['quiz-a']
        },
        beta: { questionnaireAttempts: { 'quiz-c': [0] } }
      }
    })
  })

  it('ignores completion markers without history or usable questionnaire bounds', () => {
    expect(
      decodeSuspendData(attemptIndex, {
        v: 2,
        p: 0,
        x: '10',
        d: {
          // Completion requires a restored attempt history: without one the
          // marker restores nothing, like any other malformed c key.
          '0.c.0': 1,
          '0.c.9': 1,
          '0.c.00': 1,
          '99.c.0': 1,
          '0.c.1': 2,
          '0.c': 1
        }
      })
    ).toEqual({ pages: { alpha: { visited: true } } })

    // The marker also follows the questionnaire's sco index bounds: an
    // unusable authored cap or an unusable nested questions dictionary is
    // never completable.
    const unusable = structuredClone(attemptIndex)
    // An unusable authored cap is skipped outright, and so is a questionnaire
    // whose nested questions dictionary is not a record, leaving no question
    // count to validate any restored history against.
    unusable.pages['0']!.questionnaires!['0']!.maxAttempts = 0
    const unusableQuizC = unusable.pages['1']!.questionnaires!['0']!
    unusableQuizC.questions = [] as unknown as typeof unusableQuizC.questions
    expect(
      decodeSuspendData(unusable, {
        v: 2,
        p: 0,
        x: '10',
        d: { '0.q.0': [1], '0.c.0': 1, '1.q.0': [1], '1.c.0': 1 }
      })
    ).toEqual({ pages: { alpha: { visited: true } } })
  })
})

describe('shuffle seed in the suspend-data codec', () => {
  it.each([0, 1, 4294967295, 2 ** 53 - 1])(
    'encodes a non-negative safe-integer seed under root s (%i)',
    (shuffleSeed) => {
      const encoded = encodeSuspendData(scoIndex, { pages: {}, shuffleSeed }, 0)
      expect(encoded).toEqual({ v: 2, p: 0, x: '00', s: shuffleSeed })
      // The seed is one flat root field: no per-question permutation data and
      // no extra keys beyond the compact payload layout.
      expect(Object.keys(encoded).sort()).toEqual(['p', 's', 'v', 'x'])
    }
  )

  it.each([-1, 1.5, 2 ** 53, Number.NaN, '1'])(
    'omits root s for an invalid seed (%p) without touching the rest of the payload',
    (shuffleSeed) => {
      const encoded = encodeSuspendData(
        scoIndex,
        {
          pages: { 'page-one': { visited: true } },
          shuffleSeed: shuffleSeed as PlayerState['shuffleSeed']
        },
        0
      )
      expect(encoded).toEqual({ v: 2, p: 0, x: '10' })
      expect(Object.keys(encoded).sort()).toEqual(['p', 'v', 'x'])
    }
  )

  it('encodes no root s when the state carries no seed, like before the option existed', () => {
    expect(encodeSuspendData(scoIndex, { pages: {} }, 0)).toEqual({ v: 2, p: 0, x: '00' })
  })

  it('decodes a safe-integer root s back into the restored state', () => {
    const decoded = decodeSuspendData(scoIndex, JSON.stringify({ v: 2, p: 0, x: '10', s: 7 }))
    expect(decoded.shuffleSeed).toBe(7)
    expect(decoded.pages).toEqual({ 'page-one': { visited: true } })
  })

  it.each([[-7], [7.5], [2 ** 53], ['7'], [null]])(
    'ignores an invalid root s (%p) but still restores the rest of the payload',
    (s) => {
      const decoded = decodeSuspendData(scoIndex, {
        v: 2,
        p: 0,
        x: '10',
        s,
        d: { '0.a.0.0': 1 }
      })
      expect(decoded).not.toHaveProperty('shuffleSeed')
      // Invalid seed values never change the meaning of the payload fields.
      expect(decoded.pages).toEqual({
        'page-one': { visited: true, answers: { q1: ['blue'] } }
      })
    }
  )

  it('round-trips a seed and authored option indexes without persisting any order', () => {
    const state: PlayerState = {
      shuffleSeed: 1234567890,
      pages: {
        'page-one': { visited: true, answers: { q1: ['green', 'red'] } }
      }
    }
    const encoded = encodeSuspendData(scoIndex, state, 0)

    // Answers stay authored-order option indexes (red=0, green=2), in authored
    // index order, regardless of the shuffled display order a renderer may draw
    // them in or the selection order the learner toggled, and the seed travels
    // as its own root field.
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '10',
      s: 1234567890,
      d: { '0.a.0.0': [0, 2] }
    })
    const encodedText = JSON.stringify(encoded)
    expect(encodedText).not.toContain('shuffle')
    expect(encodedText).not.toContain('green')

    const decoded = decodeSuspendData(scoIndex, JSON.stringify(encoded))
    expect(decoded.shuffleSeed).toBe(1234567890)
    // Selection restores by authored sco index order, never by the persisted or
    // displayed sequence.
    expect(decoded.pages).toEqual({
      'page-one': { visited: true, answers: { q1: ['red', 'green'] } }
    })
  })
})
