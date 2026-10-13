import { describe, expect, it } from 'vitest'
import {
  areQuestionnairesSubmitted,
  collectQuestionnaireIds,
  collectQuestionnaires,
  getAccessibleNodeIds,
  getDoneNodeIds,
  getPresentationNodes,
  isNodeAccessible,
  isPackageComplete
} from '../../app/lib/content-helpers'
import type { ContentNode, QuestionnaireNode } from '../../app/types'
import {
  makeEmptyPackage,
  makeEmptyTilesPackage,
  questionnaireNode,
  scrollPackage,
  tilesPackage
} from './fixtures'

/** A minimal questionnaire with a distinct wrapper id, for traversal tests. */
function questionnaire(id: string): QuestionnaireNode {
  return {
    type: 'questionnaire',
    id,
    contributesToScore: true,
    questions: [
      {
        type: 'question',
        id: `question:${id}`,
        questionType: 'single-choice',
        prompt: [{ type: 'paragraph', children: [{ type: 'text', value: 'Prompt' }] }],
        options: [
          { value: 'yes', correct: true, content: [] },
          { value: 'no', correct: false, content: [] }
        ]
      }
    ]
  }
}

describe('getPresentationNodes', () => {
  it('returns the pages of a scroll presentation in document order', () => {
    expect(getPresentationNodes(scrollPackage).map((node) => node.id)).toEqual([
      'page:intro.mdx',
      'page:setup.mdx'
    ])
  })

  it('returns the tiles of a tiles presentation in document order', () => {
    expect(getPresentationNodes(tilesPackage).map((node) => node.id)).toEqual([
      'item:functions.mdx',
      'item:types.mdx',
      'item:details.mdx'
    ])
  })

  it('returns an empty list for an empty presentation', () => {
    expect(getPresentationNodes(makeEmptyPackage())).toEqual([])
    expect(getPresentationNodes(makeEmptyTilesPackage())).toEqual([])
  })
})

describe('getDoneNodeIds', () => {
  it('counts scroll pages that are completed, not merely visited', () => {
    expect(
      getDoneNodeIds(scrollPackage, {
        pages: {
          'page:intro.mdx': { visited: true, completed: true },
          'page:setup.mdx': { visited: true }
        }
      })
    ).toEqual(['page:intro.mdx'])
  })

  it('counts tiles that were visited, regardless of completion', () => {
    expect(
      getDoneNodeIds(tilesPackage, {
        pages: {
          'item:functions.mdx': { visited: true },
          'item:types.mdx': {}
        }
      })
    ).toEqual(['item:functions.mdx'])
  })

  it('ignores state for ids that are not presentation nodes', () => {
    expect(
      getDoneNodeIds(scrollPackage, {
        pages: { 'page:missing.mdx': { visited: true, completed: true } }
      })
    ).toEqual([])
  })

  it('is empty for an empty presentation', () => {
    expect(getDoneNodeIds(makeEmptyPackage(), { pages: {} })).toEqual([])
    expect(getDoneNodeIds(makeEmptyTilesPackage(), { pages: {} })).toEqual([])
  })

  it('gates package completion through the canonical core helper', () => {
    const state = {
      pages: {
        'page:intro.mdx': { completed: true },
        'page:setup.mdx': { completed: true }
      }
    }
    expect(isPackageComplete(scrollPackage, getDoneNodeIds(scrollPackage, state))).toBe(true)
    expect(isPackageComplete(tilesPackage, getDoneNodeIds(tilesPackage, state))).toBe(false)
  })
})

describe('isPackageComplete', () => {
  it('is false until every page has been visited', () => {
    expect(isPackageComplete(scrollPackage, ['page:intro.mdx'])).toBe(false)
  })

  it('is true once every page has been visited', () => {
    expect(isPackageComplete(scrollPackage, ['page:intro.mdx', 'page:setup.mdx'])).toBe(true)
  })

  it('tracks tiles the same way', () => {
    expect(isPackageComplete(tilesPackage, ['item:functions.mdx'])).toBe(false)
    expect(
      isPackageComplete(tilesPackage, ['item:functions.mdx', 'item:types.mdx', 'item:details.mdx'])
    ).toBe(true)
  })

  it('is false for an empty package', () => {
    expect(isPackageComplete(makeEmptyPackage(), [])).toBe(false)
    expect(isPackageComplete(makeEmptyTilesPackage(), [])).toBe(false)
  })
})

describe('collectQuestionnaireIds', () => {
  it('returns no ids when no questionnaire is present', () => {
    expect(
      collectQuestionnaireIds([{ type: 'paragraph', children: [{ type: 'text', value: 'Plain' }] }])
    ).toEqual([])
  })

  it('collects the id of a top-level questionnaire', () => {
    const nodes: ContentNode[] = [questionnaireNode]
    expect(collectQuestionnaireIds(nodes)).toEqual([questionnaireNode.id])
  })

  it('skips tight inline runs but still traverses sibling blocks', () => {
    const nodes: ContentNode[] = [
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          {
            children: [
              {
                type: 'inlineContent',
                children: [{ type: 'text', value: 'Before' }]
              },
              questionnaireNode
            ]
          }
        ]
      }
    ]
    expect(collectQuestionnaireIds(nodes)).toEqual([questionnaireNode.id])
  })

  it('recurses through lists and quotes in document order', () => {
    const nested: QuestionnaireNode = {
      type: 'questionnaire',
      id: 'questionnaire:nested.mdx:1:1',
      contributesToScore: true,
      questions: [questionnaireNode.questions[0]]
    }
    const nodes: ContentNode[] = [
      {
        type: 'list',
        ordered: false,
        items: [{ children: [questionnaireNode] }]
      },
      {
        type: 'quote',
        children: [nested]
      }
    ]
    expect(collectQuestionnaireIds(nodes)).toEqual([questionnaireNode.id, nested.id])
  })

  it('recurses through nested list and quote containers', () => {
    const inDeepList = questionnaire('deep-list')
    const inNestedQuote = questionnaire('nested-quote')
    const nodes: ContentNode[] = [
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
                    type: 'list',
                    ordered: true,
                    items: [{ children: [inDeepList] }]
                  }
                ]
              }
            ]
          },
          inNestedQuote
        ]
      }
    ]

    expect(collectQuestionnaireIds(nodes)).toEqual(['deep-list', 'nested-quote'])
  })

  it('descends into a questionnaire prompt and option content', () => {
    const inPrompt = questionnaire('prompt')
    const inOption = questionnaire('option')
    const outer: QuestionnaireNode = {
      type: 'questionnaire',
      id: 'outer',
      contributesToScore: true,
      questions: [
        {
          type: 'question',
          id: 'question:outer',
          questionType: 'single-choice',
          prompt: [inPrompt],
          options: [{ value: 'a', correct: true, content: [inOption] }]
        }
      ]
    }

    expect(collectQuestionnaireIds([outer])).toEqual(['outer', 'prompt', 'option'])
  })

  it('ignores leaf blocks that cannot contain a questionnaire', () => {
    const nodes: ContentNode[] = [
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'H' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'P' }] },
      { type: 'thematicBreak' },
      { type: 'code', value: 'x' },
      { type: 'image', src: 'a.png', alt: 'a' },
      { type: 'video', id: 'video:test.mdx:1:1', provider: 'native', src: 'v.mp4' },
      { type: 'path', pageIds: ['page:one.mdx'] }
    ]

    expect(collectQuestionnaireIds(nodes)).toEqual([])
  })
})

describe('collectQuestionnaires', () => {
  it('returns the questionnaire nodes themselves, not just their ids', () => {
    const nodes: ContentNode[] = [questionnaireNode]
    expect(collectQuestionnaires(nodes)).toEqual([questionnaireNode])
  })

  it('returns an empty list for content without questionnaires', () => {
    expect(
      collectQuestionnaires([{ type: 'paragraph', children: [{ type: 'text', value: 'Plain' }] }])
    ).toEqual([])
  })
})

describe('areQuestionnairesSubmitted', () => {
  it('is true when there are no questionnaires to submit', () => {
    expect(areQuestionnairesSubmitted([], [])).toBe(true)
    expect(areQuestionnairesSubmitted([], ['extra'])).toBe(true)
  })

  it('is true only when every questionnaire id is submitted', () => {
    expect(areQuestionnairesSubmitted(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(areQuestionnairesSubmitted(['a', 'b'], ['a'])).toBe(false)
  })

  it('ignores submitted ids that no longer name a questionnaire', () => {
    expect(areQuestionnairesSubmitted(['a'], ['stale', 'a'])).toBe(true)
  })
})

describe('shared sequential progression (renderer helpers)', () => {
  it('exposes only the first page until its predecessor completes', () => {
    expect(getAccessibleNodeIds(scrollPackage, { pages: {} })).toEqual(['page:intro.mdx'])
  })

  it('unlocks the next page once the current one is completed', () => {
    const state = { pages: { 'page:intro.mdx': { completed: true } } }
    expect(getAccessibleNodeIds(scrollPackage, state)).toEqual(['page:intro.mdx', 'page:setup.mdx'])
    expect(isNodeAccessible(scrollPackage, state, 'page:setup.mdx')).toBe(true)
  })

  it('keeps a visited-but-incomplete page reachable and the rest locked', () => {
    const state = { pages: { 'page:intro.mdx': { visited: true } } }
    expect(isNodeAccessible(scrollPackage, state, 'page:intro.mdx')).toBe(true)
    expect(isNodeAccessible(scrollPackage, state, 'page:setup.mdx')).toBe(false)
  })

  it('unlocks tiles one at a time as they are opened', () => {
    expect(getAccessibleNodeIds(tilesPackage, { pages: {} })).toEqual(['item:functions.mdx'])
    expect(
      getAccessibleNodeIds(tilesPackage, { pages: { 'item:functions.mdx': { visited: true } } })
    ).toEqual(['item:functions.mdx', 'item:types.mdx'])
  })
})
