// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionnaireView as QuestionnaireViewBase } from '../../app/components/QuestionnaireView'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type { AnswerValue, ContentNode, QuestionnaireNode } from '../../app/types'
import { multipleChoiceQuestion, questionnaireNode, singleChoiceQuestion } from './fixtures'

/**
 * Wraps the questionnaire in the player's i18n provider, matching how a page
 * renders it. These tests exercise questionnaire behaviour, so they only need
 * the provider to supply the localized chrome. `lang` selects the catalog, so
 * tests can assert localized player copy.
 */
function QuestionnaireView({
  lang,
  ...props
}: ComponentProps<typeof QuestionnaireViewBase> & { lang?: string }) {
  return (
    <PlayerI18nProvider lang={lang}>
      <QuestionnaireViewBase {...props} />
    </PlayerI18nProvider>
  )
}

type QuestionNode = Extract<ContentNode, { type: 'questionnaire' }>['questions'][number]

const trueFalse: QuestionNode = {
  type: 'question',
  id: 'question:check.mdx:1:1',
  questionType: 'true-false',
  prompt: [{ type: 'paragraph', children: [{ type: 'text', value: 'Is it true?' }] }],
  options: [
    {
      value: 'true',
      correct: true,
      content: [{ type: 'paragraph', children: [{ type: 'text', value: 'True' }] }]
    },
    {
      value: 'false',
      correct: false,
      content: [{ type: 'paragraph', children: [{ type: 'text', value: 'False' }] }]
    }
  ]
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function input(value: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`input[value="${value}"]`)
  if (!element) {
    throw new Error(`Input not found for value: ${value}`)
  }
  return element
}

/**
 * A read-only submitted choice. Submitted answers render through the shadcn
 * questionnaire choice part, whose native input carries the value and state.
 */
function submittedControl(value: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(
    `[data-slot="questionnaire-choice-input"][value="${value}"]`
  )
  if (!element) {
    throw new Error(`Submitted control not found for value: ${value}`)
  }
  return element
}

function submittedChecked(value: string): boolean {
  return submittedControl(value).checked
}

/**
 * The result the submitted choice exposes for an option value. Correctness is
 * asserted through this semantic hook rather than through the color classes the
 * result styling happens to use.
 */
function submittedChoiceResult(value: string): string | null {
  const choice = submittedControl(value).closest('[data-slot="questionnaire-choice"]')
  if (!choice) {
    throw new Error(`Submitted choice not found for value: ${value}`)
  }
  return choice.getAttribute('data-result')
}

/** Whether a submitted option is classified as correct. */
function submittedChoiceIsCorrect(value: string): boolean {
  return submittedChoiceResult(value) === 'correct'
}

/** Whether a submitted option is classified as a selected-wrong result. */
function submittedChoiceIsIncorrect(value: string): boolean {
  return submittedChoiceResult(value) === 'incorrect'
}

/** Visible button whose label matches exactly; hidden wizard controls are skipped. */
function button(label: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button')).find(
    (candidate) => !candidate.hasAttribute('hidden') && candidate.textContent?.trim() === label
  )
  if (!element) {
    throw new Error(`Visible button not found: ${label}`)
  }
  return element
}

/** The currently displayed question item. */
function activeItem(): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    '[data-slot="questionnaire-item"]:not([hidden])'
  )
  if (!element) {
    throw new Error('No active questionnaire item')
  }
  return element
}

/** The questions the wizard currently hides because they are not active. */
function hiddenItems(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="questionnaire-item"]')
  ).filter((item) => item.hasAttribute('hidden'))
}

describe('QuestionnaireView', () => {
  it('renders one questionnaire item per question and navigates as a wizard', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    expect(container.querySelectorAll('[data-slot="questionnaire-item"]')).toHaveLength(2)
    expect(activeItem().textContent).toContain('Which option is correct?')

    act(() => input('first').click())
    expect(input('first').checked).toBe(true)
    act(() => button('Next question').click())

    expect(activeItem().textContent).toContain('Which options apply?')

    act(() => button('Previous question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    // Returning to an answered question preserves the answer.
    expect(input('first').checked).toBe(true)
  })

  it('uses radios for single-choice and checkboxes for multiple-choice', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    expect(input('first').type).toBe('radio')
    expect(input('second').type).toBe('radio')

    act(() => input('first').click())
    act(() => button('Next question').click())

    expect(input('alpha').type).toBe('checkbox')
    expect(input('beta').type).toBe('checkbox')
  })

  it('refuses to submit until every question is answered', () => {
    const onSubmitted = vi.fn()
    act(() => root.render(<QuestionnaireView node={questionnaireNode} onSubmitted={onSubmitted} />))

    act(() => input('first').click())
    act(() => button('Next question').click())

    // On the final question the submit action is offered, but the unanswered
    // multiple-choice item blocks it.
    act(() => button('Submit questionnaire').click())
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(activeItem().textContent).toContain('Which options apply?')

    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledWith(questionnaireNode.id)
  })

  it('invokes the submitted callback exactly once across repeated submits', () => {
    const onSubmitted = vi.fn()
    act(() => root.render(<QuestionnaireView node={questionnaireNode} onSubmitted={onSubmitted} />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())
    act(() => button('Submit questionnaire').click())

    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it('renders true-false as a radio group keyed by option value', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={{
            type: 'questionnaire',
            id: 'questionnaire:check.mdx:1:1',
            contributesToScore: true,
            questions: [trueFalse]
          }}
        />
      )
    )

    expect(input('true').type).toBe('radio')
    expect(input('false').type).toBe('radio')
    act(() => input('false').click())
    expect(input('false').checked).toBe(true)
    expect(input('true').checked).toBe(false)
  })

  it('names the fieldset from the rich prompt without result highlighting', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    const fieldset = activeItem()
    const labelledBy = fieldset.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toContain(
      'Which option is correct?'
    )
    // Correctness is not revealed before submission: no option exposes a
    // result classification.
    expect(container.querySelector('[data-result]')).toBeNull()
    expect(container.querySelector('[data-correct]')).toBeNull()
  })

  it('declares the authored questions as the Root item collection', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // The Root receives `items`, so each question is keyed by its stable id
    // (surfaced as the native input name) and the active question renders
    // without waiting for a layout effect, keeping the markup server-renderable.
    expect(input('first').getAttribute('name')).toBe(singleChoiceQuestion.id)
    expect(activeItem().hasAttribute('hidden')).toBe(false)

    act(() => button('Next question').click())
    expect(input('alpha').getAttribute('name')).toBe(multipleChoiceQuestion.id)
  })
})

describe('QuestionnaireView required-answer message', () => {
  it('shows the English required-answer message when a required item is invalid', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    // The last question is still unanswered, so submitting marks it invalid.
    act(() => button('Submit questionnaire').click())

    const error = activeItem().querySelector('[data-slot="questionnaire-error"]')
    expect(error?.hasAttribute('hidden')).toBe(false)
    expect(error?.textContent).toBe('Choose an answer to continue.')
  })

  it('localizes the required-answer message under pt-BR', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} lang="pt-BR" />))

    act(() => input('first').click())
    act(() => button('Próxima pergunta').click())
    act(() => button('Enviar questionário').click())

    const error = activeItem().querySelector('[data-slot="questionnaire-error"]')
    expect(error?.hasAttribute('hidden')).toBe(false)
    expect(error?.textContent).toBe('Escolha uma resposta para continuar.')
    // The primitive's English fallback never leaks into the pt-BR player.
    expect(container.textContent).not.toContain('Choose an answer to continue.')
  })
})

/** Renders a questionnaire controlled by local answer state, like a page does. */
function ControlledQuestionnaire({
  node = questionnaireNode,
  initialAnswers = {},
  onSubmitted
}: {
  node?: QuestionnaireNode
  initialAnswers?: Record<string, AnswerValue>
  onSubmitted?: (id: string) => void
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(initialAnswers)
  return (
    <QuestionnaireView
      node={node}
      answers={answers}
      onAnswer={(questionId, value) =>
        setAnswers((previous) => ({ ...previous, [questionId]: value }))
      }
      onSubmitted={onSubmitted}
    />
  )
}

/**
 * A controlled questionnaire whose owner records submissions the way a page
 * does: the first successful submit flips the wrapper into its read-only
 * submitted review for the rest of the session.
 */
function OwnerTrackedQuestionnaire({ node = questionnaireNode }: { node?: QuestionnaireNode }) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [submittedIds, setSubmittedIds] = useState<string[]>([])
  return (
    <QuestionnaireView
      node={node}
      answers={answers}
      onAnswer={(questionId, value) =>
        setAnswers((previous) => ({ ...previous, [questionId]: value }))
      }
      submitted={submittedIds.includes(node.id)}
      onSubmitted={(id) => setSubmittedIds((previous) => [...previous, id])}
    />
  )
}

describe('QuestionnaireView persistence', () => {
  it('reports every answer change under the question id', () => {
    const onAnswer = vi.fn()
    act(() =>
      root.render(<QuestionnaireView node={questionnaireNode} answers={{}} onAnswer={onAnswer} />)
    )

    act(() => input('first').click())
    expect(onAnswer).toHaveBeenLastCalledWith(singleChoiceQuestion.id, 'first')

    act(() => button('Next question').click())
    act(() => input('alpha').click())
    expect(onAnswer).toHaveBeenLastCalledWith(multipleChoiceQuestion.id, ['alpha'])
  })

  it('persists multiple-choice answers as string arrays', () => {
    act(() => root.render(<ControlledQuestionnaire />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    expect(input('alpha').checked).toBe(true)

    act(() => input('beta').click())
    expect(input('alpha').checked).toBe(true)
    expect(input('beta').checked).toBe(true)

    act(() => input('alpha').click())
    expect(input('alpha').checked).toBe(false)
    expect(input('beta').checked).toBe(true)
  })

  it('keeps multiple-choice answers in authored option order', () => {
    const onAnswer = vi.fn()
    function StatefulQuestionnaire() {
      const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
      return (
        <QuestionnaireView
          node={questionnaireNode}
          answers={answers}
          onAnswer={(questionId, value) => {
            onAnswer(questionId, value)
            setAnswers((previous) => ({ ...previous, [questionId]: value }))
          }}
        />
      )
    }

    act(() => root.render(<StatefulQuestionnaire />))
    act(() => input('first').click())
    act(() => button('Next question').click())

    // Toggling beta before alpha must still persist the authored order.
    act(() => input('beta').click())
    act(() => input('alpha').click())
    expect(onAnswer).toHaveBeenLastCalledWith(multipleChoiceQuestion.id, ['alpha', 'beta'])

    act(() => input('beta').click())
    expect(onAnswer).toHaveBeenLastCalledWith(multipleChoiceQuestion.id, ['alpha'])
  })

  it('restores saved selections from the page answers', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['alpha']
          }}
          onAnswer={() => {}}
        />
      )
    )

    expect(input('second').checked).toBe(true)
    expect(input('first').checked).toBe(false)

    act(() => button('Next question').click())
    expect(input('alpha').checked).toBe(true)
    expect(input('beta').checked).toBe(false)
  })

  it('marks the wrapper submitted after a successful final submit', () => {
    const onSubmitted = vi.fn()
    act(() => root.render(<ControlledQuestionnaire onSubmitted={onSubmitted} />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())

    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledWith(questionnaireNode.id)
  })

  it('restores a submitted wizard read-only, opening on its last question', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'first',
            [multipleChoiceQuestion.id]: ['alpha', 'beta']
          }}
          submitted
        />
      )
    )

    // The default presentation stays a wizard after submission: the single
    // root opens on the question that was active at submit time (the last
    // one) instead of restarting or expanding every question.
    expect(container.querySelectorAll('[data-slot="questionnaire-item"]')).toHaveLength(2)
    expect(hiddenItems()).toHaveLength(1)
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(container.textContent).toContain('Question 2 of 2')

    // The hidden earlier question keeps its saved selection rendered, and
    // both saved answers are checked and disabled.
    expect(hiddenItems()[0]?.textContent).toContain('Which option is correct?')
    expect(submittedChecked('first')).toBe(true)
    expect(submittedControl('first').disabled).toBe(true)
    expect(submittedChecked('second')).toBe(false)
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChecked('beta')).toBe(true)
    expect(submittedControl('beta').disabled).toBe(true)

    // Submission cannot repeat: the Submit action is gone, but the wizard
    // navigation remains available for reviewing every answer.
    expect(container.textContent).not.toContain('Submit questionnaire')
    expect(container.textContent).toContain('Previous question')
    expect(container.textContent).toContain('Next question')
  })

  it('reviews a restored wizard feedback question by question', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['alpha']
          }}
          submitted
        />
      )
    )

    // Opening on the last question, Previous walks back to the first
    // question's review without leaving the wizard.
    act(() => button('Previous question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')

    // The answer stays read-only and the result is classified: the saved
    // 'second' pick was wrong, the unselected correct option stays correct.
    expect(submittedChecked('second')).toBe(true)
    expect(submittedControl('second').disabled).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsIncorrect('second')).toBe(true)

    // Next returns to the last question's feedback, also read-only. This is
    // the two-way review the submitted wizard must support: if it fails with
    // the required-answer message shown on the earlier question, the wizard
    // validation is treating the submitted (disabled) choices as unanswered.
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })

  it('renders submitted answers through the shadcn questionnaire parts', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['alpha']
          }}
          submitted
        />
      )
    )

    // Single-choice is a disabled questionnaire radio; multiple-choice uses
    // disabled questionnaire checkboxes, each an accessible choice part.
    const single = submittedControl('second')
    expect(single.type).toBe('radio')
    expect(single.checked).toBe(true)
    expect(single.disabled).toBe(true)
    expect(single.closest('[data-slot="questionnaire-choice"]')).not.toBeNull()

    const multiple = submittedControl('alpha')
    expect(multiple.type).toBe('checkbox')
    expect(multiple.checked).toBe(true)
    expect(multiple.disabled).toBe(true)
    expect(submittedControl('beta').checked).toBe(false)

    // One root form still drives the restored wizard: every question is part
    // of the Root's item collection, the earlier one hidden while the last is
    // active, and each exposes its choices as accessible choice parts.
    expect(container.querySelectorAll('[data-slot="questionnaire"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="questionnaire-title"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-slot="questionnaire-choice"]')).toHaveLength(4)
  })

  it('classifies every correct option as correct in a submitted questionnaire', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['beta']
          }}
          submitted
        />
      )
    )

    // Correct options are classified correct whether or not the learner
    // selected them.
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })

  it('keeps a selected correct option correct and never incorrect', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'first',
            [multipleChoiceQuestion.id]: ['alpha']
          }}
          submitted
        />
      )
    )

    // A correct option the learner selected is confirmed correct and must not
    // also carry the "selected wrong" classification.
    expect(submittedChecked('first')).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsIncorrect('first')).toBe(false)

    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(submittedChoiceIsIncorrect('alpha')).toBe(false)
  })

  it('classifies a selected wrong single-choice option as incorrect', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{ [singleChoiceQuestion.id]: 'second' }}
          submitted
        />
      )
    )

    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsIncorrect('second')).toBe(true)
    expect(submittedChecked('second')).toBe(true)
  })

  it('classifies selected wrong multiple-choice options as incorrect', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{ [multipleChoiceQuestion.id]: ['beta'] }}
          submitted
        />
      )
    )

    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(submittedChoiceIsIncorrect('beta')).toBe(true)
    expect(submittedChecked('beta')).toBe(true)
  })

  it('leaves unselected wrong options neutral', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'first',
            [multipleChoiceQuestion.id]: ['alpha']
          }}
          submitted
        />
      )
    )

    // The wrong options were not selected, so they are classified neutral.
    expect(submittedChoiceResult('second')).toBe('neutral')
    expect(submittedChoiceResult('beta')).toBe('neutral')
    expect(submittedChecked('second')).toBe(false)
    expect(submittedChecked('beta')).toBe(false)
  })
})

describe('QuestionnaireView submitted wizard flow', () => {
  it('keeps the wizard on its active question after submitting', () => {
    act(() => root.render(<OwnerTrackedQuestionnaire />))

    // Given a fully answered default wizard on its last question, when the
    // learner submits, then the wizard presentation is unchanged: submission
    // neither advances, restarts, nor expands the questions.
    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())

    expect(activeItem().textContent).toContain('Which options apply?')
    expect(container.textContent).toContain('Question 2 of 2')
    expect(hiddenItems()).toHaveLength(1)

    // The Submit action is removed so a submission cannot repeat, while the
    // Previous/Next navigation remains for reviewing every result.
    expect(container.textContent).not.toContain('Submit questionnaire')
    expect(container.textContent).toContain('Previous question')
    expect(container.textContent).toContain('Next question')

    // The answered questions read as results: read-only with their feedback.
    expect(submittedControl('alpha').disabled).toBe(true)
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(submittedChecked('first')).toBe(true)
    expect(submittedControl('first').disabled).toBe(true)
  })

  it('reviews every submitted answer read-only through Previous and Next', () => {
    act(() => root.render(<OwnerTrackedQuestionnaire />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())

    // Previous revisits the first question, still exactly one item visible,
    // with its saved answer checked, disabled, and feedback revealed.
    act(() => button('Previous question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(hiddenItems()).toHaveLength(1)
    expect(submittedChecked('first')).toBe(true)
    expect(submittedControl('first').disabled).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)

    // Next returns to the last question's feedback. This is the two-way
    // review the submitted wizard must support: if it fails with the
    // required-answer message shown on the earlier question, the wizard
    // validation is treating the submitted (disabled) choices as unanswered.
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })

  it('reviews submitted answers with arrow keys without repeating a held key', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={questionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'first',
            [multipleChoiceQuestion.id]: ['alpha']
          }}
          submitted
        />
      )
    )

    // The submitted wizard opens on its last question.
    expect(activeItem().textContent).toContain('Which options apply?')

    act(() => {
      activeItem().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      )
    })
    expect(activeItem().textContent).toContain('Which option is correct?')

    // A held ArrowRight matches the primitive: it is canceled but does not
    // navigate or trigger required validation while the key repeats.
    act(() => {
      activeItem().dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          repeat: true,
          bubbles: true,
          cancelable: true
        })
      )
    })
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(container.querySelector('[data-slot="questionnaire-error"]:not([hidden])')).toBeNull()

    // A fresh ArrowRight still returns to the last question's feedback.
    act(() => {
      activeItem().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      )
    })
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })
})

describe('QuestionnaireView expanded presentation', () => {
  /** The shared questionnaire in expanded form: every question visible at once. */
  const expandedQuestionnaireNode: QuestionnaireNode = {
    ...questionnaireNode,
    expanded: true
  }

  it('shows every question at once in authored order without wizard chrome', () => {
    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

    const items = container.querySelectorAll('[data-slot="questionnaire-item"]')
    expect(items).toHaveLength(2)
    // Authored order is kept and no question is hidden away.
    expect(items[0]?.textContent).toContain('Which option is correct?')
    expect(items[1]?.textContent).toContain('Which options apply?')
    for (const item of items) expect(item.hasAttribute('hidden')).toBe(false)

    // The per-question wizard progress and Previous/Next do not apply; every
    // question is answered in place with one bottom Submit.
    expect(container.textContent).not.toContain('Question 1 of 2')
    expect(container.textContent).not.toContain('Previous question')
    expect(container.textContent).not.toContain('Next question')
    expect(button('Submit questionnaire').type).toBe('submit')

    // Correctness stays hidden until submission, as in the wizard mode.
    expect(container.querySelector('[data-result]')).toBeNull()
  })

  it('answers in any order through a single bottom Submit that validates all', () => {
    const onSubmitted = vi.fn()
    act(() =>
      root.render(
        <ControlledQuestionnaire node={expandedQuestionnaireNode} onSubmitted={onSubmitted} />
      )
    )

    // The learner answers out of authored order, without any navigation.
    act(() => input('alpha').click())
    expect(input('alpha').checked).toBe(true)

    // One unanswered question still blocks the shared bottom Submit, and its
    // required-answer message is visible among the displayed questions.
    act(() => button('Submit questionnaire').click())
    expect(onSubmitted).not.toHaveBeenCalled()
    const invalidItem = container.querySelector<HTMLElement>(
      '[data-slot="questionnaire-item"][data-active]'
    )
    expect(invalidItem?.textContent).toContain('Which option is correct?')
    const error = invalidItem?.querySelector('[data-slot="questionnaire-error"]')
    expect(error?.hasAttribute('hidden')).toBe(false)
    expect(error?.textContent).toBe('Choose an answer to continue.')

    // Completing the remaining question succeeds through the same action.
    act(() => input('first').click())
    act(() => button('Submit questionnaire').click())
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledWith(expandedQuestionnaireNode.id)
  })

  it('submits through the bottom action and keeps every question in review', () => {
    act(() => root.render(<OwnerTrackedQuestionnaire node={expandedQuestionnaireNode} />))

    // Answer every question in place, then submit through the single action.
    act(() => input('first').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())

    // The expanded presentation is retained: no wizard chrome appears, every
    // question stays visible with its feedback, and nothing remains to do.
    expect(container.querySelectorAll('[data-slot="questionnaire"]')).toHaveLength(1)
    const items = container.querySelectorAll('[data-slot="questionnaire-item"]')
    expect(items).toHaveLength(2)
    for (const item of items) expect(item.hasAttribute('hidden')).toBe(false)
    expect(container.textContent).not.toContain('Submit questionnaire')
    expect(container.textContent).not.toContain('Previous question')
    expect(container.textContent).not.toContain('Next question')

    // All answers are read-only and classified.
    expect(submittedControl('first').disabled).toBe(true)
    expect(submittedControl('alpha').disabled).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })

  it('restores a submitted expanded questionnaire still expanded', () => {
    act(() =>
      root.render(
        <QuestionnaireView
          node={expandedQuestionnaireNode}
          answers={{
            [singleChoiceQuestion.id]: 'second',
            [multipleChoiceQuestion.id]: ['alpha']
          }}
          submitted
        />
      )
    )

    // Restoration keeps the expanded layout: one root, every question visible
    // in authored order, no progress label, and no wizard navigation.
    expect(container.querySelectorAll('[data-slot="questionnaire"]')).toHaveLength(1)
    const items = container.querySelectorAll('[data-slot="questionnaire-item"]')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('Which option is correct?')
    expect(items[1]?.textContent).toContain('Which options apply?')
    for (const item of items) expect(item.hasAttribute('hidden')).toBe(false)
    expect(container.textContent).not.toContain('Question 1 of 2')
    expect(container.textContent).not.toContain('Submit questionnaire')
    expect(container.textContent).not.toContain('Previous question')
    expect(container.textContent).not.toContain('Next question')

    // Saved answers stay checked and read-only with their feedback revealed.
    expect(submittedChecked('second')).toBe(true)
    expect(submittedControl('second').disabled).toBe(true)
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedControl('beta').disabled).toBe(true)
    expect(submittedChoiceIsIncorrect('second')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })
})
