import { describe, expect, it } from 'vitest'
import {
  answerAfterChange,
  getQuestionnaireResult,
  isOptionSelected,
  submittedOptionResult
} from '../../app/lib/questionnaire'
import type { QuestionNode, QuestionnaireNode } from '../../app/types'
import { multipleChoiceQuestion, questionnaireNode, singleChoiceQuestion } from './fixtures'

/** A multiple-choice question with three options to exercise authored order. */
const threeOptions: QuestionNode = {
  type: 'question',
  id: 'question:order.mdx:1:1',
  questionType: 'multiple-choice',
  prompt: 'Pick some',
  options: ['one', 'two', 'three'].map((value) => ({
    value,
    correct: value === 'one',
    content: value
  }))
}

/** A multiple-choice question with two correct and one incorrect option. */
const multipleCorrectQuestion: QuestionNode = {
  type: 'question',
  id: 'question:multiple-correct.mdx:1:1',
  questionType: 'multiple-choice',
  prompt: 'Pick every correct option',
  options: [
    { value: 'a', correct: true, content: 'A' },
    { value: 'b', correct: true, content: 'B' },
    { value: 'c', correct: false, content: 'C' }
  ]
}

const trueFalseQuestion: QuestionNode = {
  type: 'question',
  id: 'question:true-false.mdx:1:1',
  questionType: 'true-false',
  prompt: 'True or false?',
  options: [
    { value: 'true', correct: true, content: 'True' },
    { value: 'false', correct: false, content: 'False' }
  ]
}

/** Single-choice, multiple-choice and true-false in one questionnaire. */
const evaluationQuestionnaire: QuestionnaireNode = {
  ...questionnaireNode,
  questions: [singleChoiceQuestion, multipleCorrectQuestion, trueFalseQuestion]
}

describe('isOptionSelected', () => {
  it('matches a single-choice option by string identity', () => {
    expect(isOptionSelected(singleChoiceQuestion, 'first', 'first')).toBe(true)
    expect(isOptionSelected(singleChoiceQuestion, 'first', 'second')).toBe(false)
  })

  it('matches a multiple-choice option by array membership', () => {
    expect(isOptionSelected(multipleChoiceQuestion, ['alpha', 'beta'], 'alpha')).toBe(true)
    expect(isOptionSelected(multipleChoiceQuestion, ['alpha'], 'beta')).toBe(false)
  })

  it('treats an undefined answer as selecting nothing', () => {
    expect(isOptionSelected(singleChoiceQuestion, undefined, 'first')).toBe(false)
    expect(isOptionSelected(multipleChoiceQuestion, undefined, 'alpha')).toBe(false)
  })

  it('does not treat a wrong-shaped answer as a match', () => {
    // A string answer never selects a multiple-choice option, and an array
    // answer never selects a single-choice option.
    expect(isOptionSelected(multipleChoiceQuestion, 'alpha', 'alpha')).toBe(false)
    expect(isOptionSelected(singleChoiceQuestion, ['first'], 'first')).toBe(false)
  })
})

describe('answerAfterChange', () => {
  it('keeps the chosen option value for single-choice regardless of check state', () => {
    expect(answerAfterChange(singleChoiceQuestion, undefined, 'first', true)).toBe('first')
    expect(answerAfterChange(singleChoiceQuestion, 'first', 'second', true)).toBe('second')
  })

  it('adds a checked multiple-choice option to the saved array', () => {
    expect(answerAfterChange(multipleChoiceQuestion, undefined, 'alpha', true)).toEqual(['alpha'])
    expect(answerAfterChange(multipleChoiceQuestion, ['alpha'], 'beta', true)).toEqual([
      'alpha',
      'beta'
    ])
  })

  it('removes an unchecked multiple-choice option from the saved array', () => {
    expect(answerAfterChange(multipleChoiceQuestion, ['alpha', 'beta'], 'alpha', false)).toEqual([
      'beta'
    ])
  })

  it('keeps multiple-choice answers in authored option order regardless of toggle order', () => {
    const toggledBetaThenAlpha = answerAfterChange(threeOptions, undefined, 'two', true)
    const withAlpha = answerAfterChange(threeOptions, toggledBetaThenAlpha, 'one', true)
    // Selecting alpha after beta still persists authored order.
    expect(withAlpha).toEqual(['one', 'two'])
  })

  it('ignores a wrong-shaped saved answer', () => {
    // A string saved on a multiple-choice question is treated as no selection.
    expect(answerAfterChange(multipleChoiceQuestion, 'alpha', 'beta', true)).toEqual(['beta'])
  })

  it('does not mutate the saved array', () => {
    const saved = ['alpha']
    answerAfterChange(multipleChoiceQuestion, saved, 'beta', true)
    expect(saved).toEqual(['alpha'])
  })
})

describe('getQuestionnaireResult', () => {
  it('awards one point per correctly answered question and totals every question', () => {
    const result = getQuestionnaireResult(evaluationQuestionnaire, {
      [singleChoiceQuestion.id]: 'first',
      [multipleCorrectQuestion.id]: ['a', 'b'],
      [trueFalseQuestion.id]: 'true'
    })

    expect(result).toEqual({ correct: 3, total: 3 })
  })

  it('counts wrong answers and unanswered questions without a point', () => {
    const result = getQuestionnaireResult(evaluationQuestionnaire, {
      [singleChoiceQuestion.id]: 'second',
      [multipleCorrectQuestion.id]: ['a']
    })

    expect(result).toEqual({ correct: 0, total: 3 })
  })

  it('scores single-choice and true-false only when a correct option is selected', () => {
    expect(
      getQuestionnaireResult(evaluationQuestionnaire, {
        [singleChoiceQuestion.id]: 'first',
        [trueFalseQuestion.id]: 'false'
      }).correct
    ).toBe(1)

    expect(
      getQuestionnaireResult(evaluationQuestionnaire, {
        [singleChoiceQuestion.id]: 'second',
        [trueFalseQuestion.id]: 'true'
      }).correct
    ).toBe(1)
  })

  it('requires exact multiple-choice set equality regardless of selection order', () => {
    const resultFor = (value: string[]) =>
      getQuestionnaireResult(evaluationQuestionnaire, {
        [multipleCorrectQuestion.id]: value
      }).correct

    // Every correct option and nothing else, even when stored in another order.
    expect(resultFor(['a', 'b'])).toBe(1)
    expect(resultFor(['b', 'a'])).toBe(1)

    // A missing correct option, an extra incorrect option, or both earn nothing.
    expect(resultFor(['a'])).toBe(0)
    expect(resultFor(['b'])).toBe(0)
    expect(resultFor(['a', 'b', 'c'])).toBe(0)
    expect(resultFor(['c'])).toBe(0)
    expect(resultFor([])).toBe(0)
  })

  it('never credits a wrong-shaped or unknown answer', () => {
    expect(
      getQuestionnaireResult(evaluationQuestionnaire, {
        [singleChoiceQuestion.id]: ['first'],
        [multipleCorrectQuestion.id]: 'a',
        [trueFalseQuestion.id]: 'missing'
      })
    ).toEqual({ correct: 0, total: 3 })

    expect(getQuestionnaireResult(evaluationQuestionnaire, undefined)).toEqual({
      correct: 0,
      total: 3
    })
  })

  it('derives the result for questionnaires that do not contribute to score', () => {
    const optedOut: QuestionnaireNode = {
      ...evaluationQuestionnaire,
      contributesToScore: false
    }

    expect(
      getQuestionnaireResult(optedOut, {
        [singleChoiceQuestion.id]: 'first',
        [multipleCorrectQuestion.id]: ['a', 'b'],
        [trueFalseQuestion.id]: 'true'
      })
    ).toEqual({ correct: 3, total: 3 })
  })
})

describe('submittedOptionResult', () => {
  const correct = { value: 'first', correct: true, content: '' }
  const wrong = { value: 'second', correct: false, content: '' }

  it('is correct for a correct option whether or not it was selected', () => {
    expect(submittedOptionResult(correct, true)).toBe('correct')
    expect(submittedOptionResult(correct, false)).toBe('correct')
  })

  it('is incorrect for a wrong option the learner selected', () => {
    expect(submittedOptionResult(wrong, true)).toBe('incorrect')
  })

  it('is neutral for a wrong option the learner left unselected', () => {
    expect(submittedOptionResult(wrong, false)).toBe('neutral')
  })
})
