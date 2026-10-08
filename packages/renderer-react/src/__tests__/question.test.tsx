// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionnaireView } from '../../app/components/QuestionnaireView';
import type { AnswerValue, ContentNode } from '../../app/types';
import {
  multipleChoiceQuestion,
  questionnaireNode,
  singleChoiceQuestion,
} from './fixtures';

type QuestionNode = Extract<
  ContentNode,
  { type: 'questionnaire' }
>['questions'][number];

const trueFalse: QuestionNode = {
  type: 'question',
  id: 'question:check.mdx:1:1',
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

/** Visible button whose label matches exactly; hidden wizard controls are skipped. */
function button(label: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button')).find(
    (candidate) =>
      !candidate.hasAttribute('hidden') &&
      candidate.textContent?.trim() === label,
  );
  if (!element) {
    throw new Error(`Visible button not found: ${label}`);
  }
  return element;
}

/** The currently displayed question item. */
function activeItem(): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    '[data-slot="questionnaire-item"]:not([hidden])',
  );
  if (!element) {
    throw new Error('No active questionnaire item');
  }
  return element;
}

describe('QuestionnaireView', () => {
  it('renders one questionnaire item per question and navigates as a wizard', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />));

    expect(
      container.querySelectorAll('[data-slot="questionnaire-item"]'),
    ).toHaveLength(2);
    expect(activeItem().textContent).toContain('Which option is correct?');

    act(() => input('first').click());
    expect(input('first').checked).toBe(true);
    act(() => button('Next question').click());

    expect(activeItem().textContent).toContain('Which options apply?');

    act(() => button('Previous question').click());
    expect(activeItem().textContent).toContain('Which option is correct?');
    // Returning to an answered question preserves the answer.
    expect(input('first').checked).toBe(true);
  });

  it('uses radios for single-choice and checkboxes for multiple-choice', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />));

    expect(input('first').type).toBe('radio');
    expect(input('second').type).toBe('radio');

    act(() => input('first').click());
    act(() => button('Next question').click());

    expect(input('alpha').type).toBe('checkbox');
    expect(input('beta').type).toBe('checkbox');
  });

  it('refuses to submit until every question is answered', () => {
    const onSubmitted = vi.fn();
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          onSubmitted={onSubmitted}
        />,
      ),
    );

    act(() => input('first').click());
    act(() => button('Next question').click());

    // On the final question the submit action is offered, but the unanswered
    // multiple-choice item blocks it.
    act(() => button('Submit questionnaire').click());
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(activeItem().textContent).toContain('Which options apply?');

    act(() => input('alpha').click());
    act(() => button('Submit questionnaire').click());
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledWith(questionnaireNode.id);
  });

  it('invokes the submitted callback exactly once across repeated submits', () => {
    const onSubmitted = vi.fn();
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          onSubmitted={onSubmitted}
        />,
      ),
    );

    act(() => input('first').click());
    act(() => button('Next question').click());
    act(() => input('alpha').click());
    act(() => button('Submit questionnaire').click());
    act(() => button('Submit questionnaire').click());

    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it('renders true-false as a radio group keyed by option value', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={{
            type: 'questionnaire',
            id: 'questionnaire:check.mdx:1:1',
            questions: [trueFalse],
          }}
        />,
      ),
    );

    expect(input('true').type).toBe('radio');
    expect(input('false').type).toBe('radio');
    act(() => input('false').click());
    expect(input('false').checked).toBe(true);
    expect(input('true').checked).toBe(false);
  });

  it('names the fieldset from the rich prompt and never reveals correctness', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />));

    const fieldset = activeItem();
    const labelledBy = fieldset.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(
      document.getElementById(labelledBy as string)?.textContent,
    ).toContain('Which option is correct?');
    expect(container.innerHTML).not.toContain('correct=');
    expect(container.innerHTML).not.toContain('data-correct');
  });
});

/** Renders a questionnaire controlled by local answer state, like a page does. */
function ControlledQuestionnaire({
  initialAnswers = {},
  onSubmitted,
}: {
  initialAnswers?: Record<string, AnswerValue>;
  onSubmitted?: (id: string) => void;
}) {
  const [answers, setAnswers] =
    useState<Record<string, AnswerValue>>(initialAnswers);
  return (
    <QuestionnaireView
      node={questionnaireNode}
      answers={answers}
      onAnswer={(questionId, value) =>
        setAnswers((previous) => ({ ...previous, [questionId]: value }))
      }
      onSubmitted={onSubmitted}
    />
  );
}

describe('QuestionnaireView persistence', () => {
  it('reports every answer change under the question id', () => {
    const onAnswer = vi.fn();
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{}}
          onAnswer={onAnswer}
        />,
      ),
    );

    act(() => input('first').click());
    expect(onAnswer).toHaveBeenLastCalledWith(singleChoiceQuestion.id, 'first');

    act(() => button('Next question').click());
    act(() => input('alpha').click());
    expect(onAnswer).toHaveBeenLastCalledWith(multipleChoiceQuestion.id, [
      'alpha',
    ]);
  });

  it('persists multiple-choice answers as string arrays', () => {
    act(() => root.render(<ControlledQuestionnaire />));

    act(() => input('first').click());
    act(() => button('Next question').click());
    act(() => input('alpha').click());
    expect(input('alpha').checked).toBe(true);

    act(() => input('beta').click());
    expect(input('alpha').checked).toBe(true);
    expect(input('beta').checked).toBe(true);

    act(() => input('alpha').click());
    expect(input('alpha').checked).toBe(false);
    expect(input('beta').checked).toBe(true);
  });

  it('restores saved selections from the page answers', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['alpha'],
          }}
          onAnswer={() => {}}
        />,
      ),
    );

    expect(input('second').checked).toBe(true);
    expect(input('first').checked).toBe(false);

    act(() => button('Next question').click());
    expect(input('alpha').checked).toBe(true);
    expect(input('beta').checked).toBe(false);
  });

  it('marks the wrapper submitted after a successful final submit', () => {
    const onSubmitted = vi.fn();
    act(() =>
      root.render(<ControlledQuestionnaire onSubmitted={onSubmitted} />),
    );

    act(() => input('first').click());
    act(() => button('Next question').click());
    act(() => input('alpha').click());
    act(() => button('Submit questionnaire').click());

    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledWith(questionnaireNode.id);
  });

  it('renders a submitted questionnaire read-only with every answer visible', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'first',
            [multipleChoiceQuestion.id]: ['alpha', 'beta'],
          }}
          submitted
        />,
      ),
    );

    // Both questions are shown at once, with their saved selections checked and
    // disabled; there is no wizard or submit action left.
    expect(input('first').checked).toBe(true);
    expect(input('first').disabled).toBe(true);
    expect(input('alpha').checked).toBe(true);
    expect(input('beta').checked).toBe(true);
    expect(input('beta').disabled).toBe(true);
    expect(container.textContent).not.toContain('Submit questionnaire');
    expect(container.textContent).not.toContain('Next question');
  });
});
