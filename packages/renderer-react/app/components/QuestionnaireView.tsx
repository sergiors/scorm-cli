import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { QuestionnaireItemStatus } from '@shadcn/react/questionnaire'
import type {
  AnswerValue,
  PageNode,
  PlayerPageState,
  QuestionnaireNode,
  QuestionNode
} from '../types'
import {
  answerAfterChange,
  isOptionSelected,
  submittedOptionResult,
  type SubmittedOptionResult
} from '../lib/questionnaire'
import { ContentRenderer } from './ContentRenderer'
import { Button } from './ui/button'
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
import { Card, CardContent } from './ui/card'

export type { QuestionNode }

export interface QuestionnaireViewProps {
  node: QuestionnaireNode
  /**
   * Saved answers for the owning page/item, keyed by `QuestionNode.id`.
   * Supplying this controls the rendered selection, so restored answers display
   * as checked. It does not report interactions on its own; supply
   * {@link onAnswer} as well for a fully controlled questionnaire.
   */
  answers?: Record<string, AnswerValue>
  /**
   * Whether this questionnaire's wrapper id is already in the owning page's
   * `submittedQuestionnaires`. Submitted questionnaires render read-only while
   * keeping their authored wizard or expanded presentation for review. The owner
   * supplies the saved `answers` used to restore selections and feedback.
   */
  submitted?: boolean
  /**
   * Reports a single question interaction for the owning page/item so the owner
   * can persist it. Multiple-choice answers are string arrays; single-choice and
   * true-false are strings. Supplying this reports changes but does not by itself
   * drive the selection; supply {@link answers} as well for fully controlled
   * updates.
   */
  onAnswer?: (questionId: string, value: AnswerValue) => void
  /**
   * Invoked exactly once, with the questionnaire id, after every question has
   * been answered and the learner submits. Submission is never graded, but the
   * read-only result view does reveal correctness: correct options are marked
   * green and a wrong option the learner selected is marked red.
   */
  onSubmitted?: (id: string) => void
  /**
   * The root presentation's pages, so a Path authored inside a question prompt
   * or option resolves its references to display metadata. Forwarded unchanged
   * to every nested {@link ContentRenderer}.
   */
  pathPages?: readonly PageNode[]
  /**
   * Persisted state per root page id, so a nested Path can read which referenced
   * pages are already visited. Forwarded unchanged to every nested
   * {@link ContentRenderer}.
   */
  pageStates?: Record<string, PlayerPageState>
  /**
   * Opens a referenced root page through the presentation's existing page
   * switching, so a nested Path can offer navigation. Forwarded unchanged to
   * every nested {@link ContentRenderer}.
   */
  onNavigatePathPage?: (pageId: string) => void
  /**
   * Restored playback positions for the owning page/item, in seconds, keyed by
   * stable video node id, so a video authored in a prompt or option resumes like
   * one at the page top level. Forwarded unchanged to every nested
   * {@link ContentRenderer}.
   */
  videoPositions?: Record<string, number>
  /**
   * Persists a video's semantic playback position in seconds, already scoped to
   * the owning page/item. Forwarded unchanged to every nested
   * {@link ContentRenderer}.
   */
  onVideoPosition?: (videoId: string, seconds: number) => void
}

/**
 * The nested content rendering context forwarded verbatim to every nested
 * {@link ContentRenderer}, so a Path or video authored inside a questionnaire
 * prompt or option behaves exactly like one authored at the page top level.
 */
type NestedContentContext = Pick<
  QuestionnaireViewProps,
  'pathPages' | 'pageStates' | 'onNavigatePathPage' | 'videoPositions' | 'onVideoPosition'
>

/**
 * Whether a submitted-review arrow key should change the visible question.
 * Mirrors the primitive's navigation guard: text fields, selects and editable
 * content keep their native arrows, and radio groups keep their native
 * selection arrows. Checkbox choices and the navigation controls do not.
 */
function navigatesReviewWithArrowKeys(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) {
    return (
      target.type === 'button' ||
      target.type === 'checkbox' ||
      target.type === 'reset' ||
      target.type === 'submit'
    )
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return false
  }
  return !(target instanceof HTMLElement && target.isContentEditable)
}

/** Whether a persisted answer selects at least one option. */
function hasAnswerValue(value: AnswerValue | undefined): boolean {
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return typeof value === 'string' && value.length > 0
}

/**
 * Whether an Enter key press would activate the questionnaire's shared
 * completion action. The primitive submits on Ctrl/Meta+Enter from anywhere and
 * on Enter from an answer control.
 */
function activatesQuestionnaireAction(event: KeyboardEvent<HTMLFormElement>): boolean {
  if (event.key !== 'Enter') {
    return false
  }
  if (event.metaKey || event.ctrlKey) {
    return !event.altKey && !event.shiftKey
  }
  return (
    event.target instanceof HTMLInputElement &&
    (event.target.type === 'radio' || event.target.type === 'checkbox')
  )
}

/**
 * A grouped questionnaire rendered through the shadcn questionnaire UI: one
 * `Questionnaire.Root` with one `Questionnaire.Item` per question.
 *
 * By default the root behaves as a wizard: one question at a time, navigated
 * with Previous/Next, and finished with a single "Submit questionnaire" action
 * on the last question. With `node.expanded`, every question is shown in
 * authored order, answered in any order, and finished by one bottom Submit.
 * Actions are disabled until their required question (or, for a Submit, every
 * required question) has an answer, so an incomplete action cannot surface a
 * validation message. The expanded Root still keeps every item visible and
 * interactive instead of hiding or disabling it, so only presentation and
 * navigation change.
 *
 * The authored `questions` are declared once as the Root's `items` collection
 * and mapped into the parts. The collection lets the active item server-render
 * and marks every question required, so navigation and submission stay blocked
 * until each item has an answer. Items are keyed by their stable `QuestionNode.id`,
 * so restoring an answer is a lookup rather than positional. The questionnaire
 * is controlled whenever the owner supplies `answers`, `onAnswer`, or both:
 * `answers` drives the rendered selection, `onAnswer` reports interactions, and
 * supplying both yields fully controlled updates.
 *
 * Submission never remounts the Root. The active question and (in expanded
 * mode) the full list stay in place; the choices become read-only and reveal
 * the result: correct options are highlighted green and any wrong option the
 * learner selected is highlighted red, while wrong options left unselected stay
 * neutral. The Submit action stays visible but disabled, so a submission cannot
 * be repeated. The wizard keeps Previous/Next for reviewing every question's
 * feedback.
 *
 * Correctness is never revealed before submission. The rich prompt and each
 * option are rendered as content, and the submission callback bubbles through
 * them so nested block content can still surface questionnaires. The Path
 * rendering context is forwarded the same way, so a Path authored in a prompt
 * or option resolves its references and navigates exactly like one at the page
 * level.
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
  videoPositions,
  onVideoPosition
}: QuestionnaireViewProps) {
  const submittedRef = useRef(false)
  const intl = useIntl()
  const lastQuestionId = node.questions[node.questions.length - 1]?.id
  // Review position for a submitted wizard. It starts unset so the fallback is
  // the last authored question, which is where a successful submit happens.
  const [reviewItem, setReviewItem] = useState<string | undefined>(undefined)
  // The primitive owns the wizard position when the questionnaire is not in
  // submitted review. Tracking the reported item lets Next follow the active
  // question's answer status in controlled and uncontrolled modes alike.
  const [activeItem, setActiveItem] = useState<string | undefined>(undefined)
  // Item status includes answers selected by the primitive itself, not only
  // owner-controlled `answers`, so aggregate Submit enablement also works for
  // the standalone/uncontrolled questionnaire.
  const [itemStatuses, setItemStatuses] = useState<Record<string, QuestionnaireItemStatus>>({})
  // Bundled once so it can be forwarded verbatim to every nested renderer.
  const contentContext: NestedContentContext = {
    pathPages,
    pageStates,
    onNavigatePathPage,
    videoPositions,
    onVideoPosition
  }

  if (node.questions.length === 0) {
    return null
  }

  const expanded = node.expanded === true
  const reviewingSubmitted = submitted && !expanded
  // The primitive owns the selection only when the owner supplies neither
  // `answers` nor `onAnswer` (the standalone/default case). Supplying `answers`
  // controls the rendered selection, supplying `onAnswer` reports interactions,
  // and callers that want fully controlled updates supply both.
  const controlled = onAnswer !== undefined || answers !== undefined

  // Declare the authored questions once: the Root uses the collection for
  // server rendering, required-answer validation and the wizard order. Disabled
  // choice definitions mirror the read-only rendered choices after submission.
  const items = node.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((option) => ({
      value: option.value,
      ...(submitted ? { disabled: true } : {})
    }))
  }))

  // A restored submission opens on the question that was active when it was
  // submitted, so it neither restarts the wizard nor expands every question.
  const reviewQuestionId = reviewingSubmitted ? (reviewItem ?? lastQuestionId) : undefined
  const currentQuestionId = reviewingSubmitted
    ? reviewQuestionId
    : node.questions.some((question) => question.id === activeItem)
      ? activeItem
      : node.questions[0]?.id

  // An item is answered once its own reported status says so. Restored owner
  // answers seed the status before the primitive's first layout effect runs,
  // and keep the server-rendered markup accurate; afterwards the primitive is
  // the source of truth, including selections it owns in uncontrolled mode.
  const isQuestionAnswered = (questionId: string | undefined) => {
    if (questionId === undefined) {
      return false
    }
    const status = itemStatuses[questionId]
    if (status !== undefined) {
      return status === 'answered'
    }
    return answers !== undefined && hasAnswerValue(answers[questionId])
  }
  const allQuestionsAnswered = node.questions.every((question) => isQuestionAnswered(question.id))
  const currentQuestionAnswered = isQuestionAnswered(currentQuestionId)

  const handleItemStatusChange = (questionId: string, status: QuestionnaireItemStatus) => {
    setItemStatuses((previous) => {
      if (previous[questionId] === status) {
        return previous
      }
      return { ...previous, [questionId]: status }
    })
  }

  const reviewPreviousQuestion = () => {
    const currentIndex = node.questions.findIndex((question) => question.id === reviewQuestionId)
    const previousQuestion = node.questions[currentIndex - 1]
    if (previousQuestion) {
      setReviewItem(previousQuestion.id)
    }
  }

  const reviewNextQuestion = () => {
    const currentIndex = node.questions.findIndex((question) => question.id === reviewQuestionId)
    const nextQuestion = node.questions[currentIndex + 1]
    if (nextQuestion) {
      setReviewItem(nextQuestion.id)
    }
  }

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLFormElement>) => {
    if (
      reviewingSubmitted &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      navigatesReviewWithArrowKeys(event.target)
    ) {
      // Arrow keys are the primitive's keyboard equivalent of Previous/Next.
      // Bypass its required-answer validation for the same reason as the
      // buttons: submitted choices are read-only and would look unanswered.
      event.preventDefault()
      // Match the primitive: suppress repeats while the key is held.
      if (event.repeat) {
        return
      }
      if (event.key === 'ArrowLeft') {
        reviewPreviousQuestion()
      } else {
        reviewNextQuestion()
      }
      return
    }

    if (!activatesQuestionnaireAction(event)) {
      return
    }
    // The primitive's Enter shortcuts would otherwise run its required-answer
    // validation even though the equivalent action is disabled. Preventing the
    // default makes the primitive's key handler ignore the event and avoids
    // surfacing a validation message for an action the learner cannot take.
    let actionDisabled = !currentQuestionAnswered
    if (expanded) {
      actionDisabled = !allQuestionsAnswered
    } else if (submitted || currentQuestionId === lastQuestionId) {
      actionDisabled = submitted || !allQuestionsAnswered
    }
    if (actionDisabled) {
      event.preventDefault()
    }
  }

  return (
    <Card>
      <CardContent>
        <Questionnaire
          items={items}
          item={reviewQuestionId}
          onItemChange={reviewingSubmitted ? setReviewItem : setActiveItem}
          onKeyDownCapture={handleKeyDownCapture}
          onSubmit={(event) => {
            // The root only reaches this handler once every required item has an
            // answer. Never let the browser navigate away, and forward the
            // submission once even if the learner submits repeatedly or a
            // restored submission somehow requests it again.
            event.preventDefault()
            if (submitted || submittedRef.current) {
              return
            }
            submittedRef.current = true
            onSubmitted?.(node.id)
          }}
        >
          {expanded ? null : (
            <QuestionnaireProgress
              render={(props, state) => {
                // Keep the primitive's role/ARIA/data-slot and merged classes,
                // but replace its hardcoded English progress label and text with
                // the localized equivalents for both the visible and announced
                // value.
                const label = intl.formatMessage(
                  { id: 'questionnaire.progress' },
                  { current: state.current, total: state.total }
                )
                return (
                  <div
                    {...props}
                    aria-label={intl.formatMessage({
                      id: 'questionnaire.progressLabel'
                    })}
                    aria-valuetext={label}
                  >
                    {label}
                  </div>
                )
              }}
            />
          )}

          {node.questions.map((question) => (
            <QuestionnaireQuestion
              // Submitting disables the choices, which the primitive reports as
              // unanswered even though they are the saved result. Remounting the
              // now read-only item clears the validation attempt recorded by the
              // submit that ended it, so review keeps valid semantics.
              key={submitted ? `${question.id}:submitted` : question.id}
              node={question}
              controlled={controlled}
              submitted={submitted}
              expanded={expanded}
              value={answers?.[question.id]}
              onAnswer={onAnswer}
              onStatusChange={(status) => handleItemStatusChange(question.id, status)}
              onQuestionnaireSubmitted={onSubmitted}
              contentContext={contentContext}
            />
          ))}

          {expanded ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={submitted || !allQuestionsAnswered}>
                <FormattedMessage id="questionnaire.submit" />
              </Button>
            </div>
          ) : (
            <QuestionnaireActions>
              <QuestionnairePrevious>
                <FormattedMessage id="questionnaire.previous" />
              </QuestionnairePrevious>
              <QuestionnaireNext
                disabled={!submitted && !currentQuestionAnswered}
                onClick={
                  reviewingSubmitted
                    ? (event) => {
                        // The primitive validates required answers before
                        // advancing. Submitted choices are natively disabled, so
                        // it would treat every review item as unanswered. Review
                        // navigation only changes which saved result is shown.
                        event.preventDefault()
                        reviewNextQuestion()
                      }
                    : undefined
                }
              >
                <FormattedMessage id="questionnaire.next" />
              </QuestionnaireNext>
              <QuestionnaireSubmit disabled={submitted || !allQuestionsAnswered}>
                <FormattedMessage id="questionnaire.submit" />
              </QuestionnaireSubmit>
            </QuestionnaireActions>
          )}
        </Questionnaire>
      </CardContent>
    </Card>
  )
}

/**
 * Result styling for a single submitted option: every correct option is tinted
 * green, a wrong option is tinted red only when the learner selected it, and a
 * wrong option left unselected stays neutral. The `data-checked` variants
 * override the primitive's primary "selected" tint, so the result color also
 * wins for a checked option. Only the submitted view applies this, so
 * correctness is never revealed before results.
 */
function resultClassName(result: SubmittedOptionResult): string | undefined {
  if (result === 'correct') {
    return 'border-emerald-600/60 bg-emerald-500/10 data-checked:border-emerald-600 data-checked:bg-emerald-500/15 dark:border-emerald-500/60 dark:bg-emerald-500/15 dark:data-checked:border-emerald-500 dark:data-checked:bg-emerald-500/20'
  }
  if (result === 'incorrect') {
    return 'border-destructive/60 bg-destructive/10 data-checked:border-destructive data-checked:bg-destructive/15 dark:border-destructive/60 dark:bg-destructive/15 dark:data-checked:border-destructive dark:data-checked:bg-destructive/20'
  }
  return undefined
}

function QuestionnaireQuestion({
  node,
  controlled,
  submitted,
  expanded,
  value,
  onAnswer,
  onStatusChange,
  onQuestionnaireSubmitted,
  contentContext
}: {
  node: QuestionNode
  controlled: boolean
  submitted: boolean
  expanded: boolean
  value: AnswerValue | undefined
  onAnswer?: (questionId: string, value: AnswerValue) => void
  onStatusChange?: (status: QuestionnaireItemStatus) => void
  onQuestionnaireSubmitted?: (id: string) => void
  contentContext: NestedContentContext
}) {
  const promptId = useId()
  // Single-choice and true-false become radios; multiple-choice checkboxes.
  const multiple = node.questionType === 'multiple-choice'

  const handleChange = (optionValue: string, checked: boolean) => {
    if (!onAnswer) {
      return
    }
    // The derivation keeps multiple-choice answers in authored option order so
    // the persisted value is deterministic regardless of the toggle order.
    onAnswer(node.id, answerAfterChange(node, value, optionValue, checked))
  }

  return (
    <QuestionnaireItem
      name={node.id}
      multiple={multiple}
      required
      onStatusChange={onStatusChange}
      // The primitive hides and inerts every non-active item for its wizard.
      // Expanded mode overrides both states so every question stays visible and
      // operable while the Root keeps owning validation and answer state.
      hidden={expanded ? false : undefined}
      inert={expanded ? false : undefined}
      aria-labelledby={promptId}
      className="not-prose"
    >
      <QuestionnaireTitle id={promptId}>
        <ContentRenderer
          nodes={node.prompt}
          onQuestionnaireSubmitted={onQuestionnaireSubmitted}
          {...contentContext}
        />
      </QuestionnaireTitle>

      <QuestionnaireChoices>
        {node.options.map((option) => {
          const selected = isOptionSelected(node, value, option.value)
          const result = submitted ? submittedOptionResult(option, selected) : undefined
          return (
            <QuestionnaireChoice
              key={option.value}
              value={option.value}
              checked={submitted || controlled ? selected : undefined}
              disabled={submitted}
              onChange={
                !submitted && controlled
                  ? (event) => handleChange(option.value, event.target.checked)
                  : undefined
              }
              // Result is exposed semantically (and used by the result styling
              // below) so behavior and tests do not depend on color classes.
              // It stays absent until submission, so correctness never leaks.
              data-result={result}
              className={result ? resultClassName(result) : undefined}
            >
              <ContentRenderer
                nodes={option.content}
                onQuestionnaireSubmitted={onQuestionnaireSubmitted}
                {...contentContext}
              />
            </QuestionnaireChoice>
          )
        })}
      </QuestionnaireChoices>

      {submitted ? null : (
        <QuestionnaireError>
          <FormattedMessage id="questionnaire.answerRequired" />
        </QuestionnaireError>
      )}
    </QuestionnaireItem>
  )
}
