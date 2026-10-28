import { describe, expect, expectTypeOf, it } from 'vitest'
import type { ReactElement } from 'react'
import * as authoring from '../index'
import type {
  AuthoringComponentName,
  ItemProps,
  OptionProps,
  PageProps,
  PromptProps,
  QuestionProps,
  QuestionnaireProps,
  QuestionType,
  ScrollProps,
  SlidesProps,
  TilesProps
} from '../index'

/** Canonical marker vocabulary; the parser asserts the same names stay aligned. */
const markerNames: AuthoringComponentName[] = [
  'Scroll',
  'Slides',
  'Tiles',
  'Page',
  'Item',
  'Path',
  'Image',
  'Video',
  'Questionnaire',
  'Question',
  'Prompt',
  'Option'
]

function markerFunctions(): Record<string, (props: Record<string, unknown>) => unknown> {
  return authoring as unknown as Record<string, (props: Record<string, unknown>) => unknown>
}

describe('@scorm-cli/authoring', () => {
  it('exports every canonical marker as a stub that throws when executed', () => {
    const markers = markerFunctions()
    for (const name of markerNames) {
      expect(typeof markers[name]).toBe('function')
      expect(() => markers[name]!({})).toThrowError(`<${name}>`)
    }
  })

  it('exports only the canonical marker functions', () => {
    const markers = authoring as unknown as Record<string, unknown>
    expect(
      Object.keys(markers)
        .filter((key) => typeof markers[key] === 'function')
        .sort()
    ).toEqual([...markerNames].sort())
  })

  it('types marker props against the authoring contract', () => {
    expectTypeOf<QuestionType>().toEqualTypeOf<'single-choice' | 'multiple-choice' | 'true-false'>()
    const sourcePage: PageProps = { src: 'lesson.mdx' }
    const referencePage: PageProps = { ref: 'lesson.mdx' }
    const scroll: ScrollProps = { children: null }
    const slides: SlidesProps = { children: null }
    const tiles: TilesProps = { columns: 2 }
    const item: ItemProps = { src: 'item.mdx' }
    expect([sourcePage, referencePage, scroll, slides, tiles, item]).toHaveLength(6)
  })

  it('enforces authoring marker prop constraints at compile time', () => {
    // Accepted shapes compile; a bare JSX `correct` attribute passes `true`.
    const sourcePage = { src: 'lesson.mdx' } satisfies PageProps
    const referencePage = { ref: 'lesson.mdx' } satisfies PageProps
    const tiles = { columns: 2 } satisfies TilesProps
    const item = { src: 'item.mdx' } satisfies ItemProps
    const singleChoice = { type: 'single-choice' } satisfies QuestionProps
    const multipleChoice = { type: 'multiple-choice' } satisfies QuestionProps
    const trueFalse = { type: 'true-false' } satisfies QuestionProps
    const includedQuestionnaire = { contributesToScore: true } satisfies QuestionnaireProps
    const excludedQuestionnaire = { contributesToScore: false } satisfies QuestionnaireProps
    const hiddenAnswersQuestionnaire = { revealCorrectAnswers: false } satisfies QuestionnaireProps
    const option = { value: 'a' } satisfies OptionProps
    const correctOption = { value: 'a', correct: true } satisfies OptionProps
    const incorrectOption = {
      value: 'a',
      correct: false
    } satisfies OptionProps

    // @ts-expect-error <Page> requires either src or ref.
    const neitherPage: PageProps = {}
    // @ts-expect-error <Page> rejects src and ref together.
    const bothPage: PageProps = { src: 'lesson.mdx', ref: 'lesson.mdx' }
    // @ts-expect-error <Tiles columns> must be a number.
    const stringColumns: TilesProps = { columns: '2' }
    // @ts-expect-error <Question type> must be a supported kind.
    const invalidQuestion: QuestionProps = { type: 'unsupported' }
    // @ts-expect-error <Option correct> must be a boolean.
    const stringCorrect: OptionProps = { value: 'a', correct: 'yes' }
    // @ts-expect-error <Option value> is required.
    const missingValue: OptionProps = { correct: true }
    // @ts-expect-error <Questionnaire contributesToScore> must be a boolean.
    const invalidScoreContribution: QuestionnaireProps = { contributesToScore: 'no' }
    // @ts-expect-error <Questionnaire revealCorrectAnswers> must be a boolean.
    const invalidRevealCorrectAnswers: QuestionnaireProps = { revealCorrectAnswers: 'no' }

    expect([
      sourcePage,
      referencePage,
      tiles,
      item,
      singleChoice,
      multipleChoice,
      trueFalse,
      includedQuestionnaire,
      excludedQuestionnaire,
      hiddenAnswersQuestionnaire,
      option,
      correctOption,
      incorrectOption,
      neitherPage,
      bothPage,
      stringColumns,
      invalidQuestion,
      stringCorrect,
      missingValue,
      invalidScoreContribution,
      invalidRevealCorrectAnswers
    ]).toHaveLength(21)
  })

  it('restricts Prompt and Option children to plain text', () => {
    expectTypeOf<PromptProps['children']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<OptionProps['children']>().toEqualTypeOf<string | undefined>()

    const prompt = { children: 'Choose an answer' } satisfies PromptProps
    const option = { value: 'yes', children: 'Yes' } satisfies OptionProps
    const reactElement = {} as ReactElement

    // @ts-expect-error <Prompt> children must be plain text.
    const promptElement: PromptProps = { children: reactElement }
    // @ts-expect-error <Prompt> children must be plain text.
    const promptNumber: PromptProps = { children: 42 }
    // @ts-expect-error <Option> children must be plain text.
    const optionElement: OptionProps = { value: 'no', children: reactElement }
    // @ts-expect-error <Option> children must be plain text.
    const optionNumber: OptionProps = { value: 'no', children: 42 }

    expect([prompt, option, promptElement, promptNumber, optionElement, optionNumber]).toHaveLength(
      6
    )
  })
})
