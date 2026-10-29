import { describe, expect, it } from 'vitest'
import {
  emptyPlayerState,
  sanitizePlayerState,
  sameAnswer,
  updatePageState,
  withLocation
} from '../../app/lib/player-state'
import type {
  ContentPackage,
  PageNode,
  PlayerState,
  QuestionnaireNode,
  VideoNode
} from '../../app/types'
import {
  multipleChoiceQuestion,
  questionnaireNode,
  scrollPackage,
  singleChoiceQuestion
} from './fixtures'

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

  it('keeps an active question only when it belongs to its questionnaire', () => {
    const activeQuestionId = questionnaireNode.questions[1].id
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          activeQuestionnaireItems: {
            [questionnaireNode.id]: activeQuestionId,
            'questionnaire:missing': activeQuestionId,
            [questionnaireNode.id + ':wrong-question']: 'question:missing',
            [questionnaireNode.id + ':wrong-type']: 3
          }
        }
      }
    })

    expect(state.pages['page:intro.mdx']?.activeQuestionnaireItems).toEqual({
      [questionnaireNode.id]: activeQuestionId
    })
  })

  it('drops the active-question map when no saved position is valid', () => {
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          activeQuestionnaireItems: {
            [questionnaireNode.id]: 'question:removed',
            'questionnaire:missing': questionnaireNode.questions[0].id
          }
        }
      }
    })

    expect(state.pages['page:intro.mdx']).toBeUndefined()
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
    provider: 'vimeo',
    src: 'https://vimeo.com/a'
  }
  const pageBVideo: VideoNode = {
    type: 'video',
    id: 'video:b.mdx:1:1',
    provider: 'vimeo',
    src: 'https://vimeo.com/b'
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

  it('does not treat questionnaire prompt and option strings as video nodes', () => {
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
                revealCorrectAnswers: true,
                maxAttempts: 1,
                shuffleOptions: false,
                questions: [
                  {
                    type: 'question',
                    id: 'question:nested.mdx:1:1',
                    questionType: 'single-choice',
                    prompt: 'video prompt',
                    options: [
                      {
                        value: 'a',
                        correct: true,
                        content: 'A'
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
    expect(state.pages['page:nested.mdx']?.videos).toBeUndefined()
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

describe('sanitizePlayerState accumulated watch seconds', () => {
  const requiredVideo: VideoNode = {
    type: 'video',
    id: 'video:req.mdx:1:1',
    provider: 'vimeo',
    src: 'https://vimeo.com/req',
    duration: 120,
    minWatchTime: 30
  }
  const unrequiredVideo: VideoNode = {
    type: 'video',
    id: 'video:open.mdx:1:1',
    provider: 'vimeo',
    src: 'https://vimeo.com/open',
    duration: 90
  }
  const watchPackage: ContentPackage = {
    metadata: { title: 'Watch seconds package' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page:a.mdx',
          source: 'a.mdx',
          metadata: { title: 'A' },
          content: [requiredVideo, unrequiredVideo]
        },
        {
          type: 'page',
          id: 'page:b.mdx',
          source: 'b.mdx',
          metadata: { title: 'B' },
          content: [{ ...requiredVideo, id: 'video:b.mdx:1:1', src: './b.mp4', minWatchTime: 10 }]
        }
      ]
    }
  }

  it('keeps watch seconds for a required video and normalizes them to tenths', () => {
    const state = sanitizePlayerState(watchPackage, {
      pages: { 'page:a.mdx': { videoWatchSeconds: { [requiredVideo.id]: 12.34 } } }
    })
    expect(state.pages['page:a.mdx']?.videoWatchSeconds).toEqual({ [requiredVideo.id]: 12.3 })
  })

  it('caps watch seconds at the authored requirement, not the duration', () => {
    const state = sanitizePlayerState(watchPackage, {
      pages: {
        'page:a.mdx': { videoWatchSeconds: { [requiredVideo.id]: 119.96 } }
      }
    })
    // A total beyond the minute-long requirement is trimmed to it even though
    // the media duration is two minutes.
    expect(state.pages['page:a.mdx']?.videoWatchSeconds).toEqual({ [requiredVideo.id]: 30 })
  })

  it('drops watch seconds for videos without a requirement, stale ids, zero and invalid values', () => {
    const state = sanitizePlayerState(watchPackage, {
      pages: {
        'page:a.mdx': {
          videoWatchSeconds: {
            [unrequiredVideo.id]: 45,
            'video:gone.mdx:1:1': 10,
            zero: 0,
            negative: -1,
            nan: Number.NaN,
            infinite: Number.POSITIVE_INFINITY
          }
        }
      }
    })
    // Nothing survives: the total only ever belongs to a required video.
    expect(state.pages['page:a.mdx']).toBeUndefined()
  })

  it('drops legacy watch frontiers saved under the previous watchedVideos field', () => {
    const state = sanitizePlayerState(watchPackage, {
      pages: {
        'page:a.mdx': { completed: true, watchedVideos: { [requiredVideo.id]: 20 } }
      }
    })
    // The old field is no longer read, so the stale completion predating the
    // unread progress cannot survive either.
    expect(state.pages['page:a.mdx']).toBeUndefined()
  })

  it('scopes watch seconds to the page that owns each video', () => {
    const state = sanitizePlayerState(watchPackage, {
      pages: {
        'page:a.mdx': { videoWatchSeconds: { 'video:b.mdx:1:1': 55 } },
        'page:b.mdx': { videoWatchSeconds: { 'video:b.mdx:1:1': 7.5 } }
      }
    })
    expect(state.pages['page:a.mdx']).toBeUndefined()
    expect(state.pages['page:b.mdx']?.videoWatchSeconds).toEqual({ 'video:b.mdx:1:1': 7.5 })
  })

  it('restores page completion only when every required video was watched', () => {
    const watched = sanitizePlayerState(watchPackage, {
      pages: {
        'page:a.mdx': {
          completed: true,
          videoWatchSeconds: { [requiredVideo.id]: 29.95 }
        }
      }
    })
    // The total sits within the completion tolerance of the requirement.
    expect(watched.pages['page:a.mdx']?.completed).toBe(true)

    const unwatched = sanitizePlayerState(watchPackage, {
      pages: {
        'page:a.mdx': { completed: true, videoWatchSeconds: { [requiredVideo.id]: 10 } }
      }
    })
    // A stale completion predating the requirement cannot survive a restore.
    expect(unwatched.pages['page:a.mdx']).toEqual({
      videoWatchSeconds: { [requiredVideo.id]: 10 }
    })
  })

  it('exempts tiles completion from video requirements but keeps questionnaire gates', () => {
    const tilesPackage: ContentPackage = {
      metadata: { title: 'Tiles video package' },
      presentation: {
        type: 'tiles',
        items: [
          {
            type: 'item',
            id: 'item:video-only',
            source: 'video-only.mdx',
            metadata: { title: 'Video only' },
            content: [requiredVideo]
          },
          {
            type: 'item',
            id: 'item:video-and-questionnaire',
            source: 'video-and-questionnaire.mdx',
            metadata: { title: 'Video and questionnaire' },
            content: [requiredVideo, questionnaireNode]
          }
        ]
      }
    }

    const pendingQuestionnaire = sanitizePlayerState(tilesPackage, {
      pages: {
        'item:video-only': { completed: true },
        'item:video-and-questionnaire': { completed: true }
      }
    })
    expect(pendingQuestionnaire.pages['item:video-only']?.completed).toBe(true)
    expect(pendingQuestionnaire.pages['item:video-and-questionnaire']?.completed).toBeUndefined()

    const completedQuestionnaire = sanitizePlayerState(tilesPackage, {
      pages: {
        'item:video-and-questionnaire': {
          completed: true,
          completedQuestionnaires: [questionnaireNode.id]
        }
      }
    })
    expect(completedQuestionnaire.pages['item:video-and-questionnaire']?.completed).toBe(true)
  })

  it('drops completion and keeps playback for legacy state saved before requirements', () => {
    const state = sanitizePlayerState(watchPackage, {
      pages: {
        'page:a.mdx': {
          completed: true,
          videos: { [requiredVideo.id]: 20 }
        }
      }
    })
    expect(state.pages['page:a.mdx']).toEqual({
      videos: { [requiredVideo.id]: 20 }
    })
  })
})

describe('sanitizePlayerState attempt history', () => {
  /** The shared questionnaire fixture with an authored cap of three attempts. */
  const retryQuestionnaire: QuestionnaireNode = { ...questionnaireNode, maxAttempts: 3 }
  const [single, multiple] = questionnaireNode.questions

  function attemptPackage(presentation: 'scroll' | 'slides' = 'scroll'): ContentPackage {
    const page: PageNode = {
      type: 'page',
      id: 'page:intro.mdx',
      source: 'intro.mdx',
      metadata: { title: 'Introduction' },
      content: [retryQuestionnaire]
    }
    return presentation === 'slides'
      ? { metadata: { title: 'Attempts' }, presentation: { type: 'slides', pages: [page] } }
      : { metadata: { title: 'Attempts' }, presentation: { type: 'scroll', pages: [page] } }
  }

  it.each(['scroll', 'slides'] as const)(
    'keeps a completed %s page pending without history and completion',
    (presentation) => {
      // A legacy completed page predates attempt history and completion. Its
      // questionnaire has no completed result recorded, so the stale completion
      // flag is dropped and nothing is inferred submitted — the pending
      // decision is what the learner sees after the refresh.
      const state = sanitizePlayerState(attemptPackage(presentation), {
        pages: {
          'page:intro.mdx': {
            visited: true,
            completed: true,
            answers: { [single.id]: 'first', [multiple.id]: ['beta'] }
          }
        }
      })

      expect(state.pages['page:intro.mdx']).toEqual({
        visited: true,
        answers: { [single.id]: 'first', [multiple.id]: ['beta'] }
      })
    }
  )

  it('seeds one attempt for an explicitly submitted questionnaire without history', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          submittedQuestionnaires: [retryQuestionnaire.id],
          answers: { [single.id]: 'first', [multiple.id]: ['alpha'] }
        }
      }
    })

    // Both questions correct: the seeded entry records the full score once.
    expect(state.pages['page:intro.mdx']).toEqual({
      answers: { [single.id]: 'first', [multiple.id]: ['alpha'] },
      submittedQuestionnaires: [retryQuestionnaire.id],
      questionnaireAttempts: { [retryQuestionnaire.id]: [2] }
    })
  })
  it('counts only sanitized answers when seeding the legacy history', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          submittedQuestionnaires: [retryQuestionnaire.id],
          // A stale option value cannot survive sanitization, so it must not
          // credit the seeded attempt either.
          answers: { [single.id]: 'gone', [multiple.id]: 'alpha' }
        }
      }
    })

    expect(state.pages['page:intro.mdx']?.answers).toBeUndefined()
    expect(state.pages['page:intro.mdx']?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [0]
    })
  })

  it('restores completion only from its own persisted field', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          // Completion is never derived from submissions, history, or page
          // completion; it is also scoped to reachable questionnaires.
          submittedQuestionnaires: [retryQuestionnaire.id],
          completedQuestionnaires: [retryQuestionnaire.id, 'questionnaire:missing'],
          questionnaireAttempts: { [retryQuestionnaire.id]: [1] }
        }
      }
    })

    expect(state.pages['page:intro.mdx']?.completedQuestionnaires).toEqual([retryQuestionnaire.id])
  })

  it('never infers completion from submission, history, or page completion', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          completed: true,
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [2] },
          answers: { [single.id]: 'first', [multiple.id]: ['alpha'] }
        }
      }
    })

    const page = state.pages['page:intro.mdx']
    // Submission is inferred from the recorded attempt history, but the result
    // stays pending: without the persisted completion field (or a Complete
    // click after the restore) no completed decision may appear, and the stale
    // page completion is dropped so the page cannot complete early.
    expect(page?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
    expect(page?.questionnaireAttempts).toEqual({ [retryQuestionnaire.id]: [2] })
    expect(page?.completedQuestionnaires).toBeUndefined()
    expect(page?.completed).toBeUndefined()
  })

  it('infers submissions from a recorded history without a persisted submission list', () => {
    // Compact suspend data never encoded submissions; restoring the attempt
    // history alone brings the pending submission back with it.
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          visited: true,
          questionnaireAttempts: { [retryQuestionnaire.id]: [1] },
          answers: { [single.id]: 'first' }
        }
      }
    })

    expect(state.pages['page:intro.mdx']).toEqual({
      visited: true,
      answers: { [single.id]: 'first' },
      submittedQuestionnaires: [retryQuestionnaire.id],
      questionnaireAttempts: { [retryQuestionnaire.id]: [1] }
    })
  })

  it('restores a completed result to read-only review and drops its stale retry', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          visited: true,
          completed: true,
          completedQuestionnaires: [retryQuestionnaire.id],
          activeQuestionnaireRetries: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [0, 2] },
          answers: { [single.id]: 'first', [multiple.id]: ['alpha'] }
        }
      }
    })

    // A completed questionnaire can never be retried, and with no pending
    // decision the persisted page completion is restored as saved.
    expect(state.pages['page:intro.mdx']).toEqual({
      visited: true,
      completed: true,
      answers: { [single.id]: 'first', [multiple.id]: ['alpha'] },
      questionnaireAttempts: { [retryQuestionnaire.id]: [0, 2] },
      completedQuestionnaires: [retryQuestionnaire.id],
      submittedQuestionnaires: [retryQuestionnaire.id]
    })
  })

  it('keeps an in-progress retry pending without refreshing stale page completion', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          visited: true,
          completed: true,
          activeQuestionnaireRetries: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [0] },
          answers: { [single.id]: 'first' }
        }
      }
    })

    // The retry keeps the page editable after the refresh, and the persisted
    // completion flag is stale for a page whose decision is still open: it is
    // dropped here and re-derived only after the questionnaire finalizes.
    expect(state.pages['page:intro.mdx']).toEqual({
      visited: true,
      answers: { [single.id]: 'first' },
      questionnaireAttempts: { [retryQuestionnaire.id]: [0] },
      activeQuestionnaireRetries: [retryQuestionnaire.id]
    })
  })

  it('keeps a surviving retry excluded from an explicitly provided submission', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          submittedQuestionnaires: [retryQuestionnaire.id],
          activeQuestionnaireRetries: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [0] },
          answers: { [single.id]: 'first' }
        }
      }
    })

    expect(state.pages['page:intro.mdx']).toEqual({
      answers: { [single.id]: 'first' },
      questionnaireAttempts: { [retryQuestionnaire.id]: [0] },
      activeQuestionnaireRetries: [retryQuestionnaire.id]
    })
  })

  it('never overwrites or extends a restored attempt history', () => {
    const state = sanitizePlayerState(attemptPackage(), {
      pages: {
        'page:intro.mdx': {
          submittedQuestionnaires: [retryQuestionnaire.id],
          questionnaireAttempts: { [retryQuestionnaire.id]: [0, 2] },
          answers: { [single.id]: 'first', [multiple.id]: ['alpha'] }
        }
      }
    })

    // Two restored attempts stay exactly two; no legacy entry is appended. The
    // recorded history also restores the submission on its own.
    expect(state.pages['page:intro.mdx']?.questionnaireAttempts).toEqual({
      [retryQuestionnaire.id]: [0, 2]
    })
    expect(state.pages['page:intro.mdx']?.submittedQuestionnaires).toEqual([retryQuestionnaire.id])
  })

  it('seeds a single attempt even for a one-attempt submitted questionnaire', () => {
    const state = sanitizePlayerState(questionnairePackage, {
      pages: {
        'page:intro.mdx': {
          submittedQuestionnaires: [questionnaireNode.id],
          answers: { [single.id]: 'first', [multiple.id]: ['alpha'] }
        }
      }
    })

    // A legacy submission without history is seeded with one score from its
    // sanitized answers so a resumed questionnaire never grants a fresh full
    // allowance. The result stays pending: completion is never inferred.
    expect(state.pages['page:intro.mdx']?.submittedQuestionnaires).toEqual([questionnaireNode.id])
    expect(state.pages['page:intro.mdx']?.questionnaireAttempts).toEqual({
      [questionnaireNode.id]: [2]
    })
    expect(state.pages['page:intro.mdx']?.completedQuestionnaires).toBeUndefined()
  })

  describe('unlimited -1 attempt cap', () => {
    /** An unlimited-cap questionnaire: restore keeps every recorded attempt. */
    const unlimitedQuestionnaire: QuestionnaireNode = { ...questionnaireNode, maxAttempts: -1 }

    function unlimitedPackage(): ContentPackage {
      const page: PageNode = {
        type: 'page',
        id: 'page:intro.mdx',
        source: 'intro.mdx',
        metadata: { title: 'Introduction' },
        content: [unlimitedQuestionnaire]
      }
      return { metadata: { title: 'Attempts' }, presentation: { type: 'scroll', pages: [page] } }
    }

    it('restores a pending unlimited submission with every recorded attempt', () => {
      const state = sanitizePlayerState(unlimitedPackage(), {
        pages: {
          'page:intro.mdx': {
            visited: true,
            // Six attempts exceed any finite cap, yet the unlimited cap keeps
            // them exactly as recorded and restores the pending submission.
            questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 1, 2, 0, 1, 2] },
            answers: { [single.id]: 'first' }
          }
        }
      })

      expect(state.pages['page:intro.mdx']).toEqual({
        visited: true,
        answers: { [single.id]: 'first' },
        submittedQuestionnaires: [unlimitedQuestionnaire.id],
        questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 1, 2, 0, 1, 2] }
      })
    })

    it('keeps an unlimited in-progress retry pending after a refresh', () => {
      const state = sanitizePlayerState(unlimitedPackage(), {
        pages: {
          'page:intro.mdx': {
            visited: true,
            completed: true,
            activeQuestionnaireRetries: [unlimitedQuestionnaire.id],
            // A long retried history never blocks the retry marker: an
            // unlimited cap always leaves another attempt, so the restored
            // result stays pending and the stale page completion is dropped.
            questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 2, 1, 0] }
          }
        }
      })

      expect(state.pages['page:intro.mdx']).toEqual({
        visited: true,
        questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 2, 1, 0] },
        activeQuestionnaireRetries: [unlimitedQuestionnaire.id]
      })
    })

    it('restores a completed unlimited result and drops its stale retry', () => {
      const state = sanitizePlayerState(unlimitedPackage(), {
        pages: {
          'page:intro.mdx': {
            visited: true,
            completed: true,
            completedQuestionnaires: [unlimitedQuestionnaire.id],
            activeQuestionnaireRetries: [unlimitedQuestionnaire.id],
            questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 1, 2, 1] }
          }
        }
      })

      // A completed questionnaire can never be retried, unlimited or not: the
      // stale marker is dropped while the long history and the persisted page
      // completion are restored as saved.
      expect(state.pages['page:intro.mdx']).toEqual({
        visited: true,
        completed: true,
        questionnaireAttempts: { [unlimitedQuestionnaire.id]: [0, 1, 2, 1] },
        completedQuestionnaires: [unlimitedQuestionnaire.id],
        submittedQuestionnaires: [unlimitedQuestionnaire.id]
      })
    })
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
