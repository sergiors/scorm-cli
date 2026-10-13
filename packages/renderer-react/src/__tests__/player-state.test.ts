import { describe, expect, it } from 'vitest'
import {
  emptyPlayerState,
  sanitizePlayerState,
  sameAnswer,
  updatePageState,
  withLocation
} from '../../app/lib/player-state'
import type { ContentPackage, PlayerState, VideoNode } from '../../app/types'
import { questionnaireNode, scrollPackage } from './fixtures'

/** A scroll package whose first page carries the shared questionnaire fixture. */
const questionnairePackage: ContentPackage = {
  metadata: { title: 'Questionnaire package' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:intro.mdx',
        source: 'intro.mdx',
        metadata: { title: 'Introduction' },
        content: [questionnaireNode]
      },
      {
        type: 'page',
        id: 'page:setup.mdx',
        source: 'setup.mdx',
        metadata: { title: 'Setup' },
        content: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Setup instructions.' }]
          }
        ]
      }
    ]
  }
}

describe('sanitizePlayerState', () => {
  it('returns an empty plain state for missing or non-object input', () => {
    expect(sanitizePlayerState(scrollPackage, undefined)).toEqual({
      pages: {}
    })
    expect(sanitizePlayerState(scrollPackage, null)).toEqual({
      pages: {}
    })
    expect(sanitizePlayerState(scrollPackage, 'nope')).toEqual({
      pages: {}
    })
  })

  it('keeps a known location and drops an unknown one', () => {
    const known = sanitizePlayerState(questionnairePackage, {
      location: 'page:setup.mdx',
      pages: {}
    })
    expect(known.location).toBe('page:setup.mdx')

    const unknown = sanitizePlayerState(questionnairePackage, {
      location: 'page:missing.mdx',
      pages: {}
    })
    expect(unknown.location).toBeUndefined()
  })

  it('drops unknown page ids but keeps known page flags', () => {
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': { visited: true, completed: false },
        'page:missing.mdx': { visited: true }
      }
    })
    expect(state.pages).toEqual({
      'page:intro.mdx': { visited: true }
    })
  })

  it('keeps answers to known questions and drops unknown ones', () => {
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          answers: {
            [questionnaireNode.questions[0].id]: 'first',
            'question:missing': 'whatever'
          }
        }
      }
    })
    expect(state.pages['page:intro.mdx']?.answers).toEqual({
      [questionnaireNode.questions[0].id]: 'first'
    })
  })

  it('drops answers with an option that no longer exists', () => {
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          answers: { [questionnaireNode.questions[0].id]: 'gone' }
        }
      }
    })
    expect(state.pages['page:intro.mdx']).toBeUndefined()
  })

  it('drops answers whose shape does not match the question type', () => {
    const [single, multiple] = questionnaireNode.questions
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          answers: {
            [single.id]: ['first'],
            [multiple.id]: 'alpha'
          }
        }
      }
    })
    expect(state.pages['page:intro.mdx']).toBeUndefined()
  })

  it('keeps multiple-choice answers as deduplicated string arrays', () => {
    const multiple = questionnaireNode.questions[1]
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          answers: { [multiple.id]: ['beta', 'alpha', 'beta'] }
        }
      }
    })
    expect(state.pages['page:intro.mdx']?.answers).toEqual({
      [multiple.id]: ['beta', 'alpha']
    })
  })

  it('keeps only reachable submitted questionnaire ids', () => {
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          submittedQuestionnaires: [questionnaireNode.id, 'questionnaire:missing']
        }
      }
    })
    expect(state.pages['page:intro.mdx']?.submittedQuestionnaires).toEqual([questionnaireNode.id])
  })

  it('scopes a reused question id to each page independently', () => {
    const shared: ContentPackage = {
      metadata: { title: 'Shared question' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page:a.mdx',
            source: 'a.mdx',
            metadata: { title: 'A' },
            content: [questionnaireNode]
          },
          {
            type: 'page',
            id: 'page:b.mdx',
            source: 'b.mdx',
            metadata: { title: 'B' },
            content: [questionnaireNode]
          }
        ]
      }
    }
    const questionId = questionnaireNode.questions[0].id

    const state = sanitizePlayerState(shared, {
      pages: {
        'page:a.mdx': { answers: { [questionId]: 'first' } },
        'page:b.mdx': { answers: { [questionId]: 'second' } }
      }
    })

    // The same stable id resolves against the page that owns it.
    expect(state.pages['page:a.mdx']?.answers).toEqual({
      [questionId]: 'first'
    })
    expect(state.pages['page:b.mdx']?.answers).toEqual({
      [questionId]: 'second'
    })
  })

  it('never mutates the raw persisted object', () => {
    const raw = {
      pages: { 'page:intro.mdx': { visited: true } }
    }
    const state = sanitizePlayerState(questionnairePackage, raw)
    state.pages['page:intro.mdx']!.visited = false
    expect(raw.pages['page:intro.mdx'].visited).toBe(true)
  })
})

describe('sanitizePlayerState videos', () => {
  const pageAVideo: VideoNode = {
    type: 'video',
    id: 'video:a.mdx:1:1',
    provider: 'native',
    src: './a.mp4'
  }
  const pageBVideo: VideoNode = {
    type: 'video',
    id: 'video:b.mdx:1:1',
    provider: 'native',
    src: './b.mp4'
  }
  /** A scroll package whose two pages each own a distinct video. */
  const videoPackage: ContentPackage = {
    metadata: { title: 'Video package' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page:a.mdx',
          source: 'a.mdx',
          metadata: { title: 'A' },
          content: [pageAVideo]
        },
        {
          type: 'page',
          id: 'page:b.mdx',
          source: 'b.mdx',
          metadata: { title: 'B' },
          content: [pageBVideo]
        }
      ]
    }
  }

  it('keeps a position under the page that owns the video, normalized to tenths', () => {
    const state = sanitizePlayerState(videoPackage, {
      pages: { 'page:a.mdx': { videos: { [pageAVideo.id]: 12.34 } } }
    })
    expect(state.pages['page:a.mdx']?.videos).toEqual({ [pageAVideo.id]: 12.3 })
  })

  it('drops stale ids and non-finite or negative values', () => {
    const state = sanitizePlayerState(videoPackage, {
      pages: {
        'page:a.mdx': {
          videos: {
            [pageAVideo.id]: 5,
            'video:gone.mdx:1:1': 10,
            negative: -1,
            nan: Number.NaN,
            infinite: Number.POSITIVE_INFINITY
          }
        }
      }
    })
    expect(state.pages['page:a.mdx']?.videos).toEqual({ [pageAVideo.id]: 5 })
  })

  it('does not retain a video position under a page that no longer owns it', () => {
    // pageBVideo belongs to page:b; a stale record under page:a must be dropped.
    const stale = sanitizePlayerState(videoPackage, {
      pages: { 'page:a.mdx': { videos: { [pageBVideo.id]: 10 } } }
    })
    expect(stale.pages['page:a.mdx']).toBeUndefined()

    const owned = sanitizePlayerState(videoPackage, {
      pages: { 'page:b.mdx': { videos: { [pageBVideo.id]: 10 } } }
    })
    expect(owned.pages['page:b.mdx']?.videos).toEqual({ [pageBVideo.id]: 10 })
  })

  it('scopes positions to each page so they never cross ownership', () => {
    const state = sanitizePlayerState(videoPackage, {
      pages: {
        'page:a.mdx': { videos: { [pageAVideo.id]: 5, [pageBVideo.id]: 99 } },
        'page:b.mdx': { videos: { [pageBVideo.id]: 7.5 } }
      }
    })
    expect(state.pages['page:a.mdx']?.videos).toEqual({ [pageAVideo.id]: 5 })
    expect(state.pages['page:b.mdx']?.videos).toEqual({ [pageBVideo.id]: 7.5 })
  })

  it('keeps a video authored inside a nested questionnaire prompt or option', () => {
    const nestedVideo: VideoNode = {
      type: 'video',
      id: 'video:nested.mdx:1:1',
      provider: 'youtube',
      src: 'https://youtu.be/abc123'
    }
    const nestedPackage: ContentPackage = {
      metadata: { title: 'Nested video package' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page:nested.mdx',
            source: 'nested.mdx',
            metadata: { title: 'Nested' },
            content: [
              {
                type: 'questionnaire',
                id: 'questionnaire:nested.mdx:1:1',
                contributesToScore: false,
                questions: [
                  {
                    type: 'question',
                    id: 'question:nested.mdx:1:1',
                    questionType: 'single-choice',
                    prompt: [nestedVideo],
                    options: [
                      {
                        value: 'a',
                        correct: true,
                        content: [{ type: 'paragraph', children: [{ type: 'text', value: 'A' }] }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }

    const state = sanitizePlayerState(nestedPackage, {
      pages: { 'page:nested.mdx': { videos: { [nestedVideo.id]: 3.14 } } }
    })
    expect(state.pages['page:nested.mdx']?.videos).toEqual({ [nestedVideo.id]: 3.1 })
  })

  it('omits the videos key when nothing survives and never adds a top-level map', () => {
    const state = sanitizePlayerState(videoPackage, {
      pages: { 'page:a.mdx': { videos: { 'video:gone.mdx:1:1': 10 } } }
    })
    expect(state.pages['page:a.mdx']).toBeUndefined()
    expect(Object.keys(state).sort()).toEqual(['pages'])
  })

  it('never mutates the raw persisted videos object', () => {
    const raw = { pages: { 'page:a.mdx': { videos: { [pageAVideo.id]: 12.34 } } } }
    const state = sanitizePlayerState(videoPackage, raw)
    state.pages['page:a.mdx']!.videos![pageAVideo.id] = 99
    expect(raw.pages['page:a.mdx'].videos[pageAVideo.id]).toBe(12.34)
  })
})

describe('player state updates', () => {
  it('preserves referential identity when a page update changes nothing', () => {
    const state: PlayerState = { pages: {} }
    expect(updatePageState(state, 'page:a', (page) => page)).toBe(state)
  })

  it('replaces only the targeted page', () => {
    const state: PlayerState = {
      pages: { 'page:a': { visited: true }, 'page:b': { visited: true } }
    }
    const next = updatePageState(state, 'page:a', (page) => ({
      ...page,
      completed: true
    }))
    expect(next).not.toBe(state)
    expect(next.pages['page:a']).toEqual({ visited: true, completed: true })
    expect(next.pages['page:b']).toBe(state.pages['page:b'])
  })

  it('preserves identity when the location is unchanged', () => {
    const state: PlayerState = { location: 'page:a', pages: {} }
    expect(withLocation(state, 'page:a')).toBe(state)
    expect(withLocation(state, 'page:b')).toEqual({
      location: 'page:b',
      pages: {}
    })
  })

  it('compares string and array answers', () => {
    expect(sameAnswer('a', 'a')).toBe(true)
    expect(sameAnswer('a', 'b')).toBe(false)
    expect(sameAnswer(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameAnswer(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(sameAnswer(['a'], 'a')).toBe(false)
  })

  it('starts empty', () => {
    expect(emptyPlayerState()).toEqual({ pages: {} })
  })
})
