import { type KeyboardEvent } from 'react'
import { FormattedMessage } from 'react-intl'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import {
  activatesQuestionnaireAction,
  isEventFromNestedQuestionnaire,
  QuestionnaireQuestion,
  useQuestionnaireAnswers,
  useQuestionnaireSubmission,
  type QuestionnaireViewProps
} from './QuestionnaireShared'

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
 */
export function ExpandedQuestionnaire(props: QuestionnaireViewProps) {
  const { node, answers, submitted = false, onAnswer, onSubmitted } = props

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
  const canSubmit = !submitted && allAnswered

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLFormElement>) => {
    if (isEventFromNestedQuestionnaire(event) || !activatesQuestionnaireAction(event)) {
      return
    }
    // The shared bottom action is the only Enter path in expanded mode. Keeping
    // it gated prevents an incomplete submit from submitting anything.
    event.preventDefault()
    if (event.repeat) {
      return
    }
    if (canSubmit) {
      submitQuestionnaire()
    }
  }

  return (
    <Card>
      <CardContent>
        <form
          data-slot="questionnaire"
          noValidate
          className="flex w-full min-w-0 flex-col gap-6"
          onKeyDownCapture={handleKeyDownCapture}
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) {
              submitQuestionnaire()
            }
          }}
        >
          {node.questions.map((question) => (
            <QuestionnaireQuestion
              key={question.id}
              node={question}
              value={currentAnswers[question.id]}
              submitted={submitted}
              onAnswer={answerQuestion}
            />
          ))}

          <div className="flex justify-end">
            <Button type="submit" data-slot="questionnaire-submit" disabled={!canSubmit}>
              <FormattedMessage id="questionnaire.submit" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
