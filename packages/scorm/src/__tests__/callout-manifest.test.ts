import { describe, expect, it } from 'vitest'
import type { ContentNode, ContentPackage, QuestionNode, QuestionnaireNode } from '@scorm-cli/core'
import { createContentManifest } from '../content-manifest'

const text = (value: string): ContentNode => ({
  type: 'paragraph',
  children: [{ type: 'text', value }]
})

const question = (
  id: string,
  prompt: string,
  questionType: QuestionNode['questionType']
): QuestionNode => ({
  type: 'question',
  id,
  questionType,
  prompt,
  options: [
    { value: 'yes', correct: true, content: 'Yes' },
    { value: 'no', correct: questionType === 'multiple-choice', content: 'No' }
  ]
})

const questionnaire = (
  id: string,
  maxAttempts: number,
  questions: QuestionNode[]
): QuestionnaireNode => ({
  type: 'questionnaire',
  id,
  contributesToScore: true,
  revealCorrectAnswers: true,
  maxAttempts,
  shuffleOptions: false,
  questions
})

const callout = (
  variant: 'note' | 'info' | 'warning' | 'danger',
  children: ContentNode[]
): ContentNode => ({
  type: 'callout',
  variant,
  children
})

function contentPackage(pages: ContentNode[][]): ContentPackage {
  return {
    metadata: { title: 'Callout manifest' },
    presentation: {
      type: 'scroll',
      pages: pages.map((content, index) => ({
        type: 'page',
        id: `page-${index}`,
        source: `callout-${index}.mdx`,
        metadata: { title: `Page ${index}` },
        content
      }))
    }
  }
}

describe('content manifest callout bodies', () => {
  it('indexes questionnaires and questions nested inside callout bodies in document order', () => {
    const content = contentPackage([
      [
        text('Intro paragraph'),
        callout('warning', [
          questionnaire('callout-quiz-a', 2, [
            question('q-a-single', 'Pick one', 'single-choice'),
            question('q-a-multi', 'Pick many', 'multiple-choice')
          ])
        ]),
        questionnaire('top-quiz', 1, [question('q-top', 'Top-level pick', 'single-choice')]),
        callout('info', [
          callout('danger', [
            questionnaire('callout-quiz-inner', 5, [
              question('q-inner', 'Inner pick', 'single-choice')
            ])
          ]),
          { type: 'video', id: 'callout-video', src: 'https://vimeo.com/42', provider: 'vimeo' }
        ])
      ]
    ])

    const manifest = createContentManifest(content)
    // Dense preorder indices: the first callout's questions come before the
    // top-level one, and the nested callout's question after it, exactly as the
    // learner reaches them in the document.
    expect(manifest.pages['0']).toEqual({
      id: 'page-0',
      title: 'Page 0',
      questions: {
        '0': {
          id: 'q-a-single',
          prompt: 'Pick one',
          type: 'single-choice',
          options: {
            '0': { value: 'yes', label: 'Yes' },
            '1': { value: 'no', label: 'No' }
          },
          correctAnswers: ['yes']
        },
        '1': {
          id: 'q-a-multi',
          prompt: 'Pick many',
          type: 'multiple-choice',
          options: {
            '0': { value: 'yes', label: 'Yes' },
            '1': { value: 'no', label: 'No' }
          },
          correctAnswers: ['yes', 'no']
        },
        '2': {
          id: 'q-top',
          prompt: 'Top-level pick',
          type: 'single-choice',
          options: {
            '0': { value: 'yes', label: 'Yes' },
            '1': { value: 'no', label: 'No' }
          },
          correctAnswers: ['yes']
        },
        '3': {
          id: 'q-inner',
          prompt: 'Inner pick',
          type: 'single-choice',
          options: {
            '0': { value: 'yes', label: 'Yes' },
            '1': { value: 'no', label: 'No' }
          },
          correctAnswers: ['yes']
        }
      },
      questionnaires: {
        '0': { id: 'callout-quiz-a', maxAttempts: 2, questionCount: 2 },
        // The questionnaire outside any callout keeps the dense bookkeeping.
        '1': { id: 'top-quiz', maxAttempts: 1, questionCount: 1 },
        // The nested callout descends past the inner wrapper to its question.
        '2': { id: 'callout-quiz-inner', maxAttempts: 5, questionCount: 1 }
      },
      videos: {
        // Videos nested in callout bodies keep their manifest slots too.
        '0': { id: 'callout-video', src: 'https://vimeo.com/42', provider: 'vimeo' }
      }
    })

    const flatQuestions = Object.values(manifest.pages['0']!.questions)
    expect(flatQuestions.map((entry) => entry.prompt)).toEqual([
      'Pick one',
      'Pick many',
      'Top-level pick',
      'Inner pick'
    ])
  })

  it('leaves a callout page without questionnaires at empty dense indices', () => {
    const content = contentPackage([
      [text('Before'), callout('note', [text('Plain callout body')]), text('After')]
    ])

    const manifest = createContentManifest(content)
    // A plain callout invents no questionnaire or video slots; the page entry
    // matches the accordion shape with no `videos` key at all.
    expect(manifest.pages['0']).toEqual({
      id: 'page-0',
      title: 'Page 0',
      questions: {},
      questionnaires: {}
    })
  })
})
