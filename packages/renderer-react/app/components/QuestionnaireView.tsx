import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
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

/**
 * A grouped questionnaire rendered through the shadcn questionnaire UI: one
 * `Questionnaire.Root` with one `Questionnaire.Item` per question.
 *
 * By default the root behaves as a wizard: one question at a time, navigated
 * with Previous/Next, and finished with a single "Submit questionnaire" action
 * on the last question. With `node.expanded`, every question is shown in
 * authored order, answered in any order, and validated by one bottom Submit.
 * The expanded Root still owns required-answer validation; its non-active items
 * are kept visible and interactive instead of hidden, so only presentation and
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
 * neutral. The Submit action is removed, so a submission cannot be repeated.
 * The wizard keeps Previous/Next for reviewing every question's feedback.
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

  const handleReviewKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    if (!navigatesReviewWithArrowKeys(event.target)) {
      return
    }
    // Arrow keys are the primitive's keyboard equivalent of Previous/Next.
    // Bypass its required-answer validation for the same reason as the buttons.
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
  }

  return (
    <Card>
      <CardContent>
        <Questionnaire
          items={items}
          item={reviewQuestionId}
          onItemChange={reviewingSubmitted ? setReviewItem : undefined}
          onKeyDownCapture={reviewingSubmitted ? handleReviewKeyDown : undefined}
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
              key={question.id}
              node={question}
              controlled={controlled}
              submitted={submitted}
              expanded={expanded}
              value={answers?.[question.id]}
              onAnswer={onAnswer}
              onQuestionnaireSubmitted={onSubmitted}
              contentContext={contentContext}
            />
          ))}

          {expanded ? (
            submitted ? null : (
              <div className="flex justify-end">
                <Button type="submit">
                  <FormattedMessage id="questionnaire.submit" />
                </Button>
              </div>
            )
          ) : (
            <QuestionnaireActions>
              <QuestionnairePrevious>
                <FormattedMessage id="questionnaire.previous" />
              </QuestionnairePrevious>
              <QuestionnaireNext
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
              {submitted ? null : (
                <QuestionnaireSubmit>
                  <FormattedMessage id="questionnaire.submit" />
                </QuestionnaireSubmit>
              )}
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
  onQuestionnaireSubmitted,
  contentContext
}: {
  node: QuestionNode
  controlled: boolean
  submitted: boolean
  expanded: boolean
  value: AnswerValue | undefined
  onAnswer?: (questionId: string, value: AnswerValue) => void
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

      <QuestionnaireError>
        <FormattedMessage id="questionnaire.answerRequired" />
      </QuestionnaireError>
    </QuestionnaireItem>
  )
}
