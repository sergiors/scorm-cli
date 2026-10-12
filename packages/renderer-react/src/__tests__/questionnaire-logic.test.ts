import { describe, expect, it } from 'vitest';
import {
  answerAfterChange,
  isOptionSelected,
  submittedOptionResult,
} from '../../app/lib/questionnaire';
import type { QuestionNode } from '../../app/types';
import { multipleChoiceQuestion, singleChoiceQuestion } from './fixtures';

/** A multiple-choice question with three options to exercise authored order. */
const threeOptions: QuestionNode = {
  type: 'question',
  id: 'question:order.mdx:1:1',
  questionType: 'multiple-choice',
  prompt: [{ type: 'paragraph', children: [{ type: 'text', value: 'Pick some' }] }],
  options: ['one', 'two', 'three'].map((value) => ({
    value,
    correct: value === 'one',
    content: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
  })),
};

describe('isOptionSelected', () => {
  it('matches a single-choice option by string identity', () => {
    expect(isOptionSelected(singleChoiceQuestion, 'first', 'first')).toBe(true);
    expect(isOptionSelected(singleChoiceQuestion, 'first', 'second')).toBe(false);
  });

  it('matches a multiple-choice option by array membership', () => {
    expect(isOptionSelected(multipleChoiceQuestion, ['alpha', 'beta'], 'alpha')).toBe(true);
    expect(isOptionSelected(multipleChoiceQuestion, ['alpha'], 'beta')).toBe(false);
  });

  it('treats an undefined answer as selecting nothing', () => {
    expect(isOptionSelected(singleChoiceQuestion, undefined, 'first')).toBe(false);
    expect(isOptionSelected(multipleChoiceQuestion, undefined, 'alpha')).toBe(false);
  });

  it('does not treat a wrong-shaped answer as a match', () => {
    // A string answer never selects a multiple-choice option, and an array
    // answer never selects a single-choice option.
    expect(isOptionSelected(multipleChoiceQuestion, 'alpha', 'alpha')).toBe(false);
    expect(isOptionSelected(singleChoiceQuestion, ['first'], 'first')).toBe(false);
  });
});

describe('answerAfterChange', () => {
  it('keeps the chosen option value for single-choice regardless of check state', () => {
    expect(answerAfterChange(singleChoiceQuestion, undefined, 'first', true)).toBe('first');
    expect(answerAfterChange(singleChoiceQuestion, 'first', 'second', true)).toBe('second');
  });

  it('adds a checked multiple-choice option to the saved array', () => {
    expect(answerAfterChange(multipleChoiceQuestion, undefined, 'alpha', true)).toEqual(['alpha']);
    expect(answerAfterChange(multipleChoiceQuestion, ['alpha'], 'beta', true)).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('removes an unchecked multiple-choice option from the saved array', () => {
    expect(answerAfterChange(multipleChoiceQuestion, ['alpha', 'beta'], 'alpha', false)).toEqual([
      'beta',
    ]);
  });

  it('keeps multiple-choice answers in authored option order regardless of toggle order', () => {
    const toggledBetaThenAlpha = answerAfterChange(threeOptions, undefined, 'two', true);
    const withAlpha = answerAfterChange(threeOptions, toggledBetaThenAlpha, 'one', true);
    // Selecting alpha after beta still persists authored order.
    expect(withAlpha).toEqual(['one', 'two']);
  });

  it('ignores a wrong-shaped saved answer', () => {
    // A string saved on a multiple-choice question is treated as no selection.
    expect(answerAfterChange(multipleChoiceQuestion, 'alpha', 'beta', true)).toEqual(['beta']);
  });

  it('does not mutate the saved array', () => {
    const saved = ['alpha'];
    answerAfterChange(multipleChoiceQuestion, saved, 'beta', true);
    expect(saved).toEqual(['alpha']);
  });
});

describe('submittedOptionResult', () => {
  const correct = { value: 'first', correct: true, content: [] };
  const wrong = { value: 'second', correct: false, content: [] };

  it('is correct for a correct option whether or not it was selected', () => {
    expect(submittedOptionResult(correct, true)).toBe('correct');
    expect(submittedOptionResult(correct, false)).toBe('correct');
  });

  it('is incorrect for a wrong option the learner selected', () => {
    expect(submittedOptionResult(wrong, true)).toBe('incorrect');
  });

  it('is neutral for a wrong option the learner left unselected', () => {
    expect(submittedOptionResult(wrong, false)).toBe('neutral');
  });
});
