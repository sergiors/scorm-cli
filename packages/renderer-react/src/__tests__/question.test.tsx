// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionnaireView as QuestionnaireViewBase } from '../../app/components/QuestionnaireView'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type { ContentNode, ContentPackage, PlayerState, QuestionnaireNode } from '../../app/types'
import { multipleChoiceQuestion, questionnaireNode, singleChoiceQuestion } from './fixtures'

/**
 * Mounts a questionnaire under the same player and page contexts as authored
 * content. `lang` selects the catalog so the tests can assert localized chrome.
 */
const PAGE_ID = 'page:questionnaire-test.mdx'
const questionPackage: ContentPackage = {
  metadata: { title: 'Questionnaire test' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: PAGE_ID,
        source: 'questionnaire-test.mdx',
        metadata: { title: 'Questionnaire test' },
        content: [questionnaireNode]
      }
    ]
  }
}

let restoredState: PlayerState
let saveState: ReturnType<typeof vi.fn>

function QuestionnaireView({
  lang,
  node
}: ComponentProps<typeof QuestionnaireViewBase> & { lang?: string }) {
  return (
    <PlayerI18nProvider lang={lang}>
      <PlayerProvider contentPackage={questionPackage}>
        <PageProvider pageId={PAGE_ID}>
          <QuestionnaireViewBase node={node} />
        </PageProvider>
      </PlayerProvider>
    </PlayerI18nProvider>
  )
}

function StandaloneQuestionnaire() {
  return (
    <PlayerI18nProvider>
      <PlayerProvider contentPackage={questionPackage}>
        <QuestionnaireViewBase node={questionnaireNode} />
      </PlayerProvider>
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
  restoredState = { pages: {} }
  saveState = vi.fn()
  window.scormBridge = { restoreState: () => restoredState, saveState }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete window.scormBridge
})

function restoreQuestionnaireState(answers: Record<string, string | string[]>, submitted = false) {
  restoredState = {
    pages: {
      [PAGE_ID]: {
        answers,
        ...(submitted ? { submittedQuestionnaires: [questionnaireNode.id] } : {})
      }
    }
  }
}

function lastSavedState(): PlayerState {
  return saveState.mock.calls.at(-1)?.[0] as PlayerState
}

function submittedIds(): string[] {
  return lastSavedState()?.pages[PAGE_ID]?.submittedQuestionnaires ?? []
}

function input(value: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`input[value="${value}"]`)
  if (!element) {
    throw new Error(`Input not found for value: ${value}`)
  }
  return element
}

/**
 * A submitted choice's native input. Submitted answers render through the
 * shadcn questionnaire choice part. Its input intentionally stays enabled so
 * the Root still derives the item's answered status from it; the controlled
 * `checked` value and the dropped change interaction keep the saved selection
 * immutable instead.
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

/** The questionnaire item (fieldset) that renders a submitted option. */
function submittedItem(value: string): HTMLElement {
  const item = submittedControl(value).closest<HTMLElement>('[data-slot="questionnaire-item"]')
  if (!item) {
    throw new Error(`Submitted item not found for value: ${value}`)
  }
  return item
}

/**
 * Attempts a submitted choice change the way a learner would. A read-only
 * review drops the interaction, so every observed state after this call reveals
 * how the saved answer withstood the attempt.
 */
function attemptSubmittedChange(value: string): void {
  act(() => submittedControl(value).click())
}

/**
 * The result the submitted choice exposes for an option value. Correctness is
 * asserted through this semantic hook rather than through the color classes the
 * result styling happens to use.
 */
function submittedChoiceResult(value: string): string | null {
  return resultFromClassName(submittedChoiceClass(value))
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

function resultFromClassName(className: string): string {
  const tokens = className.split(/\s+/)
  if (tokens.some((token) => token.includes('emerald'))) {
    return 'correct'
  }
  if (
    tokens.some(
      (token) => token.includes('bg-destructive') || token.includes('border-destructive/')
    )
  ) {
    return 'incorrect'
  }
  return 'neutral'
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
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    act(() => input('first').click())
    act(() => button('Next question').click())

    // On the final question the Submit action is offered without waiting for
    // every answer, so an incomplete click reaches the Root's validation
    // instead: the required-answer message is revealed, the last question
    // stays active, and nothing is submitted.
    expect(button('Submit questionnaire').disabled).toBe(false)
    act(() => button('Submit questionnaire').click())
    expect(submittedIds()).toEqual([])
    expect(revealedErrors()).toHaveLength(1)
    expect(activeItem().textContent).toContain('Which options apply?')

    // Completing the final question lets the same enabled action submit once.
    act(() => input('alpha').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
    act(() => button('Submit questionnaire').click())
    expect(submittedIds()).toEqual([questionnaireNode.id])
  })

  it('keeps the wizard boundaries on the Root: actions appear and vanish natively', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // The primitive exposes Next at the start boundary without a native
    // disabled attribute while the item is unanswered. Using it surfaces the
    // required-answer message without advancing.
    expect(hasVisibleButton('Previous question')).toBe(false)
    expect(button('Next question').disabled).toBe(false)
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(hasVisibleButton('Submit questionnaire')).toBe(false)
    expect(revealedErrors()).toHaveLength(1)
    act(() => input('first').click())
    expect(revealedErrors()).toHaveLength(0)
    expect(button('Next question').disabled).toBe(false)

    // The last boundary swaps the actions: Next is omitted there instead of
    // lingering disabled, Submit is offered and remains enabled regardless of
    // every answer, so Next and Submit are never shown together.
    act(() => button('Next question').click())
    expect(button('Previous question').disabled).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(false)
    expect(hasVisibleButton('Submit questionnaire')).toBe(true)
    expect(button('Submit questionnaire').type).toBe('submit')
    expect(button('Submit questionnaire').disabled).toBe(false)
  })

  it('offers only the Submit action for a single-question questionnaire', () => {
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

    // With one question there are no wizard boundaries: Previous and Next do
    // not exist and the only action is Submit, enabled before submission
    // regardless of how many questions are answered.
    expect(hasVisibleButton('Previous question')).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(false)
    const submit = button('Submit questionnaire')
    expect(submit.type).toBe('submit')
    expect(submit.disabled).toBe(false)

    // Submitting while unanswered validates instead of submitting.
    act(() => button('Submit questionnaire').click())
    expect(submittedIds()).toEqual([])
    expect(revealedErrors()).toHaveLength(1)
    expect(activeItem().textContent).toContain('Is it true?')

    // The answered question makes the same action submit once.
    act(() => input('false').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
    act(() => button('Submit questionnaire').click())
    expect(submittedIds()).toEqual(['questionnaire:check.mdx:1:1'])
  })

  it('places the wizard actions only at each native boundary', () => {
    const threeQuestionNode: QuestionnaireNode = {
      type: 'questionnaire',
      id: 'questionnaire:native.mdx:1:1',
      contributesToScore: true,
      questions: [singleChoiceQuestion, multipleChoiceQuestion, trueFalse]
    }

    act(() => root.render(<QuestionnaireView node={threeQuestionNode} />))

    // First question: Previous is omitted, Next is offered, no Submit.
    expect(hasVisibleButton('Previous question')).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(true)
    expect(hasVisibleButton('Submit questionnaire')).toBe(false)

    // Middle question: both directions are offered, still no Submit.
    act(() => input('first').click())
    act(() => button('Next question').click())
    expect(hasVisibleButton('Previous question')).toBe(true)
    expect(hasVisibleButton('Next question')).toBe(true)
    expect(hasVisibleButton('Submit questionnaire')).toBe(false)

    // Last question: Next is omitted and Submit is offered, so the two are
    // never shown together anywhere in the wizard.
    act(() => input('alpha').click())
    act(() => button('Next question').click())
    expect(hasVisibleButton('Previous question')).toBe(true)
    expect(hasVisibleButton('Next question')).toBe(false)
    expect(hasVisibleButton('Submit questionnaire')).toBe(true)
  })

  it('uses the restored answer when the learner activates Next', () => {
    // Given a fully controlled questionnaire whose owner restored only the
    // last question's answer, then the first question's Next stays disabled:
    // the controlled selection decides readiness, so the saved collection
    // alone cannot advance the wizard.
    restoreQuestionnaireState({ [multipleChoiceQuestion.id]: ['alpha'] })
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))
    expect(button('Next question').disabled).toBe(false)
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
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())
    act(() => button('Submit questionnaire').click())

    expect(submittedIds()).toEqual([questionnaireNode.id])
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
  it('reveals the required-answer message when Next is activated on an unanswered item', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Given the first question unanswered, Next has no native disabled state;
    // using it reveals required-answer validation in place.
    expect(button('Next question').disabled).toBe(false)
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(revealedErrors()).toHaveLength(1)

    // On the final question the enabled Submit validates the collection
    // instead of being gated on every answer: the unanswered item's message is
    // revealed without submitting.
    act(() => input('first').click())
    act(() => button('Next question').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
    act(() => button('Submit questionnaire').click())
    expect(revealedErrors()).toHaveLength(1)

    // Answering lifts the validation state without ever showing a stale
    // message.
    act(() => input('alpha').click())
    expect(revealedErrors()).toHaveLength(0)
  })

  it('reveals the localized required-answer message under pt-BR', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} lang="pt-BR" />))

    act(() => input('first').click())
    act(() => button('Próxima pergunta').click())

    // The enabled Submit validates an incomplete submit, so the message the
    // learner sees is the authored localized copy rather than the English
    // fallback leaked from the primitive.
    expect(button('Enviar questionário').disabled).toBe(false)
    act(() => button('Enviar questionário').click())
    const revealed = revealedErrors()
    expect(revealed).toHaveLength(1)
    expect(revealed[0]?.textContent).toBe('Escolha uma resposta para continuar.')
    expect(container.textContent).not.toContain('Choose an answer to continue.')

    // Answering hides the message again until the next incomplete attempt.
    act(() => input('alpha').click())
    expect(revealedErrors()).toHaveLength(0)
  })
})

describe('QuestionnaireView Enter shortcut gating', () => {
  it('gates plain Enter on the answer and hands Ctrl+Enter to validation', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Given the first question unanswered, plain Enter stays inert: it neither
    // advances the wizard nor surfaces a required-answer message.
    pressKey(input('first'), { key: 'Enter' })
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(revealedErrors()).toHaveLength(0)

    // Ctrl+Enter hands over to the Root's validation: the message is revealed
    // for the unanswered item, but nothing navigates or submits.
    pressKey(input('first'), { key: 'Enter', ctrlKey: true })
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(revealedErrors()).toHaveLength(1)
    expect(revealedErrors()[0]?.textContent).toContain('Choose an answer to continue.')

    // The primitive changes its active item without rerendering the owner.
    // Answering the first question lets Next reach the unanswered last one,
    // whose Ctrl+Enter validates in exactly the same way.
    act(() => input('first').click())
    act(() => button('Next question').click())
    pressKey(input('alpha'), { key: 'Enter', ctrlKey: true })
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(revealedErrors()).toHaveLength(1)
  })

  it('advances and submits with the shortcuts once the actions are enabled', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Given an answered question, Enter behaves like the enabled Next.
    act(() => input('first').click())
    pressKey(input('first'), { key: 'Enter' })
    expect(activeItem().textContent).toContain('Which options apply?')

    // With every question answered on the last one, Ctrl+Enter submits.
    act(() => input('alpha').click())
    pressKey(input('alpha'), { key: 'Enter', ctrlKey: true })
    expect(submittedIds()).toEqual([questionnaireNode.id])
  })

  it('ignores Enter and Ctrl+Enter in expanded mode until everything is answered', () => {
    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

    // Given one unanswered question, neither shortcut form may trigger the
    // bottom Submit's validation or reveal the required-answer message.
    pressKey(input('alpha'), { key: 'Enter', ctrlKey: true })
    pressKey(input('alpha'), { key: 'Enter' })
    expect(submittedIds()).toEqual([])
    expect(revealedErrors()).toHaveLength(0)
  })
})

describe('QuestionnaireView persistence', () => {
  it('keeps temporary answers local when no page owns the questionnaire', () => {
    act(() => root.render(<StandaloneQuestionnaire />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => button('Previous question').click())

    // The selection is answerable and its display survives navigation, but it
    // lives in the questionnaire itself: the bridge receives no owning page,
    // and in particular nothing restores those answers persisted anywhere.
    expect(input('first').checked).toBe(true)
    expect(
      saveState.mock.calls.every((call) => Object.keys(call[0]?.pages ?? {}).length === 0)
    ).toBe(true)
  })

  it('persists each answer under its authored question id', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    act(() => input('first').click())
    expect(lastSavedState().pages[PAGE_ID]?.answers?.[singleChoiceQuestion.id]).toBe('first')

    act(() => button('Next question').click())
    act(() => input('alpha').click())
    expect(lastSavedState().pages[PAGE_ID]?.answers?.[multipleChoiceQuestion.id]).toEqual(['alpha'])
  })

  it('persists multiple-choice answers as string arrays', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

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
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))
    act(() => input('first').click())
    act(() => button('Next question').click())

    // Toggling beta before alpha must still persist the authored order.
    act(() => input('beta').click())
    act(() => input('alpha').click())
    expect(lastSavedState().pages[PAGE_ID]?.answers?.[multipleChoiceQuestion.id]).toEqual([
      'alpha',
      'beta'
    ])

    act(() => input('beta').click())
    expect(lastSavedState().pages[PAGE_ID]?.answers?.[multipleChoiceQuestion.id]).toEqual(['alpha'])
  })

  it('restores saved selections from the page answers', () => {
    restoreQuestionnaireState({
      [singleChoiceQuestion.id]: 'second',
      [multipleChoiceQuestion.id]: ['alpha']
    })
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    expect(input('second').checked).toBe(true)
    expect(input('first').checked).toBe(false)

    act(() => button('Next question').click())
    expect(input('alpha').checked).toBe(true)
    expect(input('beta').checked).toBe(false)
  })

  it('marks the wrapper submitted after a successful final submit', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())

    expect(submittedIds()).toEqual([questionnaireNode.id])
  })

  it('restores a submitted wizard read-only, opening on its last question', () => {
    restoreQuestionnaireState(
      {
        [singleChoiceQuestion.id]: 'first',
        [multipleChoiceQuestion.id]: ['alpha', 'beta']
      },
      true
    )
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // The default presentation stays a wizard after submission: the single
    // root opens on the question that was active at submit time (the last
    // one) instead of restarting or expanding every question.
    expect(container.querySelectorAll('[data-slot="questionnaire-item"]')).toHaveLength(2)
    expect(hiddenItems()).toHaveLength(1)
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(container.textContent).toContain('Question 2 of 2')

    // The hidden earlier question keeps its saved selection rendered, and both
    // saved answers stay checked and read-only: the inputs stay enabled, but
    // every reviewed item exposes its submitted read-only state to
    // assistive technology.
    expect(hiddenItems()[0]?.textContent).toContain('Which option is correct?')
    expect(submittedChecked('first')).toBe(true)
    expect(submittedChecked('second')).toBe(false)
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChecked('beta')).toBe(true)
    expect(submittedItem('alpha').getAttribute('aria-readonly')).toBe('true')

    // A change attempt on the active review choices cannot uncheck or select
    // anything: the submitted handler drops the interaction and the controlled
    // checked value stays authoritative, so the feedback is untouched too.
    attemptSubmittedChange('alpha')
    attemptSubmittedChange('beta')
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChecked('beta')).toBe(true)
    expect(submittedChoiceResult('beta')).toBe('incorrect')
    expect(submittedChoiceResult('alpha')).toBe('correct')

    // Submission cannot repeat: the Submit action stays rendered but disabled
    // on the last review question, while the Previous action remains visible
    // and enabled for reviewing every answer. The boundary actions follow the
    // Root's native visibility, so Next is omitted on the last review question
    // instead of lingering disabled there.
    const submit = button('Submit questionnaire')
    expect(submit.type).toBe('submit')
    expect(submit.disabled).toBe(true)
    expect(hasVisibleButton('Previous question')).toBe(true)
    expect(button('Previous question').disabled).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(false)

    // A submitted questionnaire never surfaces a required-answer message for
    // its read-only choices.
    expect(revealedErrors()).toHaveLength(0)
  })

  it('reviews a restored wizard feedback question by question', () => {
    restoreQuestionnaireState(
      { [singleChoiceQuestion.id]: 'second', [multipleChoiceQuestion.id]: ['alpha'] },
      true
    )
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Opening on the last question, Previous walks back to the first
    // question's review without leaving the wizard.
    act(() => button('Previous question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')

    // The first review question is the start boundary: Previous is omitted
    // there by the Root's native visibility, while Next unlocks the return
    // path.
    expect(hasVisibleButton('Previous question')).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(true)
    expect(button('Next question').disabled).toBe(false)

    // The answer stays read-only and the result is classified: the saved
    // 'second' pick was wrong, the unselected correct option stays correct. A
    // switch attempt to the unchecked correct option is dropped, so the
    // selection cannot move.
    expect(submittedItem('second').getAttribute('aria-readonly')).toBe('true')
    attemptSubmittedChange('first')
    expect(submittedChecked('first')).toBe(false)
    expect(submittedChecked('second')).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsIncorrect('second')).toBe(true)

    // Next returns to the last question's feedback, also read-only. This is
    // the two-way review the submitted wizard must support: if it fails with
    // the required-answer message shown on the earlier question, the wizard
    // validation is treating the submitted choices as unanswered — which
    // disabling them would cause, since the Root reads answer status from
    // non-disabled controls.
    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })

  it('renders submitted answers through the shared questionnaire parts', () => {
    restoreQuestionnaireState(
      { [singleChoiceQuestion.id]: 'second', [multipleChoiceQuestion.id]: ['alpha'] },
      true
    )
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Single-choice is a questionnaire radio review; multiple-choice uses
    // questionnaire checkboxes. Their native inputs intentionally stay
    // enabled: the Root derives an item's answered status only from
    // non-disabled controls, and the controlled checked value plus the dropped
    // submitted interaction keep the saved selection immutable instead.
    const single = submittedControl('second')
    expect(single.type).toBe('radio')
    expect(single.checked).toBe(true)
    expect(single.disabled).toBe(false)
    expect(single.closest('[data-slot="questionnaire-choice"]')).not.toBeNull()

    const multiple = submittedControl('alpha')
    expect(multiple.type).toBe('checkbox')
    expect(multiple.checked).toBe(true)
    expect(submittedControl('beta').checked).toBe(false)

    // One shared form still drives the restored wizard: every question renders
    // a fieldset in the same form, the earlier one hidden while the last is
    // active, and each exposes its choices as accessible choice parts.
    expect(container.querySelectorAll('[data-slot="questionnaire"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="questionnaire-title"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-slot="questionnaire-choice"]')).toHaveLength(4)
    // Both questions stay inside the one primitive Root; the review never
    // nests or replaces a second questionnaire.
    const questionnaireRoot = container.querySelector('[data-slot="questionnaire"]')
    for (const item of container.querySelectorAll('[data-slot="questionnaire-item"]')) {
      expect(item.closest('[data-slot="questionnaire"]')).toBe(questionnaireRoot)
    }
  })

  it('classifies every correct option as correct in a submitted questionnaire', () => {
    restoreQuestionnaireState(
      { [singleChoiceQuestion.id]: 'second', [multipleChoiceQuestion.id]: ['beta'] },
      true
    )
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Correct options are classified correct whether or not the learner
    // selected them.
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
  })

  it('keeps a selected correct option correct and never incorrect', () => {
    restoreQuestionnaireState(
      { [singleChoiceQuestion.id]: 'first', [multipleChoiceQuestion.id]: ['alpha'] },
      true
    )
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // A correct option the learner selected is confirmed correct and must not
    // also carry the "selected wrong" classification. The result styling paints
    // it with the green feedback palette instead of the primary selection.
    expect(submittedChecked('first')).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsIncorrect('first')).toBe(false)
    expect(submittedChoiceClass('first')).toContain('emerald')

    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(submittedChoiceIsIncorrect('alpha')).toBe(false)
    expect(submittedChoiceClass('alpha')).toContain('emerald')
  })

  it('classifies a selected wrong single-choice option as incorrect', () => {
    restoreQuestionnaireState({ [singleChoiceQuestion.id]: 'second' }, true)
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    expect(submittedChoiceIsCorrect('first')).toBe(true)
    expect(submittedChoiceIsIncorrect('second')).toBe(true)
    expect(submittedChecked('second')).toBe(true)
    // The selected wrong pick is painted with the destructive feedback
    // palette, never the green correct one.
    expect(submittedChoiceClass('second')).toContain('destructive')
    expect(submittedChoiceClass('second')).not.toContain('emerald')
  })

  it('classifies selected wrong multiple-choice options as incorrect', () => {
    restoreQuestionnaireState({ [multipleChoiceQuestion.id]: ['beta'] }, true)
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(submittedChoiceIsIncorrect('beta')).toBe(true)
    expect(submittedChecked('beta')).toBe(true)
  })

  it('leaves unselected wrong options neutral', () => {
    restoreQuestionnaireState(
      { [singleChoiceQuestion.id]: 'first', [multipleChoiceQuestion.id]: ['alpha'] },
      true
    )
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // The wrong options were not selected, so they are classified neutral and
    // stay outside both feedback palettes.
    expect(submittedChoiceResult('second')).toBe('neutral')
    expect(submittedChoiceResult('beta')).toBe('neutral')
    expect(submittedChoiceClass('second')).not.toContain('emerald')
    expect(submittedChoiceClass('beta')).not.toContain('emerald')
    expect(submittedChecked('second')).toBe(false)
    expect(submittedChecked('beta')).toBe(false)
  })
})

describe('QuestionnaireView submitted wizard flow', () => {
  it('keeps the wizard on its active question after submitting', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

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
    // repeat, Previous remains enabled for reviewing results, and Next is
    // omitted on the final review question by the Root's native visibility.
    expect(button('Submit questionnaire').disabled).toBe(true)
    expect(hasVisibleButton('Previous question')).toBe(true)
    expect(button('Previous question').disabled).toBe(false)
    expect(hasVisibleButton('Next question')).toBe(false)

    // The answered questions read as results with their feedback. Review stays
    // read-only without disabling the controls: the input stays enabled, the
    // choice keeps its hover palette (never `data-disabled`), and a change
    // attempt on the active question is dropped, so the rendered selection,
    // its feedback, and the owner's persisted answers all keep the submitted
    // values.
    expect(submittedItem('alpha').getAttribute('aria-readonly')).toBe('true')
    expect(submittedControl('alpha').disabled).toBe(false)
    const alphaChoice = submittedControl('alpha').closest<HTMLElement>(
      '[data-slot="questionnaire-choice"]'
    )
    expect(alphaChoice?.hasAttribute('data-disabled')).toBe(false)
    expect(alphaChoice?.className).toContain('hover:bg-input/40')
    const savedAnswers = lastSavedState().pages[PAGE_ID]?.answers
    attemptSubmittedChange('beta')
    attemptSubmittedChange('alpha')
    expect(submittedChecked('alpha')).toBe(true)
    expect(submittedChecked('beta')).toBe(false)
    expect(submittedChecked('first')).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(lastSavedState().pages[PAGE_ID]?.answers).toEqual(savedAnswers)

    // Review never surfaces a stale required-answer message.
    expect(revealedErrors()).toHaveLength(0)
  })

  it('reviews every submitted answer read-only through Previous and Next', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    act(() => input('first').click())
    act(() => button('Next question').click())
    act(() => input('alpha').click())
    act(() => button('Submit questionnaire').click())

    // Previous revisits the first question, still exactly one item visible,
    // with its saved answer checked and feedback revealed. The change attempt
    // to the unchecked option is dropped, so the saved selection cannot move.
    act(() => button('Previous question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(hiddenItems()).toHaveLength(1)
    expect(submittedChecked('first')).toBe(true)
    attemptSubmittedChange('second')
    expect(submittedChecked('second')).toBe(false)
    expect(submittedChecked('first')).toBe(true)
    expect(submittedChoiceIsCorrect('first')).toBe(true)

    // The start review boundary keeps Previous omitted by the Root's native
    // visibility, while Next returns to the last question's feedback. This is
    // the two-way review the submitted wizard must support: if it fails with
    // the required-answer message shown on the earlier question, the wizard
    // validation is treating the submitted choices as unanswered.
    expect(hasVisibleButton('Previous question')).toBe(false)
    expect(button('Next question').disabled).toBe(false)

    // Submit belongs only to the last review question, so it is not offered
    // from an earlier one.
    expect(hasVisibleButton('Submit questionnaire')).toBe(false)

    act(() => button('Next question').click())
    expect(activeItem().textContent).toContain('Which options apply?')

    // Back on the last review question Submit reappears, but it stays disabled
    // so a submission can never repeat.
    const submit = button('Submit questionnaire')
    expect(submit.type).toBe('submit')
    expect(submit.disabled).toBe(true)
    expect(submittedChoiceIsCorrect('alpha')).toBe(true)
    expect(revealedErrors()).toHaveLength(0)
  })

  it('reviews submitted answers with arrow keys without repeating a held key', () => {
    restoreQuestionnaireState(
      { [singleChoiceQuestion.id]: 'first', [multipleChoiceQuestion.id]: ['alpha'] },
      true
    )
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

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

    // The wizard progress primitive and Previous/Next controls do not exist in
    // this presentation; static authored question labels remain, with one
    // bottom Submit for the whole form.
    expect(container.querySelector('[data-slot="questionnaire-progress"]')).toBeNull()
    expect(container.querySelector('[data-slot="questionnaire-previous"]')).toBeNull()
    expect(container.querySelector('[data-slot="questionnaire-next"]')).toBeNull()
    expect(container.textContent).toContain('Question 1 of 2')
    expect(container.textContent).toContain('Question 2 of 2')
    expect(container.textContent).not.toContain('Previous question')
    expect(container.textContent).not.toContain('Next question')
    expect(button('Submit questionnaire').type).toBe('submit')

    // Correctness stays hidden until submission, as in the wizard mode.
    expect(container.querySelector('[data-result]')).toBeNull()
  })

  it('answers in any order and blocks the bottom Submit without a validation message', () => {
    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

    // The learner answers out of authored order, without any navigation.
    act(() => input('alpha').click())
    expect(input('alpha').checked).toBe(true)

    // One unanswered question keeps the shared bottom Submit disabled, so
    // clicking it submits nothing and never surfaces the required-answer
    // message.
    expect(button('Submit questionnaire').disabled).toBe(true)
    act(() => button('Submit questionnaire').click())
    expect(submittedIds()).toEqual([])
    expect(revealedErrors()).toHaveLength(0)

    // Completing the remaining question enables the same single action.
    act(() => input('first').click())
    expect(button('Submit questionnaire').disabled).toBe(false)
    act(() => button('Submit questionnaire').click())
    expect(submittedIds()).toEqual([expandedQuestionnaireNode.id])
  })

  it('submits through the bottom action and keeps every question in review', () => {
    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

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
    restoreQuestionnaireState(
      { [singleChoiceQuestion.id]: 'second', [multipleChoiceQuestion.id]: ['alpha'] },
      true
    )
    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

    // Restoration keeps the expanded layout: one root, every question visible
    // in authored order, static question labels, and no wizard navigation.
    expect(container.querySelectorAll('[data-slot="questionnaire"]')).toHaveLength(1)
    const items = container.querySelectorAll('[data-slot="questionnaire-item"]')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('Which option is correct?')
    expect(items[1]?.textContent).toContain('Which options apply?')
    for (const item of items) expect(item.hasAttribute('hidden')).toBe(false)
    expect(container.textContent).toContain('Question 1 of 2')
    expect(container.textContent).toContain('Question 2 of 2')
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

/**
 * The submitted feedback must reach the learner identically through both
 * presentations: they share one result palette source and keep the reviewed
 * choice labels looking interactive rather than muted. These cases render
 * both presentations side by side with the same reviewed answers so their
 * choice labels can be compared directly.
 */
describe('QuestionnaireView submitted feedback alignment', () => {
  const reviewedAnswers: Record<string, string | string[]> = {
    [singleChoiceQuestion.id]: 'second',
    [multipleChoiceQuestion.id]: ['alpha']
  }

  function BothSubmittedPresentations() {
    return (
      <>
        <div data-rendered-as="stepper">
          <QuestionnaireView node={questionnaireNode} />
        </div>
        <div data-rendered-as="expanded">
          <QuestionnaireView node={expandedQuestionnaireNode} />
        </div>
      </>
    )
  }

  /** The scope one presentation rendered into. */
  function renderedAs(presentation: string): HTMLElement {
    const scope = container.querySelector<HTMLElement>(`[data-rendered-as="${presentation}"]`)
    if (!scope) {
      throw new Error(`Presentation not rendered: ${presentation}`)
    }
    return scope
  }

  /** The submitted choice label of one option value in one presentation. */
  function reviewedChoice(presentation: string, value: string): HTMLElement {
    const control = renderedAs(presentation).querySelector<HTMLInputElement>(
      `[data-slot="questionnaire-choice-input"][value="${value}"]`
    )
    const choice = control?.closest<HTMLElement>('[data-slot="questionnaire-choice"]')
    if (!choice) {
      throw new Error(`Submitted choice not found in ${presentation}: ${value}`)
    }
    return choice
  }

  /** Whether a reviewed input is disabled, presentation-scoped. */
  function reviewedInputDisabled(presentation: string, value: string): boolean {
    const control = renderedAs(presentation).querySelector<HTMLInputElement>(
      `[data-slot="questionnaire-choice-input"][value="${value}"]`
    )
    if (!control) {
      throw new Error(`Input not found in ${presentation}: ${value}`)
    }
    return control.disabled
  }

  /** The result a submitted choice is classified with in one presentation. */
  function reviewedResult(presentation: string, value: string): string | null {
    return resultFromClassName(reviewedChoice(presentation, value).className)
  }

  /**
   * The feedback color tokens one submitted choice paints, so the palette is
   * asserted through the colors the learner actually sees.
   */
  function reviewedFeedbackTokens(presentation: string, value: string): string[] {
    return reviewedChoice(presentation, value)
      .className.split(/\s+/)
      .filter(paintsResultFeedback)
      .sort()
  }

  it('reveals the same correct and incorrect feedback colors in both presentations', () => {
    restoreQuestionnaireState(reviewedAnswers, true)
    act(() => root.render(<BothSubmittedPresentations />))

    // Reviewing the same answers classifies every option identically, and
    // both presentations paint the result with exactly the same color tokens,
    // so neither gains or loses feedback styling.
    for (const [value, result] of [
      ['first', 'correct'],
      ['second', 'incorrect'],
      ['alpha', 'correct'],
      ['beta', 'neutral']
    ] as const) {
      expect(reviewedResult('stepper', value)).toBe(result)
      expect(reviewedResult('expanded', value)).toBe(result)
      expect(reviewedFeedbackTokens('stepper', value)).toEqual(
        reviewedFeedbackTokens('expanded', value)
      )
    }

    // The aligned palettes are the shared ones: emerald green, including the
    // checked-state tint a selected correct option keeps, and destructive red
    // for a selected wrong one, while an unselected wrong option stays
    // outside both palettes.
    const tokens = (presentation: string, value: string) =>
      reviewedFeedbackTokens(presentation, value)
    expect(tokens('stepper', 'first')).toContain('border-emerald-600/60')
    expect(tokens('expanded', 'first')).toContain('bg-emerald-500/10')
    expect(tokens('stepper', 'alpha')).toContain('data-checked:bg-emerald-500/15')
    expect(tokens('expanded', 'alpha')).toContain('data-checked:bg-emerald-500/15')
    expect(tokens('stepper', 'second')).toContain('border-destructive/60')
    expect(tokens('expanded', 'second')).toContain('bg-destructive/10')
    expect(tokens('stepper', 'second')).toContain('data-checked:bg-destructive/15')
    expect(tokens('expanded', 'second')).toContain('data-checked:bg-destructive/15')
    expect(tokens('stepper', 'beta')).toEqual([])
    expect(tokens('expanded', 'beta')).toEqual([])

    // No palette bleeds into the opposite result in either presentation.
    for (const presentation of ['stepper', 'expanded']) {
      const feedback = (value: string) => tokens(presentation, value).join(' ')
      expect(feedback('first')).not.toContain('destructive')
      expect(feedback('second')).not.toContain('emerald')
    }
  })

  it('keeps the reviewed choice labels styled without marking them disabled', () => {
    restoreQuestionnaireState(reviewedAnswers, true)
    act(() => root.render(<BothSubmittedPresentations />))

    // The hover utility remains on choice labels and the primitive does not
    // mark them disabled. The shared submitted palette also applies its own
    // pointer-events rule.
    for (const presentation of ['stepper', 'expanded']) {
      for (const value of ['first', 'second', 'alpha', 'beta']) {
        const choice = reviewedChoice(presentation, value)
        expect(choice.getAttribute('data-disabled')).toBeNull()
        expect(choice.className).toContain('hover:bg-input/40')
        expect(choice.className.split(/\s+/)).toContain('pointer-events-none')
        // The feedback paints on the same label: it coexists with the hover
        // styling instead of replacing it.
        expect(resultFromClassName(choice.className)).toBe(reviewedResult(presentation, value))
      }
    }

    // Only the actual controls differ between the presentations: the wizard
    // keeps them enabled for the Root's answer derivation, and the expanded
    // review disables its native inputs directly — never the labels.
    for (const value of ['first', 'second', 'alpha', 'beta']) {
      expect(reviewedInputDisabled('stepper', value)).toBe(false)
      expect(reviewedInputDisabled('expanded', value)).toBe(true)
    }
  })
})
