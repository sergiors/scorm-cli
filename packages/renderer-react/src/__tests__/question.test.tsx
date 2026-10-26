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
  prompt: 'Is it true?',
  options: [
    {
      value: 'true',
      correct: true,
      content: 'True'
    },
    {
      value: 'false',
      correct: false,
      content: 'False'
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

/**
 * The class list a submitted option is styled with, so the feedback palette is
 * asserted through the colors the learner actually sees.
 */
function submittedChoiceClass(value: string): string {
  const choice = submittedControl(value).closest('[data-slot="questionnaire-choice"]')
  if (!choice) {
    throw new Error(`Submitted choice not found for value: ${value}`)
  }
  return choice.className
}

/**
 * Whether one class-list token belongs to the submitted result palette. Result
 * feedback tints correct options emerald and selected wrong options
 * destructive, so the palette paints through an emerald utility in any variant
 * chain, a destructive background tint, an opacity-modified destructive border
 * (e.g. `border-destructive/60`), or a destructive utility keyed to the checked
 * state. The interactive classes also carry the required-answer validation
 * variant, which keys off learner state (`data-invalid:border-destructive`) and
 * renders nothing for an answered choice, so such inert tokens do not count.
 */
function paintsResultFeedback(token: string): boolean {
  // The result green only exists in the submitted palette.
  if (token.includes('emerald')) {
    return true
  }
  // A destructive background paints however the state sits, and an
  // opacity-modified destructive border is the submitted incorrect tint;
  // validation styling only outlines with plain destructive borders.
  if (token.includes('bg-destructive') || token.includes('border-destructive/')) {
    return true
  }
  // A destructive utility under the checked state recolors the current
  // selection, so it is result feedback rather than validation.
  return token.includes('data-checked:') && token.includes('destructive')
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

/** Whether a visible (non-hidden) button with the exact label exists. */
function hasVisibleButton(label: string): boolean {
  return Array.from(container.querySelectorAll('button')).some(
    (candidate) => !candidate.hasAttribute('hidden') && candidate.textContent?.trim() === label
  )
}

/** The required-answer messages currently revealed, across every question. */
function revealedErrors(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="questionnaire-error"]:not([hidden])')
  )
}

/** Dispatches a keyboard event on an element as the questionnaire root sees it. */
function pressKey(target: Element, init: KeyboardEventInit = { key: 'Enter' }): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

/** The shared questionnaire in expanded form: every question visible at once. */
const expandedQuestionnaireNode: QuestionnaireNode = {
  ...questionnaireNode,
  expanded: true
}

describe('QuestionnaireView', () => {
  it('renders one questionnaire item per question and navigates as a wizard', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    expect(container.querySelectorAll('[data-slot="questionnaire-item"]')).toHaveLength(2)
    // The wizard shows exactly one question at a time: the second stays in the
    // layout but hidden and inert, and the progress reads the first authored
    // question.
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(hiddenItems()).toHaveLength(1)
    expect(hiddenItems().every((item) => item.hasAttribute('inert'))).toBe(true)
    expect(container.textContent).toContain('Question 1 of 2')

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

    // On the final question the submit action is offered, but while the
    // multiple-choice item is unanswered it stays disabled, so
    // clicking it neither submits nor surfaces a validation message.
    expect(button('Submit questionnaire').disabled).toBe(true)
    act(() => button('Submit questionnaire').click())
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(revealedErrors()).toHaveLength(0)
    expect(activeItem().textContent).toContain('Which options apply?')

    act(() => input('alpha').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
    act(() => button('Submit questionnaire').click())
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledWith(questionnaireNode.id)
  })

  it('gates the wizard actions behind the current answer', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Given the first question unanswered, Previous and Next remain visible in
    // the layout but disabled, no Submit is offered yet, and clicking either
    // disabled action neither navigates nor surfaces a required message.
    expect(button('Previous question').disabled).toBe(true)
    act(() => button('Previous question').click())
    expect(button('Next question').disabled).toBe(true)
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(hasVisibleButton('Submit questionnaire')).toBe(false)
    expect(revealedErrors()).toHaveLength(0)
    act(() => input('first').click())
    expect(button('Next question').disabled).toBe(false)

    // The last question keeps every action on screen: Previous unlocks, but
    // Next stays disabled at the boundary, and Submit stays gated on the same
    // terms until every question has an answer.
    act(() => button('Next question').click())
    expect(button('Previous question').disabled).toBe(false)
    expect(button('Next question').disabled).toBe(true)
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(button('Submit questionnaire').disabled).toBe(true)
    act(() => input('alpha').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
  })

  it('keeps the wizard Next disabled until the owner answers restored items', () => {
    // Given a fully controlled questionnaire whose owner restored only the
    // last question's answer, then the first question's Next stays disabled:
    // the controlled selection decides readiness, so the saved collection
    // alone cannot advance the wizard.
    function RestoredQuestionnaire() {
      const [answers, setAnswers] = useState<Record<string, AnswerValue>>({
        [multipleChoiceQuestion.id]: ['alpha']
      })
      return (
        <QuestionnaireView
          node={questionnaireNode}
          answers={answers}
          onAnswer={(questionId, value) =>
            setAnswers((previous) => ({ ...previous, [questionId]: value }))
          }
        />
      )
    }

    act(() => root.render(<RestoredQuestionnaire />))
    expect(button('Next question').disabled).toBe(true)
    expect(revealedErrors()).toHaveLength(0)

    // The owner recording the first answer drives the selection and enables
    // Next.
    act(() => input('first').click())
    expect(button('Next question').disabled).toBe(false)

    // The restored answer survives the navigation, letting the final Submit
    // enable immediately because every question is answered.
    act(() => button('Next question').click())
    expect(input('alpha').checked).toBe(true)
    expect(button('Submit questionnaire').disabled).toBe(false)
  })

  it('keeps selected answers free of result styling before submission', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Selecting even the wrong option while unsubmitted stays an ordinary
    // primary selection: no result classification is attached to the answered
    // item, and the submitted feedback palette (emerald green, destructive
    // red) never paints any choice. The destructive tokens the interactive
    // classes carry stay confined to the inert required-answer validation
    // variant, which is keyed off learner state and does not apply to an
    // answered item.
    act(() => input('second').click())
    const choice = input('second').closest<HTMLElement>('[data-slot="questionnaire-choice"]')
    expect(choice).not.toBeNull()
    expect(choice?.hasAttribute('data-invalid')).toBe(false)
    const choiceClass = choice?.className ?? ''
    expect(choiceClass).toContain('data-checked:border-primary/40')
    expect(choiceClass).toContain('data-checked:bg-primary/10')

    // Across every choice: neither a `data-result` classification anywhere,
    // nor any token of the submitted feedback palette, however it is keyed.
    expect(choice?.getAttribute('data-result')).toBeNull()
    expect(
      Array.from(container.querySelectorAll('[data-slot="questionnaire-choice"]')).flatMap(
        (element) => element.className.split(/\s+/).filter(paintsResultFeedback)
      )
    ).toEqual([])
    expect(container.querySelector('[data-result]')).toBeNull()
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

  it('names the fieldset from the plain-text prompt without result highlighting', () => {
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

  it("keys every question's choices by its authored question id", () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Each question renders one fieldset whose choices share the question's
    // stable id as the native input name, so restoring an answer is a lookup
    // by id rather than position, and the active question renders immediately
    // without waiting for an effect.
    expect(input('first').getAttribute('name')).toBe(singleChoiceQuestion.id)
    expect(activeItem().hasAttribute('hidden')).toBe(false)

    act(() => button('Next question').click())
    expect(input('alpha').getAttribute('name')).toBe(multipleChoiceQuestion.id)
  })
})

describe('QuestionnaireView required-answer message suppression', () => {
  it('stays hidden while the learner tries disabled wizard actions', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Given the first question unanswered, the disabled Previous and Next
    // cannot navigate and cannot trigger the required-answer validation.
    expect(button('Previous question').disabled).toBe(true)
    act(() => button('Previous question').click())
    expect(button('Next question').disabled).toBe(true)
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(revealedErrors()).toHaveLength(0)

    // On the final question the unanswered multiple-choice item keeps both
    // Next and Submit disabled: clicking them neither navigates, submits,
    // nor reveals the message.
    act(() => input('first').click())
    act(() => button('Next question').click())
    expect(button('Next question').disabled).toBe(true)
    act(() => button('Next question').click())
    expect(button('Submit questionnaire').disabled).toBe(true)
    act(() => button('Submit questionnaire').click())
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(revealedErrors()).toHaveLength(0)

    // Answering lifts the gate without ever showing a stale message.
    act(() => input('alpha').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
    expect(revealedErrors()).toHaveLength(0)
  })

  it('keeps the localized required-answer message hidden under pt-BR', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} lang="pt-BR" />))

    act(() => input('first').click())
    act(() => button('Próxima pergunta').click())
    expect(button('Enviar questionário').disabled).toBe(true)
    act(() => button('Enviar questionário').click())
    expect(revealedErrors()).toHaveLength(0)

    // The message copy is still authored and localized for the moment it
    // could be revealed, and the primitive's English fallback never leaks.
    const error = activeItem().querySelector('[data-slot="questionnaire-error"]')
    expect(error?.textContent).toBe('Escolha uma resposta para continuar.')
    expect(container.textContent).not.toContain('Choose an answer to continue.')
  })
})

describe('QuestionnaireView Enter shortcut gating', () => {
  it('ignores Enter and Ctrl+Enter while the current wizard action is disabled', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Given the first question unanswered, both shortcut forms are inert:
    // they neither advance the wizard nor surface a required-answer message.
    pressKey(input('first'), { key: 'Enter' })
    expect(activeItem().textContent).toContain('Which option is correct?')
    pressKey(input('first'), { key: 'Enter', ctrlKey: true })
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(revealedErrors()).toHaveLength(0)

    // The primitive changes its active item without rerendering the owner.
    // Its Ctrl+Enter shortcut must still be gated by the newly active item.
    act(() => input('first').click())
    act(() => button('Next question').click())
    pressKey(input('alpha'), { key: 'Enter', ctrlKey: true })
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(revealedErrors()).toHaveLength(0)
  })

  it('advances and submits with the shortcuts once the actions are enabled', () => {
    const onSubmitted = vi.fn()
    act(() => root.render(<QuestionnaireView node={questionnaireNode} onSubmitted={onSubmitted} />))

    // Given an answered question, Enter behaves like the enabled Next.
    act(() => input('first').click())
    pressKey(input('first'), { key: 'Enter' })
    expect(activeItem().textContent).toContain('Which options apply?')

    // With every question answered on the last one, Ctrl+Enter submits.
    act(() => input('alpha').click())
    pressKey(input('alpha'), { key: 'Enter', ctrlKey: true })
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledWith(questionnaireNode.id)
  })

  it('ignores Enter and Ctrl+Enter in expanded mode until everything is answered', () => {
    const onSubmitted = vi.fn()
    act(() =>
      root.render(<QuestionnaireView node={expandedQuestionnaireNode} onSubmitted={onSubmitted} />)
    )

    // Given one unanswered question, neither shortcut form may trigger the
    // bottom Submit's validation or reveal the required-answer message.
    pressKey(input('alpha'), { key: 'Enter', ctrlKey: true })
    pressKey(input('alpha'), { key: 'Enter' })
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(revealedErrors()).toHaveLength(0)
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

    // Submission cannot repeat: the Submit action stays rendered but disabled,
    // while the wizard navigation remains visible for reviewing every answer.
    // Next sits at the last review boundary, so it stays disabled there.
    const submit = button('Submit questionnaire')
    expect(submit.type).toBe('submit')
    expect(submit.disabled).toBe(true)
    expect(hasVisibleButton('Previous question')).toBe(true)
    expect(hasVisibleButton('Next question')).toBe(true)
    expect(button('Next question').disabled).toBe(true)

    // A submitted questionnaire never surfaces a required-answer message for
    // its read-only choices.
    expect(revealedErrors()).toHaveLength(0)
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

    // The first review question is the start boundary: Previous stays visible
    // but disabled there, while Next unlocks the return path.
    expect(button('Previous question').disabled).toBe(true)
    expect(hasVisibleButton('Next question')).toBe(true)
    expect(button('Next question').disabled).toBe(false)

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

  it('renders submitted answers through the shared questionnaire parts', () => {
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

    // One shared form still drives the restored wizard: every question renders
    // a fieldset in the same form, the earlier one hidden while the last is
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
    // also carry the "selected wrong" classification. The result styling paints
    // it with the green feedback palette instead of the primary selection.
    expect(submittedChecked('first')).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsIncorrect('first')).toBe(false)
    expect(submittedChoiceClass('first')).toContain('emerald')
    expect(submittedChoiceClass('first')).not.toContain('destructive')

    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(submittedChoiceIsIncorrect('alpha')).toBe(false)
    expect(submittedChoiceClass('alpha')).toContain('emerald')
    expect(submittedChoiceClass('alpha')).not.toContain('destructive')
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
    // The selected wrong pick is painted with the destructive feedback
    // palette, never the green correct one.
    expect(submittedChoiceClass('second')).toContain('destructive')
    expect(submittedChoiceClass('second')).not.toContain('emerald')
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

    // The wrong options were not selected, so they are classified neutral and
    // stay outside both feedback palettes.
    expect(submittedChoiceResult('second')).toBe('neutral')
    expect(submittedChoiceResult('beta')).toBe('neutral')
    expect(submittedChoiceClass('second')).not.toContain('emerald')
    expect(submittedChoiceClass('second')).not.toContain('destructive')
    expect(submittedChoiceClass('beta')).not.toContain('emerald')
    expect(submittedChoiceClass('beta')).not.toContain('destructive')
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

    // The Submit action stays visible but disabled so a submission cannot
    // repeat, and the navigation actions stay visible: Next is disabled at the
    // last boundary, while Previous remains enabled for reviewing results.
    expect(button('Submit questionnaire').disabled).toBe(true)
    expect(hasVisibleButton('Previous question')).toBe(true)
    expect(hasVisibleButton('Next question')).toBe(true)
    expect(button('Next question').disabled).toBe(true)

    // The answered questions read as results: read-only with their feedback.
    expect(submittedControl('alpha').disabled).toBe(true)
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(submittedChecked('first')).toBe(true)
    expect(submittedControl('first').disabled).toBe(true)

    // Review never surfaces a stale required-answer message.
    expect(revealedErrors()).toHaveLength(0)
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

    // The start review boundary keeps Previous visible but disabled, while
    // Next returns to the last question's feedback. This is the two-way
    // review the submitted wizard must support: if it fails with the
    // required-answer message shown on the earlier question, the wizard
    // validation is treating the submitted (disabled) choices as unanswered.
    expect(button('Previous question').disabled).toBe(true)
    expect(button('Next question').disabled).toBe(false)
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(revealedErrors()).toHaveLength(0)
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

    // ArrowLeft at the start review boundary is inert, like the disabled
    // Previous, and never reveals required-answer feedback.
    act(() => {
      activeItem().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      )
    })
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(revealedErrors()).toHaveLength(0)

    // A held ArrowRight matches the browser: it is canceled but does not
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
  it('shows every question at once in authored order without wizard chrome', () => {
    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

    const items = container.querySelectorAll('[data-slot="questionnaire-item"]')
    expect(items).toHaveLength(2)
    // Authored order is kept and no question is hidden away or inert.
    expect(items[0]?.textContent).toContain('Which option is correct?')
    expect(items[1]?.textContent).toContain('Which options apply?')
    for (const item of items) {
      expect(item.hasAttribute('hidden')).toBe(false)
      expect(item.hasAttribute('inert')).toBe(false)
    }

    // The per-question wizard progress and Previous/Next do not exist in this
    // presentation at all; every question is answered in place with one
    // bottom Submit.
    expect(container.querySelector('[data-slot="questionnaire-progress"]')).toBeNull()
    expect(container.querySelector('[data-slot="questionnaire-previous"]')).toBeNull()
    expect(container.querySelector('[data-slot="questionnaire-next"]')).toBeNull()
    expect(container.textContent).not.toContain('Question 1 of 2')
    expect(container.textContent).not.toContain('Previous question')
    expect(container.textContent).not.toContain('Next question')
    expect(button('Submit questionnaire').type).toBe('submit')

    // Correctness stays hidden until submission, as in the wizard mode.
    expect(container.querySelector('[data-result]')).toBeNull()
  })

  it('answers in any order and blocks the bottom Submit without a validation message', () => {
    const onSubmitted = vi.fn()
    act(() =>
      root.render(
        <ControlledQuestionnaire node={expandedQuestionnaireNode} onSubmitted={onSubmitted} />
      )
    )

    // The learner answers out of authored order, without any navigation.
    act(() => input('alpha').click())
    expect(input('alpha').checked).toBe(true)

    // One unanswered question keeps the shared bottom Submit disabled, so
    // clicking it submits nothing and never surfaces the required-answer
    // message.
    expect(button('Submit questionnaire').disabled).toBe(true)
    act(() => button('Submit questionnaire').click())
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(revealedErrors()).toHaveLength(0)

    // Completing the remaining question enables the same single action.
    act(() => input('first').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
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

    // The expanded presentation is retained: no wizard chrome appears and
    // every question stays visible and read-only, with its feedback.
    expect(container.querySelectorAll('[data-slot="questionnaire"]')).toHaveLength(1)
    const items = container.querySelectorAll('[data-slot="questionnaire-item"]')
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.hasAttribute('hidden')).toBe(false)
      expect(item.hasAttribute('inert')).toBe(false)
    }
    expect(hasVisibleButton('Previous question')).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(false)

    // The Submit action stays rendered but disabled so a submission cannot
    // repeat, and no stale required-answer message appears.
    const submit = button('Submit questionnaire')
    expect(submit.disabled).toBe(true)
    expect(revealedErrors()).toHaveLength(0)

    // All answers are read-only and classified.
    expect(submittedControl('first').disabled).toBe(true)
    expect(submittedControl('alpha').disabled).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    // Wrong options stay neutral because they were not selected.
    expect(submittedChoiceResult('second')).toBe('neutral')
    expect(submittedChoiceResult('beta')).toBe('neutral')
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
    expect(hasVisibleButton('Previous question')).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(false)

    // The bottom Submit cannot submit twice, and read-only review never
    // surfaces the required-answer message.
    expect(button('Submit questionnaire').disabled).toBe(true)
    expect(revealedErrors()).toHaveLength(0)

    // Saved answers stay checked and read-only with their feedback revealed.
    expect(submittedChecked('second')).toBe(true)
    expect(submittedControl('second').disabled).toBe(true)
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedControl('beta').disabled).toBe(true)
    expect(submittedChoiceIsIncorrect('second')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })
})
