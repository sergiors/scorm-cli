import {
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent
} from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { QuestionnaireItemDefinition } from '@shadcn/react/questionnaire'
import { answerAfterChange, isOptionSelected, isQuestionAnswered } from '../lib/questionnaire'
import { Button } from './ui/button'
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
  isEventFromNestedQuestionnaire,
  nestedContentContext,
  QuestionnaireQuestion,
  QuestionnaireRichContent,
  useQuestionnaireAnswers,
  useQuestionnaireSubmission,
  type NestedContentContext,
  type QuestionnaireViewProps
} from './QuestionnaireShared'
import type { AnswerValue, QuestionNode } from '../types'

interface StepperQuestionProps {
  node: QuestionNode
  value: AnswerValue | undefined
  onAnswer: (questionId: string, value: AnswerValue) => void
  onQuestionnaireSubmitted?: (id: string) => void
  contentContext: NestedContentContext
}

/**
 * One authored question rendered through the Questionnaire compound parts. The
 * Root owns which item is active, hiding and inerting the rest, so this only
 * describes the question and reports its choice interactions.
 */
function StepperQuestion({
  node,
  value,
  onAnswer,
  onQuestionnaireSubmitted,
  contentContext
}: StepperQuestionProps) {
  const titleId = useId()
  const multiple = node.questionType === 'multiple-choice'

  return (
    <QuestionnaireItem name={node.id} required multiple={multiple} aria-labelledby={titleId}>
      <QuestionnaireTitle id={titleId}>
        <QuestionnaireRichContent
          nodes={node.prompt}
          onQuestionnaireSubmitted={onQuestionnaireSubmitted}
          contentContext={contentContext}
        />
      </QuestionnaireTitle>
      <QuestionnaireChoices>
        {node.options.map((option) => {
          const selected = isOptionSelected(node, value, option.value)
          return (
            <QuestionnaireChoice
              key={option.value}
              value={option.value}
              checked={selected}
              onChange={(event) => {
                onAnswer(
                  node.id,
                  answerAfterChange(node, value, option.value, event.target.checked)
                )
              }}
            >
              <QuestionnaireRichContent
                nodes={option.content}
                onQuestionnaireSubmitted={onQuestionnaireSubmitted}
                contentContext={contentContext}
              />
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
 * Whether an arrow key belongs to a text-editing control. Submitted review has
 * no editable answers, but rich prompt or option content may still contain
 * native text fields whose arrows must keep their caret behavior.
 */
function navigatesReviewWithArrowKeys(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement &&
    !['button', 'checkbox', 'radio', 'reset', 'submit'].includes(target.type)
  ) {
    return false
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return false
  }
  return !(target instanceof HTMLElement && target.isContentEditable)
}

/**
 * A one-question-at-a-time questionnaire. While it is answerable, the
 * Questionnaire Root owns the active item, validation, focus, keyboard
 * shortcuts and navigation; only the active item is visible and the rest stay
 * hidden and inert. Previous and Next stay in the layout and disable at the
 * boundaries or while the active item is unanswered. Submit appears on the
 * final item and stays disabled until every question has an answer.
 *
 * The wizard cannot navigate a submitted review: its item status ignores
 * disabled answer controls, so read-only choices make every item read as
 * unanswered. A submitted stepper therefore keeps the identical one-question
 * presentation with the shared native question, rendering saved choices
 * read-only with their feedback. It opens on the last authored question, keeps
 * Submit visible but disabled, and lets Previous/Next review every answer.
 */
export function StepperQuestionnaire(props: QuestionnaireViewProps) {
  const { node, answers, submitted = false, onAnswer, onSubmitted } = props
  const intl = useIntl()
  const firstQuestionId = node.questions[0]?.id ?? ''
  const lastQuestionId = node.questions[node.questions.length - 1]?.id ?? ''
  const total = node.questions.length

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
  const contentContext = nestedContentContext(props)

  // The live wizard Root owns the active item. Mirror its reported item in a
  // ref only so the Enter-shortcut guard can tell whether the action that
  // shortcut would invoke is enabled; rendering and navigation stay Root-owned.
  const activeItemRef = useRef(firstQuestionId)
  const [reviewIndex, setReviewIndex] = useState(() => Math.max(total - 1, 0))

  if (node.questions.length === 0) {
    return null
  }

  if (submitted) {
    const resolvedReviewIndex = Math.min(Math.max(reviewIndex, 0), total - 1)
    const progressLabel = intl.formatMessage(
      { id: 'questionnaire.progress' },
      { current: resolvedReviewIndex + 1, total }
    )
    const goToQuestion = (index: number) => {
      if (index < 0 || index >= total) {
        return
      }
      setReviewIndex(index)
    }
    const handleReviewKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
      if (isEventFromNestedQuestionnaire(event)) {
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return
      }
      if (!navigatesReviewWithArrowKeys(event.target)) {
        return
      }
      event.preventDefault()
      if (event.repeat) {
        return
      }
      goToQuestion(event.key === 'ArrowLeft' ? resolvedReviewIndex - 1 : resolvedReviewIndex + 1)
    }

    return (
      <Card>
        <CardContent>
          <form
            data-slot="questionnaire"
            noValidate
            className="flex w-full min-w-0 flex-col gap-6"
            onKeyDown={handleReviewKeyDown}
            onSubmit={(event) => event.preventDefault()}
          >
            <div
              data-slot="questionnaire-progress"
              role="progressbar"
              aria-label={intl.formatMessage({ id: 'questionnaire.progressLabel' })}
              aria-live="polite"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={resolvedReviewIndex + 1}
              aria-valuetext={progressLabel}
              className="min-h-[1lh] w-fit min-w-[14ch] text-xs font-medium text-muted-foreground tabular-nums"
            >
              {progressLabel}
            </div>

            {node.questions.map((question, index) => (
              <QuestionnaireQuestion
                key={question.id}
                node={question}
                value={currentAnswers[question.id]}
                submitted
                onAnswer={answerQuestion}
                onQuestionnaireSubmitted={onSubmitted}
                contentContext={contentContext}
                hidden={index !== resolvedReviewIndex}
                inert={index !== resolvedReviewIndex}
              />
            ))}

            <div
              data-slot="questionnaire-actions"
              className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 sm:min-h-9"
            >
              <Button
                type="button"
                variant="outline"
                data-slot="questionnaire-previous"
                disabled={resolvedReviewIndex === 0}
                onClick={() => goToQuestion(resolvedReviewIndex - 1)}
              >
                <FormattedMessage id="questionnaire.previous" />
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  data-slot="questionnaire-next"
                  disabled={resolvedReviewIndex === total - 1}
                  onClick={() => goToQuestion(resolvedReviewIndex + 1)}
                >
                  <FormattedMessage id="questionnaire.next" />
                </Button>

                <Button type="submit" data-slot="questionnaire-submit" disabled>
                  <FormattedMessage id="questionnaire.submit" />
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    )
  }

  const items: QuestionnaireItemDefinition[] = node.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((option) => ({ value: option.value }))
  }))

  const canSubmit = allAnswered

  /**
   * The Root handles arrow keys, focus, validation and its Enter shortcuts. Its
   * shortcuts do not know whether the equivalent buttons are disabled, so this
   * thin guard suppresses exactly those shortcut paths while the action is not
   * available; otherwise the Root receives the event unchanged.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter') {
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
    const activeIsLast = activeQuestion === undefined || activeQuestion.id === lastQuestionId
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
          defaultItem={firstQuestionId}
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

          <div
            className="contents"
            onKeyDown={(event) => {
              if (isEventFromNestedQuestionnaire(event)) {
                // The nested questionnaire already handled its own keys. Stop
                // them here so the outer Root cannot also navigate.
                event.stopPropagation()
              }
            }}
          >
            {node.questions.map((question) => (
              <StepperQuestion
                key={question.id}
                node={question}
                value={currentAnswers[question.id]}
                onAnswer={answerQuestion}
                onQuestionnaireSubmitted={onSubmitted}
                contentContext={contentContext}
              />
            ))}
          </div>

          <QuestionnaireActions>
            <QuestionnairePrevious
              hidden={false}
              inert={false}
              aria-hidden={false}
              render={(renderProps, state) => (
                <button
                  {...(renderProps as ButtonHTMLAttributes<HTMLButtonElement>)}
                  hidden={false}
                  inert={false}
                  aria-hidden={false}
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
                  hidden={false}
                  inert={false}
                  aria-hidden={false}
                  disabled={!state.visible || state.status !== 'answered'}
                />
              )}
            >
              <FormattedMessage id="questionnaire.next" />
            </QuestionnaireNext>

            <QuestionnaireSubmit disabled={!canSubmit}>
              <FormattedMessage id="questionnaire.submit" />
            </QuestionnaireSubmit>
          </QuestionnaireActions>
        </Questionnaire>
      </CardContent>
    </Card>
  )
}
