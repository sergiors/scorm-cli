import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type SubmitEventHandler
} from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire'
import { answerAfterChange, isOptionSelected, submittedOptionResult } from '../lib/questionnaire'
import { cn } from '../lib/utils'
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
  submittedChoiceClassName,
  useQuestionnaireAnswers,
  useQuestionnaireSubmission,
  type QuestionnaireViewProps
} from './QuestionnaireShared'
import type { AnswerValue, QuestionNode } from '../types'

interface StepperQuestionProps {
  node: QuestionNode
  value: AnswerValue | undefined
  submitted: boolean
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
 * through `aria-readonly` and `data-readonly` rather than disabling or muting
 * its choices, so hover and focus styling stay available.
 */
function StepperQuestion({ node, value, submitted, onAnswer }: StepperQuestionProps) {
  const titleId = useId()
  const multiple = node.questionType === 'multiple-choice'

  return (
    <QuestionnaireItem
      name={node.id}
      required
      multiple={multiple}
      aria-labelledby={titleId}
      aria-readonly={submitted || undefined}
      {...(submitted ? { 'data-readonly': '' } : {})}
    >
      <QuestionnaireTitle id={titleId}>{node.prompt}</QuestionnaireTitle>
      <QuestionnaireChoices>
        {node.options.map((option) => {
          const selected = isOptionSelected(node, value, option.value)
          const result = submitted ? submittedOptionResult(option, selected) : undefined
          // Submitted review is past validation, so replace the primitive's
          // dormant required-answer border with the neutral input border and
          // leave only the result palette visible.
          const feedbackClassName = result
            ? cn(submittedChoiceClassName(result), 'data-invalid:border-input')
            : undefined

          return (
            <QuestionnaireChoice
              key={option.value}
              value={option.value}
              checked={selected}
              className={feedbackClassName}
              {...(result ? { 'data-result': result } : {})}
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
 * and inert.
 *
 * The Root's own boundaries decide which action appears: Previous on every item
 * but the first, Next on every item but the last, and Submit only on the last.
 * Next also waits for the current item to be answered. Submit is offered as soon
 * as the final item is reached and is not gated on every answer, so pressing it
 * lets the Root validate, reveal any required-answer messages and move to the
 * first unanswered item.
 *
 * Submitting does not replace the Root or move the active item. Saved choices
 * remain checked but read-only with their correctness feedback revealed, and
 * Previous/Next continue to review every question through the same wizard.
 * The final item keeps its Submit disabled once submitted so submission cannot
 * repeat.
 */
export function StepperQuestionnaire(props: QuestionnaireViewProps) {
  const { node, answers, submitted = false, onAnswer, onSubmitted } = props
  const intl = useIntl()
  const firstQuestionId = node.questions[0]?.id ?? ''
  const lastQuestionId = node.questions[node.questions.length - 1]?.id ?? ''

  const { answers: currentAnswers, answerQuestion } = useQuestionnaireAnswers({
    questions: node.questions,
    answers,
    onAnswer
  })
  const submitQuestionnaire = useQuestionnaireSubmission(node.id, submitted, onSubmitted)

  if (node.questions.length === 0) {
    return null
  }

  const items: QuestionnaireItemDefinition[] = node.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((option) => ({ value: option.value }))
  }))

  /**
   * The Root validates the whole collection in its own submit handler and
   * prevents the event when any item fails. Handling submit on the ancestor
   * that wraps the Root lets that validation finish first: an invalid
   * submission never arrives here unprevented, while a valid one is reported
   * exactly once.
   *
   * Passing onSubmit to the Root instead would merge with its internal handler
   * and run before it, so preventing eagerly would skip validation and not
   * preventing would call the owner twice on a valid submission.
   */
  const handleSubmit: SubmitEventHandler<HTMLDivElement> = (event) => {
    if (event.defaultPrevented) {
      return
    }
    event.preventDefault()
    submitQuestionnaire()
  }

  return (
    <Card>
      <CardContent onSubmit={handleSubmit}>
        <Questionnaire defaultItem={submitted ? lastQuestionId : firstQuestionId} items={items}>
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
              value={currentAnswers[question.id]}
              submitted={submitted}
              onAnswer={answerQuestion}
            />
          ))}

          <QuestionnaireActions>
            <QuestionnairePrevious>
              <FormattedMessage id="questionnaire.previous" />
            </QuestionnairePrevious>

            <QuestionnaireNext
              render={(renderProps, state) => (
                <button
                  {...(renderProps as ButtonHTMLAttributes<HTMLButtonElement>)}
                  disabled={!submitted && state.status !== 'answered'}
                />
              )}
            >
              <FormattedMessage id="questionnaire.next" />
            </QuestionnaireNext>

            <QuestionnaireSubmit disabled={submitted}>
              <FormattedMessage id="questionnaire.submit" />
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
  )
}
