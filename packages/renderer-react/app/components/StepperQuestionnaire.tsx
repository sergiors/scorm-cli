import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent
} from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire'
import {
  answerAfterChange,
  isOptionSelected,
  isQuestionAnswered,
  submittedOptionResult
} from '../lib/questionnaire'
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
 * controlled branch ignores it.
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
 * Previous and Next stay in the layout and disable at the boundaries or while
 * the active item is unanswered. Submit appears on the final item and stays
 * disabled until every question has an answer.
 *
 * Submitting does not replace the Root or move the active item. Saved choices
 * remain checked but read-only with their correctness feedback revealed, and
 * Previous/Next continue to review every question through the same wizard.
 * Submit stays visible but disabled on every item so submission cannot repeat.
 */
export function StepperQuestionnaire(props: QuestionnaireViewProps) {
  const { node, answers, submitted = false, onAnswer, onSubmitted } = props
  const intl = useIntl()
  const firstQuestionId = node.questions[0]?.id ?? ''
  const lastQuestionId = node.questions[node.questions.length - 1]?.id ?? ''

  const {
    answers: currentAnswers,
    answerQuestion,
    allAnswered
  } = useQuestionnaireAnswers({
    questions: node.questions,
    answers,
    onAnswer
  })
  const submitQuestionnaire = useQuestionnaireSubmission(node.id, submitted, onSubmitted)

  // The live Root owns the active item. Mirror its reported item in a ref only
  // so the Enter-shortcut guard can tell whether the action that shortcut would
  // invoke is available; rendering and navigation stay Root-owned.
  const activeItemRef = useRef(firstQuestionId)

  if (node.questions.length === 0) {
    return null
  }

  const items: QuestionnaireItemDefinition[] = node.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((option) => ({ value: option.value }))
  }))

  const canSubmit = !submitted && allAnswered

  /**
   * The installed Root handles arrow keys, focus, validation and its Enter
   * shortcuts. Its shortcuts do not know whether the equivalent button is
   * disabled, so letting one through on an unanswered item would run validation
   * and reveal the required-answer message those disabled actions suppress.
   * This guard cancels exactly those unavailable shortcut paths before the Root
   * sees them. Once submitted, the Root's shortcuts are safe and its read-only
   * review navigation stays in charge.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (submitted || event.key !== 'Enter') {
      return
    }
    const commandShortcut = event.metaKey || event.ctrlKey
    const answerShortcut =
      event.target instanceof HTMLInputElement &&
      (event.target.type === 'radio' || event.target.type === 'checkbox')
    if (!commandShortcut && !answerShortcut) {
      return
    }
    if (commandShortcut && (event.altKey || event.shiftKey)) {
      return
    }
    const activeQuestion =
      node.questions.find((question) => question.id === activeItemRef.current) ?? node.questions[0]
    const activeIsLast = activeQuestion?.id === lastQuestionId
    const activeActionEnabled =
      activeQuestion !== undefined &&
      (activeIsLast ? canSubmit : isQuestionAnswered(activeQuestion, currentAnswers))

    if (!activeActionEnabled) {
      event.preventDefault()
    }
  }

  return (
    <Card>
      <CardContent>
        <Questionnaire
          defaultItem={submitted ? lastQuestionId : firstQuestionId}
          items={items}
          onItemChange={(item) => {
            activeItemRef.current = item
          }}
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) {
              submitQuestionnaire()
            }
          }}
          onKeyDown={handleKeyDown}
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
              value={currentAnswers[question.id]}
              submitted={submitted}
              onAnswer={answerQuestion}
            />
          ))}

          <QuestionnaireActions>
            <QuestionnairePrevious
              hidden={false}
              inert={false}
              aria-hidden={false}
              render={(renderProps, state) => (
                <button
                  {...(renderProps as ButtonHTMLAttributes<HTMLButtonElement>)}
                  disabled={!state.visible}
                />
              )}
            >
              <FormattedMessage id="questionnaire.previous" />
            </QuestionnairePrevious>

            <QuestionnaireNext
              hidden={false}
              inert={false}
              aria-hidden={false}
              className="col-start-2"
              render={(renderProps, state) => (
                <button
                  {...(renderProps as ButtonHTMLAttributes<HTMLButtonElement>)}
                  disabled={!state.visible || (!submitted && state.status !== 'answered')}
                />
              )}
            >
              <FormattedMessage id="questionnaire.next" />
            </QuestionnaireNext>

            <QuestionnaireSubmit
              disabled={!canSubmit}
              render={(renderProps) => (
                <button
                  {...(renderProps as ButtonHTMLAttributes<HTMLButtonElement>)}
                  {...(submitted ? { hidden: false, inert: false, 'aria-hidden': false } : {})}
                />
              )}
            >
              <FormattedMessage id="questionnaire.submit" />
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
  )
}
