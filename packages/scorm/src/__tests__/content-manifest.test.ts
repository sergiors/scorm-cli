import { describe, expect, it } from 'vitest'
import type { ContentNode, ContentPackage, QuestionOption } from '@scorm-cli/core'
import { createContentManifest } from '../content-manifest'

const question = (id: string, prompt: string, options: QuestionOption[] = []) => ({
  type: 'question' as const,
  id,
  questionType: 'single-choice' as const,
  prompt,
  options
})

describe('content manifest', () => {
  it('emits the focused empty, question-only, video-only, and combined page shapes', () => {
    const content: ContentPackage = {
      metadata: { title: 'Focused manifest' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'empty',
            source: 'empty.mdx',
            metadata: { title: 'Empty' },
            content: []
          },
          {
            type: 'page',
            id: 'question-only',
            source: 'question.mdx',
            metadata: { title: 'Question' },
            content: [
              {
                type: 'questionnaire',
                id: 'quiz',
                contributesToScore: true,
                questions: [
                  {
                    ...question('multi', 'Pick **two**', [
                      {
                        value: 'semantic-z',
                        correct: true,
                        content: 'First label'
                      },
                      {
                        value: 'semantic-a',
                        correct: false,
                        content: 'Wrong label'
                      },
                      {
                        value: 'semantic-y',
                        correct: true,
                        content: 'Last label'
                      }
                    ]),
                    questionType: 'multiple-choice' as const
                  }
                ]
              }
            ]
          },
          {
            type: 'page',
            id: 'video-only',
            source: 'video.mdx',
            metadata: { title: 'Video' },
            content: [{ type: 'video', id: 'stable-video', src: 'clip.mp4', provider: 'native' }]
          },
          {
            type: 'page',
            id: 'both',
            source: 'both.mdx',
            metadata: { title: 'Both' },
            content: [
              { type: 'video', id: 'second-video', src: 'https://vimeo.com/42', provider: 'vimeo' },
              {
                type: 'questionnaire',
                id: 'quiz-2',
                contributesToScore: false,
                questions: [
                  question('single', '', [
                    {
                      value: 'semantic-value',
                      correct: true,
                      content: 'Visible label'
                    }
                  ])
                ]
              }
            ]
          }
        ]
      }
    }
    const manifest = createContentManifest(content)
    expect(manifest.pages['0']).toEqual({
      id: 'empty',
      title: 'Empty',
      questions: {},
      questionnaires: {}
    })
    expect(manifest.pages['1']!.videos).toBeUndefined()
    expect(manifest.pages['1']!.questions!['0']).toMatchObject({
      id: 'multi',
      prompt: 'Pick **two**',
      type: 'multiple-choice',
      correctAnswers: ['semantic-z', 'semantic-y'],
      options: {
        '0': { value: 'semantic-z', label: 'First label' },
        '1': { value: 'semantic-a', label: 'Wrong label' },
        '2': { value: 'semantic-y', label: 'Last label' }
      }
    })
    expect(manifest.pages['2']!.questions).toEqual({})
    expect(manifest.pages['2']!.videos).toEqual({
      '0': { id: 'stable-video', src: 'clip.mp4', provider: 'native' }
    })
    expect(manifest.pages['3']!.videos).toEqual({
      '0': { id: 'second-video', src: 'https://vimeo.com/42', provider: 'vimeo' }
    })
    expect(manifest.pages['3']!.questions!['0']).toMatchObject({
      prompt: '',
      correctAnswers: ['semantic-value'],
      options: { '0': { value: 'semantic-value', label: 'Visible label' } }
    })
    // Both questionnaires get the single-attempt default; the opted-out one
    // keeps its contribution flag out of the attempt bounds entirely.
    expect(manifest.pages['1']!.questionnaires).toEqual({
      '0': { id: 'quiz', maxAttempts: 1, questionCount: 1 }
    })
    expect(manifest.pages['3']!.questionnaires).toEqual({
      '0': { id: 'quiz-2', maxAttempts: 1, questionCount: 1 }
    })
    expect(manifest.pages['2']!.questionnaires).toEqual({})
    expect(manifest).not.toHaveProperty('videos')
    // Each page exposes exactly the runtime dictionaries it needs and nothing
    // else: prompts, labels, correct answers and attempt bounds are
    // manifest-owned, while no learner progress or extra keys can appear.
    expect(Object.keys(manifest.pages['0']!)).toEqual([
      'id',
      'title',
      'questions',
      'questionnaires'
    ])
    expect(Object.keys(manifest.pages['1']!)).toEqual([
      'id',
      'title',
      'questions',
      'questionnaires'
    ])
    expect(Object.keys(manifest.pages['2']!)).toEqual([
      'id',
      'title',
      'questions',
      'questionnaires',
      'videos'
    ])
    expect(Object.keys(manifest.pages['3']!)).toEqual([
      'id',
      'title',
      'questions',
      'questionnaires',
      'videos'
    ])
    expect(Object.keys(manifest.pages['1']!.questions!['0']!)).toEqual([
      'id',
      'prompt',
      'type',
      'options',
      'correctAnswers'
    ])
  })

  it('deterministically indexes pages, nested questionnaires, questions, and authored options', () => {
    const content: ContentPackage = {
      metadata: { title: 'Course' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'p-a',
            source: 'a.mdx',
            metadata: { title: 'First' },
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Before' }]
              },
              {
                type: 'quote',
                children: [
                  {
                    type: 'list',
                    ordered: false,
                    items: [
                      {
                        children: [
                          {
                            type: 'questionnaire',
                            id: 'quiz-a',
                            contributesToScore: true,
                            questions: [
                              question('q1', 'Choose *one*', [
                                {
                                  value: 'a',
                                  correct: true,
                                  content: 'Alpha'
                                },
                                {
                                  value: 'b',
                                  correct: false,
                                  content: '**Beta**'
                                }
                              ]),
                              question('q2', 'Second prompt', [])
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                type: 'questionnaire',
                id: 'quiz-b',
                contributesToScore: true,
                questions: [question('q3', 'Third')]
              }
            ]
          },
          {
            type: 'page',
            id: 'p-b',
            source: 'b.mdx',
            metadata: { title: 'Second' },
            content: []
          }
        ]
      }
    }
    const first = createContentManifest(content)
    expect(first).toEqual(createContentManifest(content))
    expect(first).toMatchObject({
      schemaVersion: 1,
      title: 'Course',
      lang: 'en',
      presentation: 'scroll',
      pages: {
        '0': {
          id: 'p-a',
          title: 'First',
          questions: {
            '0': {
              id: 'q1',
              prompt: 'Choose *one*',
              correctAnswers: ['a'],
              options: {
                '0': { value: 'a', label: 'Alpha' },
                '1': { value: 'b', label: '**Beta**' }
              }
            },
            '1': { id: 'q2', prompt: 'Second prompt', options: {}, correctAnswers: [] },
            '2': { id: 'q3', prompt: 'Third', options: {}, correctAnswers: [] }
          }
        },
        '1': { id: 'p-b', title: 'Second', questions: {} }
      }
    })
    expect(JSON.stringify(first)).not.toMatch(/Before/)
    expect(first).not.toHaveProperty('videos')
  })

  it('stores stable preorder questionnaire indexes with attempt bounds', () => {
    const content: ContentPackage = {
      metadata: { title: 'Attempts' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'p-attempts',
            source: 'attempts.mdx',
            metadata: { title: 'Attempts' },
            content: [
              {
                type: 'quote',
                children: [
                  {
                    type: 'list',
                    ordered: false,
                    items: [
                      {
                        children: [
                          {
                            type: 'questionnaire',
                            id: 'quiz-nested',
                            contributesToScore: true,
                            maxAttempts: 3,
                            questions: [question('n1', 'First'), question('n2', 'Second')]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                type: 'questionnaire',
                id: 'quiz-toplevel',
                contributesToScore: true,
                questions: [question('t1', 'Third')]
              }
            ]
          }
        ]
      }
    }

    // Nested and top-level questionnaires share one preorder index per page,
    // and every entry carries the bounds the suspend-data codec validates
    // against: the authored attempt cap (or the single-attempt default) and
    // the questionnaire's question count.
    expect(createContentManifest(content).pages['0']!.questionnaires).toEqual({
      '0': { id: 'quiz-nested', maxAttempts: 3, questionCount: 2 },
      '1': { id: 'quiz-toplevel', maxAttempts: 1, questionCount: 1 }
    })
  })

  it('indexes videos from content blocks without playback state', () => {
    const video = (
      id: string,
      provider: 'native' | 'youtube' | 'vimeo',
      src: string
    ): ContentNode => ({ type: 'video', id, provider, src })
    const content: ContentPackage = {
      metadata: { title: 'Videos' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'p-videos',
            source: 'videos.mdx',
            metadata: { title: 'Videos' },
            content: [
              video('video:videos.mdx:1:1', 'native', 'assets/local.mp4'),
              {
                type: 'quote',
                children: [
                  {
                    type: 'list',
                    ordered: false,
                    items: [
                      {
                        children: [
                          video('video:videos.mdx:2:1', 'youtube', 'https://youtu.be/abc'),
                          {
                            type: 'questionnaire',
                            id: 'quiz',
                            contributesToScore: false,
                            questions: [
                              question('q', 'video prompt', [
                                {
                                  value: 'option',
                                  correct: false,
                                  content: 'video option'
                                }
                              ])
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            type: 'page',
            id: 'p-second',
            source: 'second.mdx',
            metadata: { title: 'Second' },
            content: [video('video:second.mdx:1:1', 'native', 'assets/second.mp4')]
          }
        ]
      }
    }

    const manifest = createContentManifest(content)
    expect(manifest.pages['0']!.videos).toEqual({
      '0': {
        id: 'video:videos.mdx:1:1',
        src: 'assets/local.mp4',
        provider: 'native'
      },
      '1': {
        id: 'video:videos.mdx:2:1',
        src: 'https://youtu.be/abc',
        provider: 'youtube'
      }
    })
    expect(manifest.pages['1']!.videos).toEqual({
      '0': {
        id: 'video:second.mdx:1:1',
        src: 'assets/second.mp4',
        provider: 'native'
      }
    })
    expect(Object.keys(manifest.pages['0']!.videos ?? {})).toEqual(['0', '1'])
    expect(manifest).not.toHaveProperty('videos')
    expect(JSON.stringify(manifest)).not.toMatch(/pageId|playback|position|seconds/)
  })

  it('assigns items videos to their root item owner', () => {
    const content: ContentPackage = {
      metadata: { title: 'Tiles videos' },
      presentation: {
        type: 'tiles',
        items: [
          {
            type: 'item',
            id: 'item-video',
            source: 'item.mdx',
            metadata: { title: 'Video item' },
            content: [{ type: 'video', id: 'video:item.mdx:1:1', provider: 'youtube', src: 'abc' }]
          }
        ]
      }
    }

    expect(createContentManifest(content).pages['0']!.videos).toEqual({
      '0': { id: 'video:item.mdx:1:1', src: 'abc', provider: 'youtube' }
    })
  })

  it('includes the package language and defaults legacy package metadata to English', () => {
    const content: ContentPackage = {
      metadata: { title: 'Localized', lang: 'pt-BR' },
      presentation: { type: 'scroll', pages: [] }
    }
    expect(createContentManifest(content).lang).toBe('pt-BR')
    expect(
      createContentManifest({
        ...content,
        metadata: { title: 'Legacy' }
      }).lang
    ).toBe('en')
  })

  it('indexes items using stable item and question ids', () => {
    const content: ContentPackage = {
      metadata: { title: 'Tiles' },
      presentation: {
        type: 'tiles',
        items: [
          {
            type: 'item',
            id: 'item-1',
            source: '1',
            metadata: { title: 'One' },
            content: []
          },
          {
            type: 'item',
            id: 'item-2',
            source: '2',
            metadata: { title: 'Two' },
            content: [
              {
                type: 'questionnaire',
                id: 'quiz',
                contributesToScore: true,
                questions: [question('stable-question-id', '')]
              }
            ]
          }
        ]
      }
    }
    expect(createContentManifest(content)).toMatchObject({
      presentation: 'tiles',
      pages: {
        '0': { id: 'item-1' },
        '1': { id: 'item-2', questions: { '0': { id: 'stable-question-id' } } }
      }
    })
  })

  it('preserves raw Markdown in question prompt text', () => {
    const content: ContentPackage = {
      metadata: { title: 'Tight' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'p-tight',
            source: 'tight.mdx',
            metadata: { title: 'Tight' },
            content: [
              {
                type: 'questionnaire',
                id: 'quiz-tight',
                contributesToScore: true,
                questions: [question('q-tight', 'See `raw` **Markdown**')]
              }
            ]
          }
        ]
      }
    }
    expect(createContentManifest(content).pages['0']!.questions!['0']).toMatchObject({
      id: 'q-tight',
      prompt: 'See `raw` **Markdown**'
    })
  })

  it('collects a questionnaire that follows a tight inline run', () => {
    const content: ContentPackage = {
      metadata: { title: 'Tight' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'p-tight',
            source: 'tight.mdx',
            metadata: { title: 'Tight' },
            content: [
              {
                type: 'list',
                ordered: false,
                spread: false,
                items: [
                  {
                    children: [
                      {
                        type: 'inlineContent',
                        children: [{ type: 'text', value: 'Answer:' }]
                      },
                      {
                        type: 'questionnaire',
                        id: 'quiz-nested',
                        contributesToScore: true,
                        questions: [question('q-nested', 'Nested')]
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
    expect(createContentManifest(content).pages['0']!.questions!['0']).toMatchObject({
      id: 'q-nested',
      prompt: 'Nested'
    })
  })
})
