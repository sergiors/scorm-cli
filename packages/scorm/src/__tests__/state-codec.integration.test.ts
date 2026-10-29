import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import type {
  ContentPackage,
  PlayerState,
  QuestionNode,
  QuestionOption,
  QuestionType
} from '@scorm-cli/core'
import { createScoIndex } from '../sco-index'
import { browserCodecSource, decodeSuspendData, encodeSuspendData } from '../state-codec'
import { createScormRuntime } from '../runtime'

function option(value: string, label: string): QuestionOption {
  return {
    value,
    correct: false,
    content: label
  }
}

function question(
  id: string,
  questionType: QuestionType,
  options: Array<[value: string, label: string]>
): QuestionNode {
  return {
    type: 'question',
    id,
    questionType,
    prompt: '',
    options: options.map(([value, label]) => option(value, label))
  }
}

function questionnaire(id: string, questions: QuestionNode[]) {
  return {
    type: 'questionnaire' as const,
    id,
    contributesToScore: true,
    revealCorrectAnswers: true,
    maxAttempts: 1,
    shuffleOptions: false,
    questions
  }
}

// Mirrors what the parser produces for authored Question components: option
// indexes follow source order, which is deliberately not alphabetical here.
const content: ContentPackage = {
  metadata: { title: 'Codec integration' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page-0',
        source: '0.mdx',
        metadata: { title: 'Zero' },
        content: []
      },
      {
        type: 'page',
        id: 'page-1',
        source: '1.mdx',
        metadata: { title: 'One' },
        content: []
      },
      {
        type: 'page',
        id: 'page-2',
        source: '2.mdx',
        metadata: { title: 'Two' },
        content: []
      },
      {
        type: 'page',
        id: 'page-3',
        source: '3.mdx',
        metadata: { title: 'Three' },
        content: [
          questionnaire('quiz-3', [
            question('q-3-multi', 'multiple-choice', [
              ['zebra', 'Zebra'],
              ['mango', 'Mango'],
              ['apple', 'Apple']
            ]),
            question('q-3-single', 'single-choice', [
              ['beta', 'Beta'],
              ['alpha', 'Alpha']
            ])
          ])
        ]
      },
      {
        type: 'page',
        id: 'page-4',
        source: '4.mdx',
        metadata: { title: 'Four' },
        content: [
          questionnaire('quiz-4', [
            question('q-4-single', 'single-choice', [
              ['gamma', 'Gamma'],
              ['delta', 'Delta']
            ])
          ])
        ]
      }
    ]
  }
}

const scoIndex = createScoIndex(content)

// The target flat v2 shape: page 3 holds a multiple-choice answer (array) at
// question index 0 and a single-choice answer (scalar) at index 1 — both inside
// questionnaire index 0; page 4 holds a scalar at questionnaire-local index 0.
// Answer keys are `<pageIndex>.a.<questionnaireIndex>.<questionIndex>`.
const compact = {
  v: 2,
  p: 0,
  x: '00000',
  d: { '3.a.0.0': [1], '3.a.0.1': 1, '4.a.0.0': 0 }
}

// A complete persisted payload: answers match `compact`, but progress is 100%
// and every one of the five pages is flagged visited.
const supplied = {
  v: 2,
  p: 100,
  x: '11111',
  d: { '3.a.0.0': [1], '3.a.0.1': 1, '4.a.0.0': 0 }
}

const selected: PlayerState = {
  pages: {
    'page-3': { answers: { 'q-3-multi': ['mango'], 'q-3-single': 'alpha' } },
    'page-4': { answers: { 'q-4-single': 'gamma' } }
  }
}

const restored: PlayerState = {
  pages: {
    'page-3': { answers: { 'q-3-multi': ['mango'], 'q-3-single': 'alpha' } },
    'page-4': { answers: { 'q-4-single': 'gamma' } }
  }
}

const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown

describe('suspend-data codec integration', () => {
  it('maps authored option order into sco index indexes without sorting values', () => {
    expect(scoIndex.pages['3']!.questionnaires!['0']!.questions['0']!.options).toEqual({
      '0': { value: 'zebra', label: 'Zebra' },
      '1': { value: 'mango', label: 'Mango' },
      '2': { value: 'apple', label: 'Apple' }
    })
    expect(scoIndex.pages['3']!.questionnaires!['0']!.questions['1']!.options).toEqual({
      '0': { value: 'beta', label: 'Beta' },
      '1': { value: 'alpha', label: 'Alpha' }
    })
    // Index 1 is the authored second option, not the alphabetically first value.
    expect(scoIndex.pages['3']!.questionnaires!['0']!.questions['0']!.options['1']!.value).toBe(
      'mango'
    )
    expect(scoIndex.pages['3']!.questionnaires!['0']!.questions['0']!.options['2']!.value).toBe(
      'apple'
    )
    expect(scoIndex.pages['3']!.questionnaires!['0']!.questions['1']!.options['1']!.value).toBe(
      'alpha'
    )
  })

  it('encodes scalar vs array per question type and decodes page-local values', () => {
    const encoded = encodeSuspendData(scoIndex, selected, 0)
    expect(encoded).toEqual(compact)

    const serialized = JSON.stringify(encoded)
    // No semantic values or labels may leak into the persisted payload.
    expect(serialized).not.toMatch(/zebra|mango|apple|beta|alpha|gamma|delta/i)
    expect(encoded).not.toHaveProperty('location')

    const decoded = decodeSuspendData(scoIndex, serialized)
    expect(decoded).toEqual(restored)
    const answers3 = decoded.pages['page-3']!.answers!
    expect(Array.isArray(answers3['q-3-multi'])).toBe(true)
    expect(answers3['q-3-multi']).toEqual(['mango'])
    expect(typeof answers3['q-3-single']).toBe('string')
    expect(answers3['q-3-single']).toBe('alpha')
    expect(typeof decoded.pages['page-4']!.answers!['q-4-single']).toBe('string')
  })

  it('round-trips the target fixture for both question types', () => {
    const decoded = decodeSuspendData(scoIndex, JSON.stringify(compact))
    expect(decoded).toEqual(restored)
    expect(encodeSuspendData(scoIndex, decoded, 0)).toEqual(compact)
  })

  it('decodes the complete supplied payload through sco index option indexes', () => {
    const decoded = decodeSuspendData(scoIndex, JSON.stringify(supplied))

    // Page 3 question index 0 (inside questionnaire index 0) is the
    // multiple-choice question, so scalar/array index 1 resolves to the
    // authored second option (mango), not the alphabetically first value.
    const questions3 = scoIndex.pages['3']!.questionnaires!['0']!.questions!
    expect(questions3['0']!.type).toBe('multiple-choice')
    expect(questions3['0']!.options['1']!.value).toBe('mango')
    expect(decoded.pages['page-3']!.answers!['q-3-multi']).toEqual(['mango'])

    // Page 3 question index 1 is questionnaire-local: scalar 1 resolves to
    // alpha.
    expect(questions3['1']!.type).toBe('single-choice')
    expect(questions3['1']!.options['1']!.value).toBe('alpha')
    expect(decoded.pages['page-3']!.answers!['q-3-single']).toBe('alpha')

    // Page 4 also uses question index 0: scalar 0 resolves to gamma through its
    // own options, independent of page 3.
    expect(scoIndex.pages['4']!.questionnaires!['0']!.questions['0']!.options['0']!.value).toBe(
      'gamma'
    )
    expect(decoded.pages['page-4']!.answers!['q-4-single']).toBe('gamma')

    // p: 100 completes all five pages and x: '11111' marks each visited.
    for (const pageId of ['page-0', 'page-1', 'page-2', 'page-3', 'page-4']) {
      expect(decoded.pages[pageId]).toMatchObject({
        visited: true,
        completed: true
      })
    }
  })

  it('keeps the same question index independent across pages', () => {
    const decoded = decodeSuspendData(scoIndex, JSON.stringify(compact))
    // Both pages use question index '0', resolved through their own options.
    expect(decoded.pages['page-3']!.answers!['q-3-multi']).toEqual(['mango'])
    expect(decoded.pages['page-4']!.answers!['q-4-single']).toBe('gamma')
    expect(decoded.pages['page-3']!.answers).not.toHaveProperty('q-4-single')
    expect(decoded.pages['page-4']!.answers).not.toHaveProperty('q-3-multi')
  })

  it('matches the browser runtime codec for encode and decode', () => {
    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState
    expect(typeof browserEncode).toBe('function')
    expect(typeof browserDecode).toBe('function')

    expect(JSON.parse(browserEncode(scoIndex, selected, 0))).toEqual(
      encodeSuspendData(scoIndex, selected, 0)
    )
    expect(normalize(browserDecode(scoIndex, JSON.stringify(compact)))).toEqual(
      decodeSuspendData(scoIndex, JSON.stringify(compact))
    )
  })

  it('matches browser and Node codecs for indexed video positions', () => {
    const videoIndex = structuredClone(scoIndex)
    videoIndex.pages['3']!.videos = {
      '0': {
        id: 'video:lesson.mdx:4:1',
        src: 'https://vimeo.com/42',
        provider: 'vimeo'
      }
    }
    videoIndex.pages['4']!.videos = {
      '0': {
        id: 'video:lesson.mdx:8:1',
        src: 'https://youtu.be/abc',
        provider: 'youtube'
      }
    }
    const state: PlayerState = {
      pages: {
        'page-3': { videos: { 'video:lesson.mdx:4:1': 34.26 } },
        'page-4': { videos: { 'video:lesson.mdx:8:1': 0 } }
      }
    }
    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState

    const encoded = encodeSuspendData(videoIndex, state, 0)
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '00000',
      d: {
        '3.t.0': 343
      }
    })
    expect(encoded).not.toHaveProperty('t')
    expect(decodeSuspendData(videoIndex, encoded)).toEqual({
      pages: {
        'page-3': { videos: { 'video:lesson.mdx:4:1': 34.3 } }
      }
    })
    expect(JSON.stringify(encoded)).not.toMatch(/video:lesson\.mdx/)
    expect(JSON.parse(browserEncode(videoIndex, state, 0))).toEqual(encoded)
    expect(normalize(browserDecode(videoIndex, JSON.stringify(encoded)))).toEqual(
      decodeSuspendData(videoIndex, encoded)
    )

    const malformedVideoData = {
      v: 2,
      p: 0,
      x: '00000',
      d: {
        '3.t.0': 343,
        '3.t.1': -1,
        '3.t.2': 1.5,
        '4.t.0': null,
        '99.t.0': 500
      }
    }
    expect(normalize(browserDecode(videoIndex, JSON.stringify(malformedVideoData)))).toEqual(
      decodeSuspendData(videoIndex, malformedVideoData)
    )
    expect(decodeSuspendData(videoIndex, malformedVideoData)).toEqual({
      pages: { 'page-3': { videos: { 'video:lesson.mdx:4:1': 34.3 } } }
    })
  })

  it('matches browser and Node codecs for watch-second capping and oversized bitmaps', () => {
    const videoIndex = structuredClone(scoIndex)
    videoIndex.pages['3']!.videos = {
      '0': {
        id: 'video:lesson.mdx:3:1',
        src: 'https://vimeo.com/a',
        provider: 'vimeo',
        minWatchTime: 60,
        duration: 120
      }
    }
    const state: PlayerState = {
      pages: {
        'page-3': {
          videos: { 'video:lesson.mdx:3:1': 41 },
          videoWatchSeconds: { 'video:lesson.mdx:3:1': 300 }
        }
      }
    }
    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState

    // Both runtimes cap the persisted watch total at the authored requirement
    // beside the playback position, and restore that same cap.
    const encoded = encodeSuspendData(videoIndex, state, 0)
    expect(encoded.d).toEqual({ '3.t.0': 410, '3.w.0': 600 })
    expect(JSON.parse(browserEncode(videoIndex, state, 0))).toEqual(encoded)
    const expectedRestore = {
      pages: {
        'page-3': {
          videos: { 'video:lesson.mdx:3:1': 41 },
          videoWatchSeconds: { 'video:lesson.mdx:3:1': 60 }
        }
      }
    }
    expect(decodeSuspendData(videoIndex, encoded)).toEqual(expectedRestore)
    expect(normalize(browserDecode(videoIndex, JSON.stringify(encoded)))).toEqual(expectedRestore)

    // A visited bitmap oversized for the five-page sco index discards the same
    // indexed keys in both runtimes instead of restoring any of them.
    const oversized = { ...encoded, x: '000000' }
    expect(decodeSuspendData(videoIndex, oversized)).toEqual({ pages: {} })
    expect(normalize(browserDecode(videoIndex, JSON.stringify(oversized)))).toEqual({
      pages: {}
    })
  })

  it('keeps browser and Node behavior in parity across defaults, bounds, and malformed indexes', () => {
    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState

    const states: Array<[PlayerState, number]> = [
      [{ pages: {} }, Number.NaN],
      [
        {
          pages: {
            'page-3': {
              visited: true,
              answers: {
                'q-3-multi': ['apple', 'mango', 'unknown', 'mango'],
                'q-3-single': 'not-an-option',
                extra: 'unknown'
              }
            },
            'page-4': { answers: { 'q-4-single': 'delta' } }
          }
        },
        100.7
      ],
      [{ pages: { 'page-0': { visited: true }, 'page-4': { visited: true } } }, -10]
    ]
    for (const [state, progress] of states) {
      expect(JSON.parse(browserEncode(scoIndex, state, progress))).toEqual(
        encodeSuspendData(scoIndex, state, progress)
      )
    }

    const payloads: unknown[] = [
      undefined,
      '',
      'not-json',
      JSON.stringify({ v: 2, p: 0, x: '00000' }),
      JSON.stringify({ v: 2, p: 100, x: '11111' }),
      JSON.stringify({ v: 2, p: -1, x: '00000' }),
      JSON.stringify({ v: 2, p: 101, x: '00000' }),
      JSON.stringify({ v: 2, p: 0, x: '000000' }),
      JSON.stringify({ v: 2, p: 0, x: '10x00' }),
      // Unsupported versions — including the retired v1 — must decode to a
      // fresh state, whatever shape their payload carried.
      JSON.stringify({ v: 0, p: 0, x: '00000' }),
      JSON.stringify({ v: 1, p: 0, x: '00000' }),
      JSON.stringify({ v: 1, p: 100, x: '11111', d: { '3': { a: { '0': [0] } }, '3.t.0': 343 } }),
      JSON.stringify({ v: 3, p: 0, x: '00000' }),
      // A v2 `d` grouped under page indexes is not a supported key either.
      JSON.stringify({ v: 2, p: 0, x: '00000', d: { '3': { a: { '0': [0] } } } }),
      JSON.stringify({
        v: 2,
        p: 0,
        x: '00000',
        d: {
          '3.a.0.0': [-1, 1, 1, 2, 99, 1.5, '1'],
          '3.a.0.1': [0, 1, 99],
          '3.a.0.99': 0,
          // The retired three-part v1 answer key is no longer valid grammar.
          '3.a.0': 1,
          '4.a.0.0': 0,
          '99.a.0.0': 1,
          '3.a': 1,
          '3.a.0.01': 1,
          '3.z.0': 1,
          '3.t.0': 343
        }
      }),
      JSON.stringify({ v: 2, p: 0, x: '00000', d: null })
    ]
    for (const payload of payloads) {
      expect(normalize(browserDecode(scoIndex, payload))).toEqual(
        decodeSuspendData(scoIndex, payload)
      )
    }
  })

  it('matches browser and Node codecs for attempt history and active retries', () => {
    // Give the fixture questionnaires authored attempt caps so both runtimes
    // must apply the same history validation and retry-flag rules.
    const retryIndex = structuredClone(scoIndex)
    retryIndex.pages['3']!.questionnaires!['0']!.maxAttempts = 3
    retryIndex.pages['4']!.questionnaires!['0']!.maxAttempts = 2

    // quiz-3 is mid-retry with a valid history; quiz-4's history is at its cap.
    const retrying: PlayerState = {
      pages: {
        'page-3': {
          visited: true,
          questionnaireAttempts: { 'quiz-3': [2, 1] },
          activeQuestionnaireRetries: ['quiz-3']
        },
        'page-4': {
          questionnaireAttempts: { 'quiz-4': [0, 0] },
          activeQuestionnaireRetries: ['quiz-4']
        }
      }
    }

    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState

    const encoded = encodeSuspendData(retryIndex, retrying, 0)
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '00010',
      d: { '3.q.0': [2, 1], '3.r.0': 1, '4.q.0': [0, 0] }
    })
    expect(JSON.parse(browserEncode(retryIndex, retrying, 0))).toEqual(encoded)

    const payload = JSON.stringify({
      v: 2,
      p: 0,
      x: '00010',
      d: { '3.q.0': [2, 1], '3.r.0': 1, '4.q.0': [0, 0], '4.r.0': 1 }
    })
    const nodeRestored = decodeSuspendData(retryIndex, payload)
    expect(nodeRestored).toEqual({
      pages: {
        'page-3': {
          visited: true,
          questionnaireAttempts: { 'quiz-3': [2, 1] },
          activeQuestionnaireRetries: ['quiz-3']
        },
        'page-4': { questionnaireAttempts: { 'quiz-4': [0, 0] } }
      }
    })
    expect(normalize(browserDecode(retryIndex, payload))).toEqual(nodeRestored)

    // Both runtimes also agree on rejecting out-of-bound or malformed entries.
    const malformed = JSON.stringify({
      v: 2,
      p: 0,
      x: '00010',
      d: {
        '3.q.0': [9],
        '3.q.1': [1.5],
        '3.r.0': 1,
        '4.q.0': [],
        '4.r.0': 1,
        '99.q.0': [1],
        '3.z.0': 1
      }
    })
    expect(normalize(browserDecode(retryIndex, malformed))).toEqual(
      decodeSuspendData(retryIndex, malformed)
    )
    expect(decodeSuspendData(retryIndex, malformed)).toEqual({
      pages: { 'page-3': { visited: true } }
    })
  })

  it('matches browser and Node codecs for questionnaire-local active positions', () => {
    const state: PlayerState = {
      pages: {
        'page-3': { activeQuestionnaireItems: { 'quiz-3': 'q-3-single' } },
        'page-4': { activeQuestionnaireItems: { 'quiz-4': 'q-4-single' } }
      }
    }
    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState

    const encoded = encodeSuspendData(scoIndex, state, 0)
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '00000',
      d: { '3.i.0': 1, '4.i.0': 0 }
    })
    expect(JSON.parse(browserEncode(scoIndex, state, 0))).toEqual(encoded)

    const payload = JSON.stringify({
      v: 2,
      p: 0,
      x: '00000',
      d: {
        '3.i.0': 1,
        '4.i.0': 0,
        '3.i.1': 1, // Only questionnaire index 0 exists on page 3.
        '4.i.0.0': 0,
        '4.i.00': 0
      }
    })
    const nodeRestored = decodeSuspendData(scoIndex, payload)
    expect(nodeRestored).toEqual(state)
    expect(normalize(browserDecode(scoIndex, payload))).toEqual(nodeRestored)
  })

  it('matches browser and Node codecs for unlimited attempt histories', () => {
    // An authored cap of -1 grants unlimited attempts, so both runtimes must
    // keep long histories and always leave the questionnaire retryable.
    const unlimitedIndex = structuredClone(scoIndex)
    unlimitedIndex.pages['3']!.questionnaires!['0']!.maxAttempts = -1
    unlimitedIndex.pages['4']!.questionnaires!['0']!.maxAttempts = -1

    // quiz-3 is mid-retry with a long history; quiz-4 completed its own long
    // history while a stale retry marker sits beside the completion.
    const retrying: PlayerState = {
      pages: {
        'page-3': {
          visited: true,
          questionnaireAttempts: { 'quiz-3': [2, 1, 0, 2, 1, 2] },
          activeQuestionnaireRetries: ['quiz-3']
        },
        'page-4': {
          questionnaireAttempts: { 'quiz-4': [1, 0, 1, 1] },
          completedQuestionnaires: ['quiz-4'],
          activeQuestionnaireRetries: ['quiz-4']
        }
      }
    }

    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState

    const encoded = encodeSuspendData(unlimitedIndex, retrying, 0)
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '00010',
      d: { '3.q.0': [2, 1, 0, 2, 1, 2], '3.r.0': 1, '4.q.0': [1, 0, 1, 1], '4.c.0': 1 }
    })
    expect(JSON.parse(browserEncode(unlimitedIndex, retrying, 0))).toEqual(encoded)

    const payload = JSON.stringify({
      v: 2,
      p: 0,
      x: '00010',
      d: {
        '3.q.0': [2, 1, 0, 2, 1, 2],
        '3.r.0': 1,
        '4.q.0': [1, 0, 1, 1],
        '4.c.0': 1,
        // A completed questionnaire is never retried, unlimited or not, so
        // this stale flag restores nothing.
        '4.r.0': 1
      }
    })
    const nodeRestored = decodeSuspendData(unlimitedIndex, payload)
    expect(nodeRestored).toEqual({
      pages: {
        'page-3': {
          visited: true,
          questionnaireAttempts: { 'quiz-3': [2, 1, 0, 2, 1, 2] },
          activeQuestionnaireRetries: ['quiz-3']
        },
        'page-4': {
          questionnaireAttempts: { 'quiz-4': [1, 0, 1, 1] },
          completedQuestionnaires: ['quiz-4']
        }
      }
    })
    expect(normalize(browserDecode(unlimitedIndex, payload))).toEqual(nodeRestored)

    // Both runtimes also agree on rejecting impossible counts: the unlimited
    // cap removes only the history-length bound, never the per-entry one.
    const malformed = JSON.stringify({
      v: 2,
      p: 0,
      x: '00010',
      d: {
        '3.q.0': [1, 3], // quiz-3 has two questions, so 3 exceeds the count.
        '4.q.0': [2], // quiz-4 has one question, so 2 exceeds the count.
        '3.z.0': 1
      }
    })
    expect(normalize(browserDecode(unlimitedIndex, malformed))).toEqual(
      decodeSuspendData(unlimitedIndex, malformed)
    )
    // The visited bitmap still restores page-3; only the data keys are gone.
    expect(decodeSuspendData(unlimitedIndex, malformed)).toEqual({
      pages: { 'page-3': { visited: true } }
    })
  })

  it('matches browser and Node codecs for completed questionnaire markers', () => {
    const finalizingIndex = structuredClone(scoIndex)
    finalizingIndex.pages['3']!.questionnaires!['0']!.maxAttempts = 3

    // quiz-3 has a completed result beside a stale retry marker; quiz-4 stays
    // pending.
    const finalizing: PlayerState = {
      pages: {
        'page-3': {
          visited: true,
          questionnaireAttempts: { 'quiz-3': [2, 1] },
          completedQuestionnaires: ['quiz-3'],
          activeQuestionnaireRetries: ['quiz-3']
        },
        'page-4': { questionnaireAttempts: { 'quiz-4': [0] } }
      }
    }

    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState

    const encoded = encodeSuspendData(finalizingIndex, finalizing, 0)
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '00010',
      d: { '3.q.0': [2, 1], '3.c.0': 1, '4.q.0': [0] }
    })
    expect(JSON.parse(browserEncode(finalizingIndex, finalizing, 0))).toEqual(encoded)

    const payload = JSON.stringify({
      v: 2,
      p: 0,
      x: '00010',
      d: { '3.q.0': [2, 1], '3.c.0': 1, '3.r.0': 1, '4.q.0': [0] }
    })
    const nodeRestored = decodeSuspendData(finalizingIndex, payload)
    expect(nodeRestored).toEqual({
      pages: {
        'page-3': {
          visited: true,
          questionnaireAttempts: { 'quiz-3': [2, 1] },
          completedQuestionnaires: ['quiz-3']
        },
        'page-4': { questionnaireAttempts: { 'quiz-4': [0] } }
      }
    })
    expect(normalize(browserDecode(finalizingIndex, payload))).toEqual(nodeRestored)

    // Both runtimes also reject a marker without a restored history in the
    // same payload.
    const malformed = JSON.stringify({
      v: 2,
      p: 0,
      x: '00010',
      d: { '3.c.0': 2, '4.c.0': 1, '3.z.0': 1, '4.q.0': [] }
    })
    expect(normalize(browserDecode(finalizingIndex, malformed))).toEqual(
      decodeSuspendData(finalizingIndex, malformed)
    )
    expect(decodeSuspendData(finalizingIndex, malformed)).toEqual({
      pages: { 'page-3': { visited: true } }
    })
  })

  it('encodes scalar option indexes for single-choice and true-false alike', () => {
    // The authored true/false values are ordinary options: the persisted index
    // must follow their source order ('true' first), never the string itself.
    const trueFalseContent: ContentPackage = {
      metadata: { title: 'True false' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page-tf',
            source: 'tf.mdx',
            metadata: { title: 'TF' },
            content: [
              questionnaire('quiz-tf', [
                question('q-tf-single', 'single-choice', [
                  ['no', 'No'],
                  ['yes', 'Yes']
                ]),
                question('q-tf', 'true-false', [
                  ['false', 'False'],
                  ['true', 'True']
                ])
              ])
            ]
          }
        ]
      }
    }
    const trueFalseIndex = createScoIndex(trueFalseContent)

    const answering: PlayerState = {
      pages: { 'page-tf': { answers: { 'q-tf-single': 'yes', 'q-tf': 'false' } } }
    }
    // Both scalar answers encode as page-local index scalars: single-choice
    // index 1 ('yes') and true-false index 0 ('false').
    const encoded = encodeSuspendData(trueFalseIndex, answering, 0)
    expect(encoded).toEqual({
      v: 2,
      p: 0,
      x: '0',
      d: { '0.a.0.0': 1, '0.a.0.1': 0 }
    })
    expect(JSON.stringify(encoded)).not.toMatch(/true|false|yes|no/i)

    // The same indexes decode back into the semantic option values, so a
    // suspended true-false answer resumes as the string, not the index.
    const decoded = decodeSuspendData(trueFalseIndex, JSON.stringify(encoded))
    expect(decoded).toEqual({
      pages: { 'page-tf': { answers: { 'q-tf-single': 'yes', 'q-tf': 'false' } } }
    })
    expect(encodeSuspendData(trueFalseIndex, decoded, 0)).toEqual(encoded)
  })

  it('saves compact suspend data without values and keeps location separate', () => {
    const values: Record<string, string> = {}
    const window: any = {
      __SCORM_DEVTOOLS__: false,
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

    expect(window.scormBridge.saveState({ location: 'page:resume-4', ...selected })).toBe(true)
    expect(values['cmi.core.lesson_location']).toBe('page:resume-4')
    const suspendData = values['cmi.suspend_data']!
    expect(suspendData).not.toMatch(/page:resume-4|zebra|mango|apple|beta|alpha|gamma|delta/i)
    expect(JSON.parse(suspendData)).toEqual(compact)
    expect(window.scormBridge.getResumeState()).toEqual({
      location: 'page:resume-4',
      ...restored
    })
  })

  it('passes the shuffle seed through the browser runtime codec identically', () => {
    const context: Record<string, unknown> = {}
    vm.createContext(context)
    vm.runInContext(browserCodecSource(), context)
    const browserEncode = context.compactEncode as (
      scoIndex: unknown,
      state: unknown,
      progress: number
    ) => string
    const browserDecode = context.compactDecode as (scoIndex: unknown, raw: unknown) => PlayerState
    const seeded: PlayerState = { ...selected, shuffleSeed: 999999999 }
    const invalidSeeded: PlayerState = { ...selected, shuffleSeed: -1 }

    // The embedded browser codec encodes valid seeds the same way Node does,
    // and both drop an invalid seed without changing the rest of the payload.
    expect(JSON.parse(browserEncode(scoIndex, seeded, 0))).toEqual(
      encodeSuspendData(scoIndex, seeded, 0)
    )
    expect(JSON.parse(browserEncode(scoIndex, invalidSeeded, 0))).toEqual(
      encodeSuspendData(scoIndex, invalidSeeded, 0)
    )

    const seededCompact = `{"v":2,"p":0,"x":"00000${'1'}","s":42,"d":{}}`
    expect(browserDecode(scoIndex, seededCompact).shuffleSeed).toBe(
      decodeSuspendData(scoIndex, seededCompact).shuffleSeed
    )
    expect(browserDecode(scoIndex, seededCompact)).toEqual(
      decodeSuspendData(scoIndex, seededCompact)
    )

    // An unusable seed decodes to a state without a seed in both runtimes.
    for (const invalidSeed of [-42, 4.2, '"42"', 'null']) {
      const invalidPayload = `{"v":2,"p":0,"x":"000000","s":${invalidSeed}}`
      expect(browserDecode(scoIndex, invalidPayload)).toEqual(
        decodeSuspendData(scoIndex, invalidPayload)
      )
      expect(decodeSuspendData(scoIndex, invalidPayload)).not.toHaveProperty('shuffleSeed')
    }
  })
})
