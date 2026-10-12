import { describe, expect, it } from 'vitest'
import {
  collectAssetReferences,
  getAggregateQuestionnaireScore,
  getDoneNodeIds,
  getPackageProgress,
  isPackageComplete,
  type ContentPackage,
  type QuestionNode,
  type QuestionnaireNode
} from '../index'

const contentPackage: ContentPackage = {
  metadata: { title: 'Package' },
  presentation: {
    type: 'grid',
    columns: 2,
    items: [
      {
        type: 'item',
        id: 'a',
        source: 'a.mdx',
        metadata: { title: 'A' },
        content: [
          { type: 'image', src: 'images/z.png', alt: 'Z' },
          { type: 'video', src: 'https://example.test/v.mp4' }
        ]
      },
      {
        type: 'item',
        id: 'b',
        source: 'b.mdx',
        metadata: { title: 'B' },
        content: []
      }
    ]
  }
}

function question(
  id: string,
  questionType: QuestionNode['questionType'],
  values: string[],
  correctValues: string[]
): QuestionNode {
  return {
    type: 'question',
    id,
    questionType,
    prompt: [],
    options: values.map((value) => ({ value, correct: correctValues.includes(value), content: [] }))
  }
}

function questionnaire(
  id: string,
  questions: QuestionNode[],
  contributesToScore = true
): QuestionnaireNode {
  return { type: 'questionnaire', id, contributesToScore, questions }
}

describe('core package helpers', () => {
  it('defines completion as all items visited', () => {
    expect(isPackageComplete(contentPackage, ['a'])).toBe(false)
    expect(isPackageComplete(contentPackage, ['a', 'b'])).toBe(true)
    expect(
      isPackageComplete(
        {
          metadata: { title: 'Empty' },
          presentation: { type: 'scroll', pages: [] }
        },
        []
      )
    ).toBe(false)
    expect(
      isPackageComplete(
        {
          metadata: { title: 'Scroll' },
          presentation: {
            type: 'scroll',
            pages: [
              {
                type: 'page',
                id: 'page:a',
                source: 'a.mdx',
                metadata: { title: 'A' },
                content: []
              }
            ]
          }
        },
        ['page:a']
      )
    ).toBe(true)
  })

  it('collects sorted unique local asset references', () => {
    expect(collectAssetReferences(contentPackage)).toEqual(['images/z.png'])
  })

  it('calculates integer progress from completed scroll pages and visited grid items', () => {
    expect(getPackageProgress(contentPackage, { pages: { a: { visited: true } } })).toBe(50)
    const scroll: ContentPackage = {
      metadata: { title: 'Scroll' },
      presentation: {
        type: 'scroll',
        pages: ['one', 'two', 'three'].map((id) => ({
          type: 'page',
          id,
          source: id,
          metadata: { title: id },
          content: []
        }))
      }
    }
    expect(getPackageProgress(scroll, { pages: { one: { completed: true } } })).toBe(33)
    expect(getPackageProgress(scroll, { pages: { one: { visited: true } } })).toBe(0)
  })

  it('returns done node IDs using presentation-specific completion semantics', () => {
    expect(
      getDoneNodeIds(contentPackage, { pages: { a: { visited: true }, b: { completed: true } } })
    ).toEqual(['a'])

    const scroll: ContentPackage = {
      metadata: { title: 'Scroll' },
      presentation: {
        type: 'scroll',
        pages: ['one', 'two'].map((id) => ({
          type: 'page',
          id,
          source: id,
          metadata: { title: id },
          content: []
        }))
      }
    }
    expect(
      getDoneNodeIds(scroll, { pages: { one: { completed: true }, two: { visited: true } } })
    ).toEqual(['one'])

    const empty: ContentPackage = {
      metadata: { title: 'Empty' },
      presentation: { type: 'grid', items: [] }
    }
    expect(getDoneNodeIds(empty, { pages: {} })).toEqual([])
    expect(getPackageProgress(empty, { pages: {} })).toBe(0)
  })

  it('collects assets from tight list inline runs and their sibling blocks', () => {
    const tight: ContentPackage = {
      metadata: { title: 'Tight' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'tight',
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
                        children: [
                          { type: 'text', value: 'See ' },
                          {
                            type: 'image',
                            src: 'inline/tight.svg',
                            alt: 'tight'
                          }
                        ]
                      },
                      { type: 'image', src: 'block/tight.svg', alt: 'block' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }
    expect(collectAssetReferences(tight)).toEqual(['block/tight.svg', 'inline/tight.svg'])
  })

  it('ignores thematic breaks when collecting assets', () => {
    const withBreak: ContentPackage = {
      metadata: { title: 'Break' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'break',
            source: 'break.mdx',
            metadata: { title: 'Break' },
            content: [
              { type: 'paragraph', children: [{ type: 'text', value: 'a' }] },
              { type: 'thematicBreak' },
              { type: 'image', src: 'images/b.svg', alt: 'B' }
            ]
          }
        ]
      }
    }
    expect(collectAssetReferences(withBreak)).toEqual(['images/b.svg'])
  })

  it('collects local media references recursively throughout the content AST', () => {
    const nested: ContentPackage = {
      metadata: { title: 'Nested' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'nested',
            source: 'nested.mdx',
            metadata: { title: 'Nested' },
            content: [
              {
                type: 'heading',
                depth: 2,
                children: [
                  { type: 'text', value: 'See ' },
                  {
                    type: 'link',
                    href: 'https://example.test',
                    children: [
                      {
                        type: 'emphasis',
                        children: [
                          {
                            type: 'strong',
                            children: [
                              {
                                type: 'image',
                                src: 'inline/heading.svg',
                                alt: 'heading'
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    type: 'link',
                    href: 'docs/guide.pdf?download=1#page-2',
                    children: [{ type: 'text', value: 'guide' }]
                  },
                  { type: 'link', href: 'mailto:help@example.test', children: [] }
                ]
              },
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    children: [
                      {
                        type: 'paragraph',
                        children: [
                          {
                            type: 'image',
                            src: 'inline/list.svg',
                            alt: 'list'
                          }
                        ]
                      },
                      {
                        type: 'quote',
                        children: [
                          {
                            type: 'paragraph',
                            children: [
                              {
                                type: 'image',
                                src: 'inline/quote.svg',
                                alt: 'quote'
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
                type: 'quote',
                children: [
                  {
                    type: 'image',
                    src: 'inline/quote-nested.svg',
                    alt: 'quote'
                  }
                ]
              },
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    children: [
                      {
                        type: 'image',
                        src: 'inline/list-nested.svg',
                        alt: 'list'
                      }
                    ]
                  }
                ]
              },
              {
                type: 'questionnaire',
                id: 'questionnaire:nested.mdx:1:1',
                contributesToScore: true,
                questions: [
                  {
                    type: 'question',
                    id: 'question:nested.mdx:2:1',
                    questionType: 'single-choice',
                    prompt: [
                      {
                        type: 'image',
                        src: 'inline/prompt.svg',
                        alt: 'prompt'
                      }
                    ],
                    options: [
                      {
                        value: 'local',
                        correct: true,
                        content: [
                          {
                            type: 'image',
                            src: 'inline/option.svg',
                            alt: 'option'
                          }
                        ]
                      },
                      {
                        value: 'remote',
                        correct: false,
                        content: [
                          {
                            type: 'video',
                            src: 'https://example.test/remote.mp4',
                            poster: 'inline/remote-poster.svg'
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                type: 'video',
                src: 'media/lesson.mp4',
                poster: 'media/lesson-poster.svg',
                captions: 'media/lesson-captions.vtt'
              }
            ]
          }
        ]
      }
    }
    expect(collectAssetReferences(nested)).toEqual([
      'docs/guide.pdf',
      'inline/heading.svg',
      'inline/list-nested.svg',
      'inline/list.svg',
      'inline/option.svg',
      'inline/prompt.svg',
      'inline/quote-nested.svg',
      'inline/quote.svg',
      'inline/remote-poster.svg',
      'media/lesson-captions.vtt',
      'media/lesson-poster.svg',
      'media/lesson.mp4'
    ])
  })
})

describe('aggregate questionnaire score', () => {
  it('does not award an empty answer for a multiple-choice question with no correct options', () => {
    const content: ContentPackage = {
      metadata: { title: 'Malformed score question' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page',
            source: 'page.mdx',
            metadata: { title: 'Page' },
            content: [
              questionnaire('quiz', [question('empty-correct-set', 'multiple-choice', ['a'], [])])
            ]
          }
        ]
      }
    }

    expect(
      getAggregateQuestionnaireScore(content, {
        pages: { page: { answers: { 'empty-correct-set': [] } } }
      })
    ).toEqual({ earned: 0, possible: 1 })
  })

  it('scores all eligible question types across pages and nested content', () => {
    const content: ContentPackage = {
      metadata: { title: 'Score' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page-one',
            source: 'one.mdx',
            metadata: { title: 'One' },
            content: [
              questionnaire('q-one', [
                question('single', 'single-choice', ['yes', 'no'], ['yes']),
                question('true-false', 'true-false', ['true', 'false'], ['true']),
                question('multiple', 'multiple-choice', ['a', 'b', 'c'], ['a', 'c'])
              ]),
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    children: [
                      {
                        type: 'quote',
                        children: [
                          questionnaire('q-nested', [
                            question(
                              'multiple-wrong',
                              'multiple-choice',
                              ['x', 'y', 'z'],
                              ['x', 'y']
                            ),
                            question(
                              'multiple-extra',
                              'multiple-choice',
                              ['x', 'y', 'z'],
                              ['x', 'y']
                            ),
                            question('unanswered', 'single-choice', ['up', 'down'], ['up'])
                          ])
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
            id: 'page-two',
            source: 'two.mdx',
            metadata: { title: 'Two' },
            content: [
              questionnaire('q-page-two', [
                question('page-two-question', 'multiple-choice', ['a', 'b'], ['b'])
              ]),
              questionnaire(
                'opted-out',
                [question('excluded', 'single-choice', ['right', 'wrong'], ['right'])],
                false
              )
            ]
          }
        ]
      }
    }
    const score = getAggregateQuestionnaireScore(content, {
      pages: {
        'page-one': {
          answers: {
            single: 'yes',
            'true-false': 'false',
            multiple: ['c', 'a'],
            'multiple-wrong': ['x'],
            'multiple-extra': ['x', 'y', 'z'],
            excluded: 'right'
          }
          // No submission is required to calculate a score from the saved answers.
        },
        'page-two': {
          answers: { 'page-two-question': ['b'], excluded: 'right' },
          submittedQuestionnaires: ['opted-out']
        }
      }
    })

    expect(score).toEqual({ earned: 3, possible: 7 })
  })

  it('aggregates grid items and returns undefined when there are no eligible questions', () => {
    const content: ContentPackage = {
      metadata: { title: 'Grid score' },
      presentation: {
        type: 'grid',
        items: [
          {
            type: 'item',
            id: 'item-one',
            source: 'one.mdx',
            metadata: { title: 'One' },
            content: [
              questionnaire('included', [
                question('item-question', 'true-false', ['true', 'false'], ['false'])
              ])
            ]
          },
          {
            type: 'item',
            id: 'item-two',
            source: 'two.mdx',
            metadata: { title: 'Two' },
            content: [
              questionnaire('included-two', [
                question('item-two-question', 'single-choice', ['a', 'b'], ['a'])
              ]),
              questionnaire(
                'excluded',
                [question('excluded-question', 'single-choice', ['a', 'b'], ['a'])],
                false
              )
            ]
          }
        ]
      }
    }

    expect(
      getAggregateQuestionnaireScore(content, {
        pages: {
          'item-one': { answers: { 'item-question': 'false' } },
          'item-two': { answers: { 'item-two-question': 'a' } }
        }
      })
    ).toEqual({ earned: 2, possible: 2 })

    const noEligibleQuestions: ContentPackage = {
      metadata: { title: 'Opted out' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page',
            source: 'page.mdx',
            metadata: { title: 'Page' },
            content: [
              questionnaire(
                'excluded-only',
                [question('excluded-only-question', 'single-choice', ['a', 'b'], ['a'])],
                false
              )
            ]
          }
        ]
      }
    }
    expect(getAggregateQuestionnaireScore(noEligibleQuestions, { pages: {} })).toBeUndefined()
  })
})
