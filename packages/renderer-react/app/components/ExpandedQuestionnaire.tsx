import { useId, Fragment } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckIcon } from 'lucide-react'
import {
  answerAfterChange,
  getQuestionnaireResult,
  isOptionSelected,
  submittedOptionResult
} from '../lib/questionnaire'
import { cn } from '../lib/utils'
import type { AnswerValue, QuestionNode, QuestionnaireNode } from '../types'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import {
  QuestionnaireSubmissionResult,
  submittedChoiceClassName,
  useQuestionnaireAnswers,
  useQuestionnaireSubmission,
  useQuestionnaireSession
} from './QuestionnaireShared'
import { Separator } from './ui/separator'

interface QuestionnaireQuestionProps {
  node: QuestionNode
  value: AnswerValue | undefined
  submitted: boolean
  onAnswer: (questionId: string, value: AnswerValue) => void
}

/**
 * One authored question rendered as a native fieldset. Expanded mode stays
 * outside the wizard by design, so it does not use the compound Root's
 * validation or navigation. Submitted choices are disabled and classified, so
 * the same rendering serves both the interactive and read-only presentations.
 */
function QuestionnaireQuestion({ node, value, submitted, onAnswer }: QuestionnaireQuestionProps) {
  const titleId = useId()
  const multiple = node.questionType === 'multiple-choice'

  return (
    <fieldset
      data-slot="questionnaire-item"
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-5 border-0 p-0 outline-none"
    >
      <legend
        id={titleId}
        data-slot="questionnaire-title"
        className="text-base font-semibold text-pretty mb-5"
      >
        {node.prompt}
      </legend>
      <div
        data-slot="questionnaire-choices"
        className="group/questionnaire-choices grid min-w-0 gap-3"
      >
        {node.options.map((option) => {
          const selected = isOptionSelected(node, value, option.value)
          const result = submitted ? submittedOptionResult(option, selected) : undefined
          return (
            <label
              key={option.value}
              data-slot="questionnaire-choice"
              data-type={multiple ? 'checkbox' : 'radio'}
              data-checked={selected ? '' : undefined}
              data-unchecked={selected ? undefined : ''}
              data-result={result}
              className={cn(
                'group/questionnaire-choice relative flex min-h-11 cursor-pointer items-start gap-2.5 rounded-3xl border border-input px-4 py-3 text-start text-sm transition-colors outline-none select-none hover:bg-input/40 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-3 has-[>input:focus-visible]:ring-ring/50 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:border-primary/40 data-checked:bg-primary/10',
                result ? submittedChoiceClassName(result) : undefined
              )}
            >
              <input
                data-slot="questionnaire-choice-input"
                type={multiple ? 'checkbox' : 'radio'}
                name={node.id}
                value={option.value}
                checked={selected}
                disabled={submitted}
                required={!submitted && !multiple}
                onChange={(event) => {
                  if (submitted) {
                    return
                  }
                  onAnswer(
                    node.id,
                    answerAfterChange(node, value, option.value, event.target.checked)
                  )
                }}
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
              />

              <span
                aria-hidden="true"
                data-slot="questionnaire-choice-indicator"
                className="pointer-events-none relative flex size-4 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-[5px] border border-transparent bg-input/90 group-data-[type=radio]/questionnaire-choice:rounded-full group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground dark:group-data-checked/questionnaire-choice:bg-primary"
              >
                <span
                  data-slot="questionnaire-choice-indicator-dot"
                  className="hidden size-2 rounded-full bg-primary-foreground group-data-[type=checkbox]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block dark:size-2.5"
                />
                <CheckIcon
                  data-slot="questionnaire-choice-indicator-check"
                  className="hidden size-3.5 group-data-[type=radio]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block"
                />
              </span>

              <span
                data-slot="questionnaire-choice-label"
                className="flex min-w-0 flex-1 flex-col gap-1 leading-snug"
              >
                {option.content}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/**
 * An expanded questionnaire: every authored question is rendered at once in
 * authored order and can be answered in any order. There is no wizard progress
 * or navigation, and a single bottom Submit stays disabled until every question
 * has an answer.
 *
 * The installed Questionnaire is wizard-specific, so the expanded form uses a
 * native form with the shared question rendering instead of forcing wizard
 * behavior through its Root props. After submission every question stays
 * visible and read-only, with its feedback revealed and the Submit action still
 * present but disabled. Restored submissions render the same way from the
 * owner's saved answers.
 *
 * A retry clears this questionnaire's answers and submitted status while
 * keeping its attempt history and page completion, so every question becomes
 * editable at once again. Try Again stays available only while the history has
 * an attempt left.
 */
export function ExpandedQuestionnaire({ node }: { node: QuestionnaireNode }) {
  const intl = useIntl()
  const { answers, submitted, attempts, retrying, onAnswer, onSubmitted, onRetry } =
    useQuestionnaireSession(node)
  const maxAttempts = node.maxAttempts ?? 1
  const reviewing = submitted && !retrying

  const {
    answers: currentAnswers,
    answerQuestion,
    allAnswered
  } = useQuestionnaireAnswers({
    questions: node.questions,
    answers,
    onAnswer
  })
  const result = getQuestionnaireResult(node, currentAnswers)
  const submitQuestionnaire = useQuestionnaireSubmission(
    node.id,
    reviewing,
    result.correct,
    onSubmitted
  )
  const canSubmit = !reviewing && allAnswered
  const canRetry = reviewing && maxAttempts > 1 && attempts.length < maxAttempts

  return (
    <>
      <Card className="not-prose">
        <CardContent>
          <form
            data-slot="questionnaire"
            noValidate
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              if (canSubmit) {
                submitQuestionnaire()
              }
            }}
          >
            {node.questions.map((question, index) => {
              const label = intl.formatMessage(
                { id: 'questionnaire.progress' },
                { current: index + 1, total: node.questions.length }
              )

              return (
                <Fragment key={question.id}>
                  {index > 0 && <Separator />}

                  <div className="text-xs font-medium text-muted-foreground">{label}</div>

                  <QuestionnaireQuestion
                    key={question.id}
                    node={question}
                    value={currentAnswers[question.id]}
                    submitted={reviewing}
                    onAnswer={answerQuestion}
                  />
                </Fragment>
              )
            })}

            <div className="flex justify-end">
              <Button type="submit" data-slot="questionnaire-submit" disabled={!canSubmit}>
                <FormattedMessage id="questionnaire.submit" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {reviewing && (
        <QuestionnaireSubmissionResult {...result} onRetry={canRetry ? onRetry : undefined} />
      )}
    </>
  )
}
