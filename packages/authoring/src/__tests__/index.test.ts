import { describe, expect, expectTypeOf, it } from 'vitest'
import * as authoring from '../index'
import type {
  AuthoringComponentName,
  GridProps,
  OptionProps,
  PageProps,
  QuestionProps,
  QuestionType,
  ScrollProps
} from '../index'

/** Canonical marker vocabulary; the parser asserts the same names stay aligned. */
const markerNames: AuthoringComponentName[] = [
  'Scroll',
  'Grid',
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
    const grid: GridProps = { columns: 2 }
    expect([sourcePage, referencePage, scroll, grid]).toHaveLength(4)
  })

  it('enforces authoring marker prop constraints at compile time', () => {
    // Accepted shapes compile; a bare JSX `correct` attribute passes `true`.
    const sourcePage = { src: 'lesson.mdx' } satisfies PageProps
    const referencePage = { ref: 'lesson.mdx' } satisfies PageProps
    const grid = { columns: 2 } satisfies GridProps
    const singleChoice = { type: 'single-choice' } satisfies QuestionProps
    const multipleChoice = { type: 'multiple-choice' } satisfies QuestionProps
    const trueFalse = { type: 'true-false' } satisfies QuestionProps
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
    // @ts-expect-error <Grid columns> must be a number.
    const stringColumns: GridProps = { columns: '2' }
    // @ts-expect-error <Question type> must be a supported kind.
    const invalidQuestion: QuestionProps = { type: 'unsupported' }
    // @ts-expect-error <Option correct> must be a boolean.
    const stringCorrect: OptionProps = { value: 'a', correct: 'yes' }
    // @ts-expect-error <Option value> is required.
    const missingValue: OptionProps = { correct: true }

    expect([
      sourcePage,
      referencePage,
      grid,
      singleChoice,
      multipleChoice,
      trueFalse,
      option,
      correctOption,
      incorrectOption,
      neitherPage,
      bothPage,
      stringColumns,
      invalidQuestion,
      stringCorrect,
      missingValue
    ]).toHaveLength(15)
  })
})
