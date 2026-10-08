import { useId, useRef } from 'react';
import type {
  AnswerValue,
  PageNode,
  PlayerPageState,
  QuestionnaireNode,
  QuestionNode,
} from '../types';
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
import { Card, CardContent } from './ui/card';

export type { QuestionNode };

export interface QuestionnaireViewProps {
  node: QuestionnaireNode;
  /**
   * Saved answers for the owning page/item, keyed by `QuestionNode.id`.
   * Supplying this controls the rendered selection, so restored answers display
   * as checked. It does not report interactions on its own; supply
   * {@link onAnswer} as well for a fully controlled questionnaire.
   */
  answers?: Record<string, AnswerValue>;
  /**
   * Whether this questionnaire's wrapper id is already in the owning page's
   * `submittedQuestionnaires`. Submitted questionnaires render read-only.
   */
  submitted?: boolean;
  /**
   * Reports a single question interaction for the owning page/item so the owner
   * can persist it. Multiple-choice answers are string arrays; single-choice and
   * true-false are strings. Supplying this reports changes but does not by itself
   * drive the selection; supply {@link answers} as well for fully controlled
   * updates.
   */
  onAnswer?: (questionId: string, value: AnswerValue) => void;
  /**
   * Invoked exactly once, with the questionnaire id, after every question has
   * been answered and the learner submits. Submission is never graded and
   * correctness is never revealed.
   */
  onSubmitted?: (id: string) => void;
  /**
   * The root presentation's pages, so a Path authored inside a question prompt
   * or option resolves its references to display metadata. Forwarded unchanged
   * to every nested {@link ContentRenderer}.
   */
  pathPages?: readonly PageNode[];
  /**
   * Persisted state per root page id, so a nested Path can read which referenced
   * pages are already visited. Forwarded unchanged to every nested
   * {@link ContentRenderer}.
   */
  pageStates?: Record<string, PlayerPageState>;
  /**
   * Opens a referenced root page through the presentation's existing page
   * switching, so a nested Path can offer navigation. Forwarded unchanged to
   * every nested {@link ContentRenderer}.
   */
  onNavigatePathPage?: (pageId: string) => void;
}

/**
 * The Path rendering context forwarded verbatim to every nested
 * {@link ContentRenderer}, so a Path authored inside a questionnaire prompt or
 * option behaves exactly like one authored at the page top level.
 */
type NestedPathContext = Pick<
  QuestionnaireViewProps,
  'pathPages' | 'pageStates' | 'onNavigatePathPage'
>;

/**
 * A grouped questionnaire rendered through the shadcn questionnaire UI: one
 * `Questionnaire.Root` with one `Questionnaire.Item` per question, navigated as
 * a wizard (Previous/Next) and finished with a single "Submit questionnaire"
 * action on the last question.
 *
 * The authored `questions` are declared once as the Root's `items` collection
 * and mapped into the parts, exactly as the component docs compose it. The
 * collection lets the active item server-render and marks every question
 * required, so `Next` and the final submit stay blocked until each item has an
 * answer. Items are keyed by their stable `QuestionNode.id`, so restoring an
 * answer is a lookup rather than positional. The questionnaire is controlled
 * whenever the owner supplies `answers`, `onAnswer`, or both: `answers` drives
 * the rendered selection, `onAnswer` reports interactions, and supplying both
 * yields fully controlled updates. Once the wrapper id is marked submitted the
 * questionnaire renders its answers read-only, so a restored submission cannot
 * be edited or re-submitted.
 *
 * The renderer neither grades answers nor reveals which option was correct. The
 * rich prompt and each option are rendered as content, and the submission
 * callback bubbles through them so nested block content can still surface
 * questionnaires. The Path rendering context is forwarded the same way, so a
 * Path authored in a prompt or option resolves its references and navigates
 * exactly like one at the page level.
 */
export function QuestionnaireView({
  node,
  answers,
  submitted = false,
  onAnswer,
  onSubmitted,
  pathPages,
  pageStates,
  onNavigatePathPage,
}: QuestionnaireViewProps) {
  const submittedRef = useRef(false);
  // Bundled once so it can be forwarded verbatim to every nested renderer.
  const pathContext: NestedPathContext = {
    pathPages,
    pageStates,
    onNavigatePathPage,
  };

  if (node.questions.length === 0) {
    return null;
  }

  if (submitted) {
    return (
      <SubmittedQuestionnaire
        node={node}
        answers={answers}
        pathContext={pathContext}
      />
    );
  }

  // The primitive owns the selection only when the owner supplies neither
  // `answers` nor `onAnswer` (the standalone/default case). Supplying `answers`
  // controls the rendered selection, supplying `onAnswer` reports interactions,
  // and callers that want fully controlled updates supply both.
  const controlled = onAnswer !== undefined || answers !== undefined;

  // Declare the authored questions once: the Root uses the collection for
  // server rendering, required-answer validation and the wizard order.
  const items = node.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((option) => ({ value: option.value })),
  }));

  return (
    <Card>
      <CardContent>
        <Questionnaire
          items={items}
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
              controlled={controlled}
              value={answers?.[question.id]}
              onAnswer={onAnswer}
              onQuestionnaireSubmitted={onSubmitted}
              pathContext={pathContext}
            />
          ))}

          <QuestionnaireActions>
            <QuestionnairePrevious>Previous question</QuestionnairePrevious>
            <QuestionnaireNext>Next question</QuestionnaireNext>
            <QuestionnaireSubmit>Submit questionnaire</QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
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
  controlled,
  value,
  onAnswer,
  onQuestionnaireSubmitted,
  pathContext,
}: {
  node: QuestionNode;
  controlled: boolean;
  value: AnswerValue | undefined;
  onAnswer?: (questionId: string, value: AnswerValue) => void;
  onQuestionnaireSubmitted?: (id: string) => void;
  pathContext: NestedPathContext;
}) {
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
      name={node.id}
      multiple={multiple}
      required
      aria-labelledby={promptId}
      className='not-prose'
    >
      <QuestionnaireTitle id={promptId}>
        <ContentRenderer
          nodes={node.prompt}
          onQuestionnaireSubmitted={onQuestionnaireSubmitted}
          {...pathContext}
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
              onQuestionnaireSubmitted={onQuestionnaireSubmitted}
              {...pathContext}
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
 * and the choices disabled, so a restored submission is visible but cannot be
 * changed or re-submitted.
 *
 * The primitive has no disabled Root, and a disabled `Questionnaire.Item` is
 * hidden by design (`hidden`/`inert` follow the active item), so each question
 * gets its own single-item Root. The item stays active while its choices are
 * disabled, which keeps the fieldset/legend semantics and the Questionnaire
 * choice markup intact without overriding the primitive's internals.
 */
function SubmittedQuestionnaire({
  node,
  answers,
  pathContext,
}: {
  node: QuestionnaireNode;
  answers?: Record<string, AnswerValue>;
  pathContext: NestedPathContext;
}) {
  return (
    <Card className='not-prose '>
      <CardContent className='space-y-6'>
        {node.questions.map((question) => (
          <SubmittedQuestion
            key={question.id}
            question={question}
            value={answers?.[question.id]}
            pathContext={pathContext}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SubmittedQuestion({
  question,
  value,
  pathContext,
}: {
  question: QuestionNode;
  value: AnswerValue | undefined;
  pathContext: NestedPathContext;
}) {
  const promptId = useId();
  // Single-choice and true-false become radios; multiple-choice checkboxes.
  const multiple = question.questionType === 'multiple-choice';

  return (
    <Questionnaire items={[{ name: question.id }]}>
      <QuestionnaireItem
        name={question.id}
        multiple={multiple}
        aria-labelledby={promptId}
      >
        <QuestionnaireTitle id={promptId}>
          <ContentRenderer nodes={question.prompt} {...pathContext} />
        </QuestionnaireTitle>

        <QuestionnaireChoices>
          {question.options.map((option) => (
            <QuestionnaireChoice
              key={option.value}
              value={option.value}
              disabled
              checked={isSelected(question, value, option.value)}
            >
              <ContentRenderer nodes={option.content} {...pathContext} />
            </QuestionnaireChoice>
          ))}
        </QuestionnaireChoices>
      </QuestionnaireItem>
    </Questionnaire>
  );
}
