import { describe, expect, it } from 'vitest';
import type { AstNode } from '../ast';
import { normalizeQuestionChildren, questionAnswerRuleError } from '../question';

describe('question answer rules', () => {
  it.each([
    ['single-choice', 2, 0, 'single-choice Question must have exactly one correct Option'],
    ['single-choice', 2, 2, 'single-choice Question must have exactly one correct Option'],
    ['multiple-choice', 3, 0, 'multiple-choice Question must have at least one correct Option'],
    ['true-false', 3, 0, 'true-false Question must have exactly 2 Options'],
    ['true-false', 2, 0, 'true-false Question must have exactly one correct Option'],
    ['true-false', 2, 2, 'true-false Question must have exactly one correct Option'],
  ] as const)('rejects %s counts (%i options, %i correct)', (type, options, correct, message) => {
    expect(questionAnswerRuleError(type, options, correct)).toBe(message);
  });

  it.each([
    ['single-choice', 2, 1],
    ['multiple-choice', 2, 1],
    ['multiple-choice', 4, 3],
    ['true-false', 2, 1],
  ] as const)('accepts %s counts (%i options, %i correct)', (type, options, correct) => {
    expect(questionAnswerRuleError(type, options, correct)).toBeUndefined();
  });
});

describe('normalizeQuestionChildren', () => {
  const prompt: AstNode = { type: 'mdxJsxFlowElement', name: 'Prompt' };
  const option: AstNode = { type: 'mdxJsxFlowElement', name: 'Option' };

  it('unwraps paragraphs containing only whitespace and allowed components', () => {
    const result = normalizeQuestionChildren(
      [
        { type: 'text', value: '\n  ' },
        { type: 'paragraph', children: [{ type: 'text', value: '\n' }, prompt, option] },
      ],
      ['Prompt', 'Option'],
    );

    expect(result).toEqual([prompt, option]);
  });

  it('preserves paragraphs that contain other content and their position', () => {
    const mixed: AstNode = {
      type: 'paragraph',
      children: [{ type: 'text', value: 'stray text' }, prompt],
    };

    expect(normalizeQuestionChildren([prompt, mixed, option], ['Prompt', 'Option'])).toEqual([
      prompt,
      mixed,
      option,
    ]);
  });
});
