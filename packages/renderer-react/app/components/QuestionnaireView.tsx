import { useId, useRef } from 'react';
import type { AnswerValue, QuestionnaireNode, QuestionNode } from '../types';
import { ContentRenderer } from './ContentRenderer';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from './ui/questionnaire';

export type { QuestionNode };

export interface QuestionnaireViewProps {
  node: QuestionnaireNode;
  /** Forwarded to nested rich content so headings stay nested correctly. */
  headingOffset?: number;
  /**
   * Saved answers for the owning page/item, keyed by `QuestionNode.id`. When
   * present the questionnaire is controlled by this map, so restored selections
   * render and every edit is reported through {@link onAnswer}.
   */
  answers?: Record<string, AnswerValue>;
  /**
   * Whether this questionnaire's wrapper id is already in the owning page's
   * `submittedQuestionnaires`. Submitted questionnaires render read-only.
   */
  submitted?: boolean;
  /**
   * Persists a single question answer for the owning page/item. Multiple-choice
   * answers are string arrays; single-choice and true-false are strings.
   */
  onAnswer?: (questionId: string, value: AnswerValue) => void;
  /**
   * Invoked exactly once, with the questionnaire id, after every question has
   * been answered and the learner submits. Submission is never graded and
   * correctness is never revealed.
   */
  onSubmitted?: (id: string) => void;
}

/**
 * A grouped questionnaire rendered through the shadcn questionnaire UI: one
 * `Questionnaire.Root` with one `Questionnaire.Item` per question, navigated as
 * a wizard (Previous/Next) and finished with a single "Submit questionnaire"
 * action on the last question.
 *
 * Each question is keyed by its stable `QuestionNode.id`, so restoring an answer
 * is a lookup rather than positional. When the owning page supplies answers the
 * choices become controlled: the saved value drives the selection and every
 * change is reported under that question id. Once the wrapper id is marked
 * submitted the questionnaire renders its answers read-only, so a restored
 * submission cannot be edited or re-submitted.
 *
 * Every question is required, so the primitive blocks advancing with `Next` and
 * blocks the final submit until each item has an answer; the renderer neither
 * grades answers nor reveals which option was correct. The rich prompt and each
 * option are rendered as content, and the submission callback bubbles through
 * them so nested block content can still surface questionnaires.
 */
export function QuestionnaireView({
  node,
  headingOffset = 0,
  answers,
  submitted = false,
  onAnswer,
  onSubmitted,
}: QuestionnaireViewProps) {
  const submittedRef = useRef(false);

  if (node.questions.length === 0) {
    return null;
  }

  if (submitted) {
    return (
      <SubmittedQuestionnaire
        node={node}
        answers={answers}
        headingOffset={headingOffset}
      />
    );
  }

  // Answers make the questionnaire controlled; without them the primitive owns
  // the selection (the standalone/default case).
  const controlled = onAnswer !== undefined || answers !== undefined;

  return (
    <Questionnaire
      className='rounded-lg border border-border bg-card p-4'
      onSubmit={(event) => {
        // The root only reaches this handler once every required item has an
        // answer. Never let the browser navigate away, and forward the
        // submission once even if the learner submits repeatedly.
        event.preventDefault();
        if (submittedRef.current) {
          return;
        }
        submittedRef.current = true;
        onSubmitted?.(node.id);
      }}
    >
      {node.questions.map((question) => (
        <QuestionnaireQuestion
          key={question.id}
          node={question}
          headingOffset={headingOffset}
          controlled={controlled}
          value={answers?.[question.id]}
          onAnswer={onAnswer}
          onQuestionnaireSubmitted={onSubmitted}
        />
      ))}

      <QuestionnaireActions>
        <QuestionnairePrevious>Previous question</QuestionnairePrevious>
        <QuestionnaireNext>Next question</QuestionnaireNext>
        <QuestionnaireSubmit>Submit questionnaire</QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

function isSelected(
  question: QuestionNode,
  value: AnswerValue | undefined,
  optionValue: string,
): boolean {
  if (question.questionType === 'multiple-choice') {
    return Array.isArray(value) && value.includes(optionValue);
  }
  return value === optionValue;
}

function QuestionnaireQuestion({
  node,
  headingOffset,
  controlled,
  value,
  onAnswer,
  onQuestionnaireSubmitted,
}: {
  node: QuestionNode;
  headingOffset: number;
  controlled: boolean;
  value: AnswerValue | undefined;
  onAnswer?: (questionId: string, value: AnswerValue) => void;
  onQuestionnaireSubmitted?: (id: string) => void;
}) {
  const name = useId();
  const promptId = useId();
  // Single-choice and true-false become radios; multiple-choice checkboxes.
  const multiple = node.questionType === 'multiple-choice';

  const handleChange = (optionValue: string, checked: boolean) => {
    if (!onAnswer) {
      return;
    }
    if (multiple) {
      // Keep the persisted array in authored option order so the value is
      // deterministic regardless of the order options were toggled.
      const current = Array.isArray(value) ? value : [];
      const next = node.options
        .map((option) => option.value)
        .filter((candidate) =>
          candidate === optionValue ? checked : current.includes(candidate),
        );
      onAnswer(node.id, next);
      return;
    }
    onAnswer(node.id, optionValue);
  };

  return (
    <QuestionnaireItem
      name={name}
      multiple={multiple}
      required
      aria-labelledby={promptId}
    >
      <QuestionnaireTitle id={promptId}>
        <ContentRenderer
          nodes={node.prompt}
          headingOffset={headingOffset}
          onQuestionnaireSubmitted={onQuestionnaireSubmitted}
        />
      </QuestionnaireTitle>

      <QuestionnaireChoices>
        {node.options.map((option) => (
          <QuestionnaireChoice
            key={option.value}
            value={option.value}
            checked={
              controlled ? isSelected(node, value, option.value) : undefined
            }
            onChange={
              controlled
                ? (event) => handleChange(option.value, event.target.checked)
                : undefined
            }
          >
            <ContentRenderer
              nodes={option.content}
              headingOffset={headingOffset}
              onQuestionnaireSubmitted={onQuestionnaireSubmitted}
            />
          </QuestionnaireChoice>
        ))}
      </QuestionnaireChoices>

      <QuestionnaireError />
    </QuestionnaireItem>
  );
}

/**
 * Read-only rendering of a submitted questionnaire. Every question is shown at
 * once (there is no wizard left to navigate) with its saved selection checked
 * and the inputs disabled, so a restored submission is visible but cannot be
 * changed or re-submitted.
 */
function SubmittedQuestionnaire({
  node,
  answers,
  headingOffset,
}: {
  node: QuestionnaireNode;
  answers?: Record<string, AnswerValue>;
  headingOffset: number;
}) {
  return (
    <div className='flex flex-col gap-4 rounded-lg border border-border bg-card p-4'>
      {node.questions.map((question) => (
        <SubmittedQuestion
          key={question.id}
          question={question}
          value={answers?.[question.id]}
          headingOffset={headingOffset}
        />
      ))}
    </div>
  );
}

function SubmittedQuestion({
  question,
  value,
  headingOffset,
}: {
  question: QuestionNode;
  value: AnswerValue | undefined;
  headingOffset: number;
}) {
  const promptId = useId();
  const multiple = question.questionType === 'multiple-choice';

  return (
    <fieldset
      disabled
      aria-labelledby={promptId}
      className='flex min-w-0 flex-col gap-4 border-0 p-0'
    >
      <legend
        id={promptId}
        className='text-base leading-snug font-medium text-pretty'
      >
        <ContentRenderer
          nodes={question.prompt}
          headingOffset={headingOffset}
        />
      </legend>

      <div className='grid min-w-0 gap-2'>
        {question.options.map((option) => (
          <label
            key={option.value}
            className='flex min-h-11 cursor-not-allowed items-start gap-2.5 rounded-lg border border-input bg-transparent px-3 py-2.5 text-start text-sm opacity-70 select-none'
          >
            <input
              type={multiple ? 'checkbox' : 'radio'}
              value={option.value}
              checked={isSelected(question, value, option.value)}
              readOnly
              disabled
              className='mt-1 size-4 shrink-0 accent-primary'
            />
            <span className='flex min-w-0 flex-1 flex-col gap-0.5 leading-snug'>
              <ContentRenderer
                nodes={option.content}
                headingOffset={headingOffset}
              />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
