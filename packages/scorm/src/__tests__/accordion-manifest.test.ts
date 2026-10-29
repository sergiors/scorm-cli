import { describe, expect, it } from 'vitest'
import type { ContentPackage } from '@scorm-cli/core'
import { createScoIndex } from '../sco-index'

describe('sco index accordion bodies', () => {
  it('collects questions, questionnaires, and videos nested inside accordion bodies', () => {
    const content: ContentPackage = {
      metadata: { title: 'Accordion sco index' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page-accordion',
            source: 'accordion.mdx',
            metadata: { title: 'Accordion' },
            content: [
              {
                type: 'accordion',
                multiple: false,
                collapsible: false,
                items: [
                  {
                    type: 'accordionItem',
                    defaultOpen: true,
                    title: [{ type: 'text', value: 'Overview' }],
                    content: [
                      {
                        type: 'video',
                        id: 'stable-video',
                        src: 'https://vimeo.com/42',
                        provider: 'vimeo'
                      }
                    ]
                  },
                  {
                    type: 'accordionItem',
                    defaultOpen: false,
                    title: [{ type: 'text', value: 'Check knowledge' }],
                    content: [
                      {
                        type: 'questionnaire',
                        id: 'acc-quiz',
                        contributesToScore: true,
                        revealCorrectAnswers: true,
                        maxAttempts: 3,
                        shuffleOptions: false,
                        questions: [
                          {
                            type: 'question',
                            id: 'single',
                            questionType: 'single-choice',
                            prompt: 'Pick one',
                            options: [
                              { value: 'yes', correct: true, content: 'Yes' },
                              { value: 'no', correct: false, content: 'No' }
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
        ]
      }
    }

    const scoIndex = createScoIndex(content)
    expect(scoIndex.pages['0']).toEqual({
      id: 'page-accordion',
      title: 'Accordion',
      questionnaires: {
        '0': {
          id: 'acc-quiz',
          maxAttempts: 3,
          questions: {
            '0': {
              id: 'single',
              prompt: 'Pick one',
              type: 'single-choice',
              options: {
                '0': { value: 'yes', label: 'Yes' },
                '1': { value: 'no', label: 'No' }
              },
              correctAnswers: ['yes']
            }
          }
        }
      },
      videos: {
        '0': { id: 'stable-video', src: 'https://vimeo.com/42', provider: 'vimeo' }
      }
    })
  })

  it('does not treat an accordion itself as a questionnaire container source', () => {
    const content: ContentPackage = {
      metadata: { title: 'Empty accordion' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'empty',
            source: 'empty.mdx',
            metadata: { title: 'Empty' },
            content: [
              {
                type: 'accordion',
                multiple: true,
                collapsible: false,
                items: [
                  {
                    type: 'accordionItem',
                    defaultOpen: false,
                    title: [{ type: 'text', value: 'Plain' }],
                    content: [{ type: 'paragraph', children: [{ type: 'text', value: 'Text' }] }]
                  }
                ]
              }
            ]
          }
        ]
      }
    }

    const scoIndex = createScoIndex(content)
    // A plain accordion body invents no questionnaire or video slots, and a
    // page without them omits both dictionaries entirely.
    expect(scoIndex.pages['0']).toEqual({
      id: 'empty',
      title: 'Empty'
    })
  })
})
