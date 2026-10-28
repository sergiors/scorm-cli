import { useId, type HTMLAttributes, type SubmitEventHandler } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire'
import {
  answerAfterChange,
  getQuestionnaireResult,
  isOptionSelected,
  submittedOptionResult
} from '../lib/questionnaire'
import { shuffleQuestionOptions } from '../lib/shuffle'
import { Card, CardContent } from './ui/card'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle
} from './ui/questionnaire'
import {
  QuestionnaireSubmissionResult,
  submittedChoiceClassName,
  useQuestionnaireAnswers,
  useQuestionnaireSubmission,
  useQuestionnaireSession
} from './QuestionnaireShared'
import type { AnswerValue, QuestionNode, QuestionOption, QuestionnaireNode } from '../types'

interface StepperQuestionProps {
  node: QuestionNode
  /** Display order; a shuffled copy when the questionnaire enables shuffling. */
  options: readonly QuestionOption[]
  value: AnswerValue | undefined
  submitted: boolean
  revealCorrectAnswers: boolean
  onAnswer: (questionId: string, value: AnswerValue) => void
}

/**
 * One authored question rendered through the Questionnaire compound parts. The
 * Root owns which item is active, hiding and inerting the rest, so this only
 * describes the question, reports its choice interactions, and reveals its
 * submitted feedback.
 *
 * Submitted choices stay enabled on purpose: the primitive derives an item's
 * answer status from its non-disabled answer controls, so disabling them would
 * make every submitted question look unanswered and block review navigation.
 * The controlled `checked` value still keeps the saved answer immutable because
 * the submitted change handler drops the interaction and the primitive's own
 * controlled branch ignores it. The labelled item exposes the read-only review
 * through `aria-readonly` rather than disabling or muting its choices, so hover
 * and focus styling stay available.
 */
function StepperQuestion({
  node,
  options,
  value,
  submitted,
  revealCorrectAnswers,
  onAnswer
}: StepperQuestionProps) {
  const titleId = useId()
  const multiple = node.questionType === 'multiple-choice'

  return (
    <QuestionnaireItem
      name={node.id}
      required
      multiple={multiple}
      aria-labelledby={titleId}
      aria-readonly={submitted || undefined}
    >
      <QuestionnaireTitle id={titleId}>{node.prompt}</QuestionnaireTitle>
      <QuestionnaireChoices>
        {options.map((option) => {
          const selected = isOptionSelected(node, value, option.value)
          const result =
            submitted && revealCorrectAnswers ? submittedOptionResult(option, selected) : undefined
          // Submitted review is past validation, so replace the primitive's
          // dormant required-answer border with the neutral input border and
          // leave only the result palette visible.
          const feedbackClassName = submitted
            ? submittedChoiceClassName(result ?? 'neutral')
            : undefined

          return (
            <QuestionnaireChoice
              key={option.value}
              value={option.value}
              checked={selected}
              className={feedbackClassName}
              onChange={(event) => {
                if (submitted) {
                  // Gate the interaction without forwarding it to the owner.
                  // Canceling the change would also suppress React's restore
                  // of a controlled checkbox, leaving the saved selection
                  // looking toggled, so let the controlled `checked` value be
                  // authoritative instead. The primitive's own controlled
                  // branch ignores the interaction, so the answer cannot change.
                  return
                }
                onAnswer(
                  node.id,
                  answerAfterChange(node, value, option.value, event.target.checked)
                )
              }}
            >
              {option.content}
            </QuestionnaireChoice>
          )
        })}
      </QuestionnaireChoices>
      <QuestionnaireError>
        <FormattedMessage id="questionnaire.answerRequired" />
      </QuestionnaireError>
    </QuestionnaireItem>
  )
}

/**
 * A one-question-at-a-time questionnaire. A single Questionnaire Root owns the
 * active item, validation, focus, keyboard shortcuts and navigation before and
 * after submission; only the active item is visible and the rest stay hidden
 * and inert. The active item is controlled by the session so a resumed page or
 * a review returns to the last question the learner reached.
 *
 * The Root's own boundaries decide which action appears: Previous on every item
 * but the first, Next on every item but the last, and Submit only on the last.
 * Next also waits for the current item to be answered. Submit is offered as soon
 * as the final item is reached and is not gated on every answer, so pressing it
 * lets the Root validate, reveal any required-answer messages and move to the
 * first unanswered item.
 *
 * Submitting does not replace the Root or move the active item. Saved choices
 * remain checked but read-only; their correctness feedback is revealed only
 * when the questionnaire's `revealCorrectAnswers` is enabled. Previous/Next
 * continue to review every question through the same wizard.
 * The final item keeps its Submit disabled once submitted so submission cannot
 * repeat.
 *
 * A retry is a new submission round: the owner clears this questionnaire's
 * answers, submitted status and saved active question while keeping its attempt
 * history and page completion. Remounting the Root under a retry key makes the
 * wizard start again at the first question with every choice editable.
 *
 * A submitted result with attempts left stays open after submission: the summary
 * shows the latest recorded attempt and offers Try Again or Complete.
 * Completion is automatic on a perfect result or an exhausted finite cap, while
 * an unlimited cap keeps offering retries until the learner completes manually.
 * A completed result stays submitted and reviewable without either action.
 */
export function StepperQuestionnaire({ node }: { node: QuestionnaireNode }) {
  const {
    answers,
    submitted,
    completed,
    attempts,
    attemptsRemaining,
    retrying,
    shuffleSeed,
    attemptIndex,
    activeItemId,
    onAnswer,
    onItemChange,
    onSubmitted,
    onRetry,
    onComplete
  } = useQuestionnaireSession(node)
  const intl = useIntl()
  const firstQuestionId = node.questions[0]?.id ?? ''
  const lastQuestionId = node.questions[node.questions.length - 1]?.id ?? ''
  const reviewing = submitted && !retrying

  // A restored position is honoured only while it still names a question this
  // questionnaire authors. Otherwise the owned controlled position starts at
  // the first question.
  const savedItem = node.questions.some((question) => question.id === activeItemId)
    ? activeItemId
    : undefined
  const item = savedItem ?? firstQuestionId

  const { answers: currentAnswers, answerQuestion } = useQuestionnaireAnswers({
    questions: node.questions,
    answers,
    onAnswer
  })
  const result = getQuestionnaireResult(node, currentAnswers)
  const submitQuestionnaire = useQuestionnaireSubmission(node.id, reviewing, onSubmitted)
  const summaryCorrect = attempts[attempts.length - 1] ?? result.correct
  const showActions = reviewing && !completed && attemptsRemaining > 0

  if (node.questions.length === 0) {
    return null
  }

  // Shuffling needs the session's persisted seed. Rendering authored order until
  // the post-restore seed effect runs would show one order and then reorder it,
  // so wait for the seed instead.
  if (node.shuffleOptions && shuffleSeed === undefined) {
    return null
  }

  // Only the rendered order changes; the authored options still drive answer
  // derivation, validation and scoring.
  const optionsFor = (question: QuestionNode): readonly QuestionOption[] =>
    node.shuffleOptions && shuffleSeed !== undefined
      ? shuffleQuestionOptions(question.options, {
          seed: shuffleSeed,
          questionnaireId: node.id,
          questionId: question.id,
          attemptIndex
        })
      : question.options

  const items: QuestionnaireItemDefinition[] = node.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: optionsFor(question).map((option) => ({ value: option.value }))
  }))

  /**
   * The Root validates the whole collection before invoking its own onSubmit,
   * so an invalid submission never reaches this handler while a valid one is
   * reported exactly once. Preventing the event stops the browser's native
   * form submission instead of skipping the primitive's validation.
   */
  const handleSubmit: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    submitQuestionnaire()
  }

  return (
    <>
      <Card className="not-prose">
        <CardContent>
          <Questionnaire
            key={retrying ? `retry-${attempts.length}` : 'review'}
            item={onItemChange ? item : undefined}
            defaultItem={reviewing ? lastQuestionId : firstQuestionId}
            items={items}
            onItemChange={onItemChange}
            onSubmit={handleSubmit}
          >
            <QuestionnaireProgress
              aria-label={intl.formatMessage({ id: 'questionnaire.progressLabel' })}
              render={(renderProps, state) => {
                const label = intl.formatMessage(
                  { id: 'questionnaire.progress' },
                  { current: state.current, total: state.total }
                )
                return (
                  <div {...(renderProps as HTMLAttributes<HTMLDivElement>)} aria-valuetext={label}>
                    {label}
                  </div>
                )
              }}
            />

            {node.questions.map((question) => (
              <StepperQuestion
                key={question.id}
                node={question}
                options={optionsFor(question)}
                value={currentAnswers[question.id]}
                submitted={reviewing}
                revealCorrectAnswers={node.revealCorrectAnswers}
                onAnswer={answerQuestion}
              />
            ))}

            <QuestionnaireActions>
              <QuestionnairePrevious>
                <FormattedMessage id="questionnaire.previous" />
              </QuestionnairePrevious>

              <QuestionnaireNext>
                <FormattedMessage id="questionnaire.next" />
              </QuestionnaireNext>

              <QuestionnaireSubmit disabled={reviewing}>
                <FormattedMessage id="questionnaire.submit" />
              </QuestionnaireSubmit>
            </QuestionnaireActions>
          </Questionnaire>
        </CardContent>
      </Card>

      {reviewing && (
        <QuestionnaireSubmissionResult
          correct={summaryCorrect}
          total={result.total}
          attemptsRemaining={attemptsRemaining}
          onRetry={showActions ? onRetry : undefined}
          onComplete={showActions ? onComplete : undefined}
        />
      )}
    </>
  )
}
