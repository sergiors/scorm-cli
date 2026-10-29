import { describe, expect, it } from 'vitest'
import {
  collectAssetReferences,
  collectVideoNodes,
  getAggregateQuestionnaireScore,
  type AccordionNode,
  type ContentPackage,
  type InlineNode,
  type QuestionNode,
  type QuestionnaireNode
} from '../index'

/** A short single-page package whose only block is the given accordion. */
function accordionPackage(accordion: AccordionNode): ContentPackage {
  return {
    metadata: { title: 'Accordion traversal' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page-one',
          source: 'one.mdx',
          metadata: { title: 'One' },
          content: [accordion]
        }
      ]
    }
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
    prompt: '',
    options: values.map((value) => ({ value, correct: correctValues.includes(value), content: '' }))
  }
}

function questionnaire(
  id: string,
  questions: QuestionNode[],
  contributesToScore = true
): QuestionnaireNode {
  return {
    type: 'questionnaire',
    id,
    contributesToScore,
    revealCorrectAnswers: true,
    maxAttempts: 1,
    shuffleOptions: false,
    questions
  }
}

const text = (value: string): InlineNode => ({ type: 'text', value })
const inlineImage = (src: string): InlineNode => ({ type: 'image', src, alt: '' })

/** Two sections: one carrying the given title inline and body content. */
function sectionAccordion(items: AccordionNode['items']): AccordionNode {
  return { type: 'accordion', multiple: false, collapsible: false, items }
}

describe('accordion traversals', () => {
  it('collects asset references from section titles and bodies in order', () => {
    const accordion = sectionAccordion([
      {
        type: 'accordionItem',
        defaultOpen: false,
        title: [text('Intro '), inlineImage('images/title.png')],
        content: [
          { type: 'paragraph', children: [text('Body')] },
          { type: 'image', src: 'images/body.png', alt: '' },
          {
            type: 'video',
            id: 'video:one.mdx:3:3',
            provider: 'vimeo',
            src: 'https://vimeo.com/7',
            poster: 'videos/poster.png'
          }
        ]
      },
      {
        type: 'accordionItem',
        defaultOpen: false,
        title: [text('Lists')],
        content: [
          {
            type: 'list',
            ordered: false,
            items: [
              {
                children: [{ type: 'inlineContent', children: [inlineImage('images/list.png')] }]
              }
            ]
          }
        ]
      }
    ])

    expect(collectAssetReferences(accordionPackage(accordion))).toEqual([
      'images/body.png',
      'images/list.png',
      'images/title.png',
      // An embedded video `src` is a provider URL, never a local asset; only
      // its poster remains a local reference.
      'videos/poster.png'
    ])
  })

  it('collects videos from section bodies, including nested quotes', () => {
    const accordion = sectionAccordion([
      {
        type: 'accordionItem',
        defaultOpen: false,
        title: [text('Media')],
        content: [
          {
            type: 'video',
            id: 'video:one.mdx:2:5',
            provider: 'youtube',
            src: 'https://youtu.be/abc123'
          },
          {
            type: 'quote',
            children: [
              {
                type: 'video',
                id: 'video:one.mdx:3:7',
                provider: 'youtube',
                src: 'https://youtube.com/watch?v=abc'
              }
            ]
          }
        ]
      }
    ])

    expect(collectVideoNodes([accordion])).toEqual([
      {
        type: 'video',
        id: 'video:one.mdx:2:5',
        provider: 'youtube',
        src: 'https://youtu.be/abc123'
      },
      {
        type: 'video',
        id: 'video:one.mdx:3:7',
        provider: 'youtube',
        src: 'https://youtube.com/watch?v=abc'
      }
    ])
  })

  it('scores a completed questionnaire nested inside a section body', () => {
    const accordion = sectionAccordion([
      {
        type: 'accordionItem',
        defaultOpen: true,
        title: [text('Check your knowledge')],
        content: [
          questionnaire('acc-quiz', [question('single', 'single-choice', ['yes', 'no'], ['yes'])])
        ]
      }
    ])

    const score = getAggregateQuestionnaireScore(accordionPackage(accordion), {
      pages: {
        'page-one': {
          completedQuestionnaires: ['acc-quiz'],
          questionnaireAttempts: { 'acc-quiz': [1] },
          answers: { single: 'yes' }
        }
      }
    })
    expect(score).toEqual({ earned: 1, possible: 1 })

    // Nothing is recorded before completion: a pending questionnaire inside a
    // section body leaves no earned points and no possible points at all.
    expect(
      getAggregateQuestionnaireScore(accordionPackage(accordion), { pages: {} })
    ).toBeUndefined()
  })
})
