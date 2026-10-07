// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuestionView } from '../app/components/QuestionView';
import type { ContentNode } from '../app/types';

type QuestionNode = Extract<ContentNode, { type: 'question' }>;

const singleChoice: QuestionNode = {
  type: 'question',
  questionType: 'single-choice',
  prompt: [
    { type: 'paragraph', children: [{ type: 'text', value: 'Pick one' }] },
  ],
  options: [
    {
      value: 'first',
      correct: true,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'First' }] },
      ],
    },
    {
      value: 'second',
      correct: false,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Second' }] },
      ],
    },
  ],
};

const multipleChoice: QuestionNode = {
  ...singleChoice,
  questionType: 'multiple-choice',
};

const trueFalse: QuestionNode = {
  type: 'question',
  questionType: 'true-false',
  prompt: [
    { type: 'paragraph', children: [{ type: 'text', value: 'Is it true?' }] },
  ],
  options: [
    {
      value: 'true',
      correct: true,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'True' }] },
      ],
    },
    {
      value: 'false',
      correct: false,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'False' }] },
      ],
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function input(value: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(
    `input[value="${value}"]`,
  );
  if (!element) {
    throw new Error(`Input not found for value: ${value}`);
  }
  return element;
}

describe('QuestionView', () => {
  it('lists option values and selects a single-choice option', () => {
    act(() => root.render(<QuestionView node={singleChoice} />));

    expect(input('first').type).toBe('radio');
    expect(input('second').type).toBe('radio');
    // Radios in the same group share a name so only one can be selected.
    expect(input('first').name).toBe(input('second').name);
    expect(input('first').checked).toBe(false);

    act(() => input('second').click());
    expect(input('second').checked).toBe(true);
    expect(input('first').checked).toBe(false);

    act(() => input('first').click());
    expect(input('first').checked).toBe(true);
    expect(input('second').checked).toBe(false);
  });

  it('toggles independent checkboxes for a multiple-choice question', () => {
    act(() => root.render(<QuestionView node={multipleChoice} />));

    expect(input('first').type).toBe('checkbox');
    act(() => input('first').click());
    act(() => input('second').click());
    expect(input('first').checked).toBe(true);
    expect(input('second').checked).toBe(true);

    act(() => input('first').click());
    expect(input('first').checked).toBe(false);
    expect(input('second').checked).toBe(true);
  });

  it('renders true-false as a radio group keyed by option value', () => {
    act(() => root.render(<QuestionView node={trueFalse} />));

    expect(input('true').type).toBe('radio');
    expect(input('false').type).toBe('radio');
    act(() => input('false').click());
    expect(input('false').checked).toBe(true);
    expect(input('true').checked).toBe(false);
  });

  it('names the fieldset from the rich prompt and each input from its content', () => {
    act(() => root.render(<QuestionView node={singleChoice} />));

    const fieldset = container.querySelector('fieldset');
    const labelledBy = fieldset?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(
      document.getElementById(labelledBy as string)?.textContent,
    ).toContain('Pick one');

    const optionLabelId = input('first').getAttribute('aria-labelledby');
    expect(optionLabelId).toBeTruthy();
    expect(
      document.getElementById(optionLabelId as string)?.textContent,
    ).toContain('First');
  });
});
