import { describe, expect, it } from 'vitest'
import type { ContentNode, ContentPackage, QuestionOption } from '@scorm-cli/core'
import { createContentManifest } from '../content-manifest'

const question = (id: string, prompt: ContentNode[], options: QuestionOption[] = []) => ({
  type: 'question' as const,
  id,
  questionType: 'single-choice' as const,
  prompt,
  options
})

describe('content manifest', () => {
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
                              question(
                                'q1',
                                [
                                  {
                                    type: 'paragraph',
                                    children: [
                                      { type: 'text', value: 'Choose ' },
                                      {
                                        type: 'emphasis',
                                        children: [{ type: 'text', value: 'one' }]
                                      }
                                    ]
                                  }
                                ],
                                [
                                  {
                                    value: 'a',
                                    correct: true,
                                    content: [
                                      {
                                        type: 'paragraph',
                                        children: [{ type: 'text', value: 'Alpha' }]
                                      }
                                    ]
                                  },
                                  {
                                    value: 'b',
                                    correct: false,
                                    content: [
                                      {
                                        type: 'paragraph',
                                        children: [
                                          {
                                            type: 'strong',
                                            children: [{ type: 'text', value: 'Beta' }]
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              ),
                              question('q2', [{ type: 'code', value: 'Second prompt' }], [])
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
                questions: [
                  question('q3', [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Third' }]
                    }
                  ])
                ]
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
              prompt: 'Choose one',
              options: {
                '0': { value: 'a', label: 'Alpha' },
                '1': { value: 'b', label: 'Beta' }
              }
            },
            '1': { id: 'q2', prompt: 'Second prompt', options: {} },
            '2': { id: 'q3', prompt: 'Third', options: {} }
          }
        },
        '1': { id: 'p-b', title: 'Second', questions: {} }
      }
    })
    expect(JSON.stringify(first)).not.toMatch(/correct|quiz-a|Before/)
    expect(first).not.toHaveProperty('videos')
  })

  it('indexes video IDs and static metadata through nested content without playback state', () => {
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
                              question(
                                'q',
                                [video('video:videos.mdx:3:1', 'vimeo', 'https://vimeo.com/42')],
                                [
                                  {
                                    value: 'option',
                                    correct: false,
                                    content: [
                                      video(
                                        'video:videos.mdx:4:1',
                                        'native',
                                        'https://cdn.example.test/clip.mp4'
                                      )
                                    ]
                                  }
                                ]
                              )
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

    expect(createContentManifest(content).videos).toEqual({
      'video:videos.mdx:1:1': {
        src: 'assets/local.mp4',
        provider: 'native',
        pageId: 'p-videos'
      },
      'video:videos.mdx:2:1': {
        src: 'https://youtu.be/abc',
        provider: 'youtube',
        pageId: 'p-videos'
      },
      'video:videos.mdx:3:1': {
        src: 'https://vimeo.com/42',
        provider: 'vimeo',
        pageId: 'p-videos'
      },
      'video:videos.mdx:4:1': {
        src: 'https://cdn.example.test/clip.mp4',
        provider: 'native',
        pageId: 'p-videos'
      },
      'video:second.mdx:1:1': {
        src: 'assets/second.mp4',
        provider: 'native',
        pageId: 'p-second'
      }
    })
    expect(JSON.stringify(createContentManifest(content))).not.toMatch(/playback|position|seconds/)
  })

  it('assigns grid videos to their root item owner', () => {
    const content: ContentPackage = {
      metadata: { title: 'Grid videos' },
      presentation: {
        type: 'grid',
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

    expect(createContentManifest(content).videos).toEqual({
      'video:item.mdx:1:1': { src: 'abc', provider: 'youtube', pageId: 'item-video' }
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

  it('indexes grid items using stable item and question ids', () => {
    const content: ContentPackage = {
      metadata: { title: 'Grid' },
      presentation: {
        type: 'grid',
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
                questions: [question('stable-question-id', [])]
              }
            ]
          }
        ]
      }
    }
    expect(createContentManifest(content)).toMatchObject({
      presentation: 'grid',
      pages: {
        '0': { id: 'item-1' },
        '1': { id: 'item-2', questions: { '0': { id: 'stable-question-id' } } }
      }
    })
  })

  it('reads tight list inline runs for question prompt text', () => {
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
                questions: [
                  question('q-tight', [
                    {
                      type: 'list',
                      ordered: false,
                      spread: false,
                      items: [
                        {
                          children: [
                            {
                              type: 'inlineContent',
                              children: [
                                { type: 'text', value: 'See ' },
                                {
                                  type: 'image',
                                  src: 'assets/prompt.svg',
                                  alt: 'Prompt diagram'
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ])
                ]
              }
            ]
          }
        ]
      }
    }
    expect(createContentManifest(content).pages['0']!.questions['0']).toMatchObject({
      id: 'q-tight',
      prompt: 'See Prompt diagram'
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
                        questions: [
                          question('q-nested', [
                            {
                              type: 'paragraph',
                              children: [{ type: 'text', value: 'Nested' }]
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
      }
    }
    expect(createContentManifest(content).pages['0']!.questions['0']).toMatchObject({
      id: 'q-nested',
      prompt: 'Nested'
    })
  })
})
