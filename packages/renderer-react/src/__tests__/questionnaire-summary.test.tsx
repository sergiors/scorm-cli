// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuestionnaireView as QuestionnaireViewBase } from '../../app/components/QuestionnaireView'
import { PageProvider, PlayerProvider } from '../../app/lib/player-context'
import { PlayerI18nProvider } from '../../app/lib/player-i18n'
import type { ContentPackage, PlayerState, QuestionNode, QuestionnaireNode } from '../../app/types'
import { multipleChoiceQuestion, questionnaireNode, singleChoiceQuestion } from './fixtures'

const PAGE_ID = 'page:summary-test.mdx'

const questionPackage: ContentPackage = {
  metadata: { title: 'Summary test' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: PAGE_ID,
        source: 'summary-test.mdx',
        metadata: { title: 'Summary test' },
        content: [questionnaireNode]
      }
    ]
  }
}

let restoredState: PlayerState
let saveState: ReturnType<typeof vi.fn>
let container: HTMLDivElement
let root: Root

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

function restoreQuestionnaireState(
  answers: Record<string, string | string[]>,
  questionnaireId = questionnaireNode.id
): void {
  restoredState = {
    pages: {
      [PAGE_ID]: {
        answers,
        submittedQuestionnaires: [questionnaireId]
      }
    }
  }
}

function input(value: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`input[value="${value}"]`)
  if (!element) {
    throw new Error(`Input not found for value: ${value}`)
  }
  return element
}

function visibleButton(label: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll('button')).find(
    (candidate) => !candidate.hasAttribute('hidden') && candidate.textContent?.trim() === label
  )
  if (!element) {
    throw new Error(`Visible button not found: ${label}`)
  }
  return element
}

function activeItem(): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    '[data-slot="questionnaire-item"]:not([hidden])'
  )
  if (!element) {
    throw new Error('No active questionnaire item')
  }
  return element
}

function hiddenItems(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="questionnaire-item"]')
  ).filter((item) => item.hasAttribute('hidden'))
}

function summary(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-slot="questionnaire-summary"]')
}

function summaryProgress(): SVGSVGElement {
  const element = summary()?.querySelector<SVGSVGElement>('svg[role="progressbar"]')
  if (!element) {
    throw new Error('Summary progressbar not found')
  }
  return element
}

/** The visible percentage text rendered inside the progress circle. */
function summaryPercent(): string {
  const element = summary()?.querySelector<HTMLElement>('[aria-hidden="true"]')
  if (!element) {
    throw new Error('Summary percentage not found')
  }
  return element.textContent ?? ''
}

function choiceResult(value: string): string | null {
  const control = container.querySelector<HTMLInputElement>(
    `[data-slot="questionnaire-choice-input"][value="${value}"]`
  )
  const choice = control?.closest<HTMLElement>('[data-slot="questionnaire-choice"]')
  if (!choice) {
    throw new Error(`Choice not found for value: ${value}`)
  }
  if (choice.className.split(/\s+/).some((token) => token.includes('emerald'))) {
    return 'correct'
  }
  if (
    choice.className
      .split(/\s+/)
      .some((token) => token.includes('bg-destructive') || token.includes('border-destructive/'))
  ) {
    return 'incorrect'
  }
  return 'neutral'
}

const expandedQuestionnaireNode: QuestionnaireNode = {
  ...questionnaireNode,
  expanded: true
}

/** A third single-choice question so a summary percentage is not a whole fraction. */
const roundingQuestion: QuestionNode = {
  type: 'question',
  id: 'question:intro.mdx:1:3',
  questionType: 'single-choice',
  prompt: 'Which answer is right?',
  options: [
    { value: 'yes', correct: true, content: 'Yes' },
    { value: 'no', correct: false, content: 'No' }
  ]
}

const threeQuestionNode: QuestionnaireNode = {
  ...questionnaireNode,
  questions: [singleChoiceQuestion, roundingQuestion, multipleChoiceQuestion]
}

describe('QuestionnaireSummary in the stepper presentation', () => {
  it('appears only after submission and keeps the wizard on one question', () => {
    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // Before submission there is no result surface and the wizard still shows
    // exactly one question.
    expect(summary()).toBeNull()
    expect(hiddenItems()).toHaveLength(1)

    act(() => input('first').click())
    act(() => visibleButton('Next question').click())
    act(() => input('alpha').click())
    act(() => visibleButton('Submit questionnaire').click())

    // The summary is localized, reports one point per question, and is
    // announced by its own title through aria-labelledby.
    expect(summary()?.textContent).toContain('Questionnaire completed')
    expect(summary()?.textContent).toContain('2 of 2 correct answers')
    const title = summary()?.querySelector('h2')
    expect(title).not.toBeNull()
    expect(summary()?.getAttribute('aria-labelledby')).toBe(title?.id)
    const progress = summaryProgress()
    expect(progress.getAttribute('role')).toBe('progressbar')
    expect(progress.getAttribute('aria-label')).toBe('Correct answers')
    expect(progress.getAttribute('aria-valuemin')).toBe('0')
    expect(progress.getAttribute('aria-valuemax')).toBe('100')
    expect(progress.getAttribute('aria-valuenow')).toBe('100')
    // The progress circle also shows the rounded percentage as visible text.
    expect(summaryPercent()).toBe('100%')

    // Submission does not expand every question: the active last question and
    // one hidden earlier question remain, with the saved feedback preserved.
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(hiddenItems()).toHaveLength(1)
    expect(choiceResult('alpha')).toBe('correct')
    expect(choiceResult('beta')).toBe('neutral')
    expect(visibleButton('Submit questionnaire').disabled).toBe(true)

    // The summary remains across navigation instead of being tied to the
    // current question.
    act(() => visibleButton('Previous question').click())
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(hiddenItems()).toHaveLength(1)
    expect(summary()?.textContent).toContain('Questionnaire completed')
    expect(summary()?.textContent).toContain('2 of 2 correct answers')
    expect(choiceResult('first')).toBe('correct')
    expect(choiceResult('second')).toBe('neutral')
  })

  it('restores the summary from persisted submission and answers after reload', () => {
    restoreQuestionnaireState({
      [singleChoiceQuestion.id]: 'first',
      [multipleChoiceQuestion.id]: ['beta']
    })

    act(() => root.render(<QuestionnaireView node={questionnaireNode} />))

    // One correct single-choice answer and one wrong multiple-choice answer
    // produce a 50% result immediately from persisted state.
    expect(summary()?.textContent).toContain('1 of 2 correct answers')
    expect(summaryProgress().getAttribute('aria-valuenow')).toBe('50')
    expect(summaryPercent()).toBe('50%')

    // With no saved active position, the read-only review opens on the first
    // question and keeps feedback for all restored answers.
    expect(activeItem().textContent).toContain('Which option is correct?')
    expect(hiddenItems()).toHaveLength(1)
    expect(choiceResult('alpha')).toBe('correct')
    expect(choiceResult('beta')).toBe('incorrect')
    act(() => visibleButton('Next question').click())
    expect(activeItem().textContent).toContain('Which options apply?')
    expect(hiddenItems()).toHaveLength(1)
    expect(summary()?.textContent).toContain('1 of 2 correct answers')
    expect(visibleButton('Submit questionnaire').disabled).toBe(true)
  })

  it('rounds a mixed result to the nearest whole percent', () => {
    restoreQuestionnaireState({
      [singleChoiceQuestion.id]: 'first',
      [roundingQuestion.id]: 'no',
      [multipleChoiceQuestion.id]: ['alpha']
    })

    act(() => root.render(<QuestionnaireView node={threeQuestionNode} />))

    // Two of three questions earn a point, so 66.67% rounds up to 67% in both
    // the numeric progressbar value and the visible percent label.
    expect(summary()?.textContent).toContain('2 of 3 correct answers')
    expect(summaryProgress().getAttribute('aria-valuenow')).toBe('67')
    expect(summaryPercent()).toBe('67%')
  })

  it('summarizes a questionnaire that does not contribute to score', () => {
    const optedOut: QuestionnaireNode = {
      ...questionnaireNode,
      contributesToScore: false
    }
    restoreQuestionnaireState(
      {
        [singleChoiceQuestion.id]: 'first',
        [multipleChoiceQuestion.id]: ['alpha']
      },
      optedOut.id
    )

    act(() => root.render(<QuestionnaireView node={optedOut} />))

    // The summary derives its own result, independent of scoring eligibility.
    expect(summary()?.textContent).toContain('2 of 2 correct answers')
    expect(summaryProgress().getAttribute('aria-valuenow')).toBe('100')
  })

  it('localizes the summary title, score and progressbar label', () => {
    restoreQuestionnaireState({
      [singleChoiceQuestion.id]: 'first',
      [multipleChoiceQuestion.id]: ['alpha']
    })

    act(() => root.render(<QuestionnaireView node={questionnaireNode} lang="pt-BR" />))

    expect(summary()?.textContent).toContain('Questionário concluído')
    expect(summary()?.textContent).toContain('2 de 2 respostas corretas')
    expect(summaryProgress().getAttribute('aria-label')).toBe('Respostas corretas')
    // The percent label follows the locale's number formatting too.
    expect(summaryPercent()).toBe('100%')
    expect(container.textContent).not.toContain('Questionnaire completed')
    expect(container.textContent).not.toContain('2 of 2 correct answers')
  })
})

describe('QuestionnaireSummary in the expanded presentation', () => {
  it('appears near the bottom only after submission and keeps every question expanded', () => {
    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

    expect(summary()).toBeNull()
    expect(container.querySelectorAll('[data-slot="questionnaire-item"]')).toHaveLength(2)

    // Answering out of authored order and submitting through the bottom action
    // keeps the expanded layout.
    act(() => input('alpha').click())
    act(() => input('first').click())
    act(() => visibleButton('Submit questionnaire').click())

    const items = container.querySelectorAll('[data-slot="questionnaire-item"]')
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.hasAttribute('hidden')).toBe(false)
      expect(item.hasAttribute('inert')).toBe(false)
    }
    expect(summary()?.textContent).toContain('2 of 2 correct answers')
    expect(summaryProgress().getAttribute('aria-valuenow')).toBe('100')
    expect(visibleButton('Submit questionnaire').disabled).toBe(true)

    // The summary sits at the very bottom: after submission it is rendered
    // directly after the card that holds the questionnaire form.
    const form = container.querySelector('[data-slot="questionnaire"]')
    expect(form?.lastElementChild?.textContent).toContain('Submit questionnaire')
    expect(summary()?.previousElementSibling).toBe(form?.closest('[data-slot="card"]'))
    expect(choiceResult('first')).toBe('correct')
    expect(choiceResult('alpha')).toBe('correct')
  })

  it('restores a submitted expanded summary without collapsing the questions', () => {
    restoreQuestionnaireState({
      [singleChoiceQuestion.id]: 'second',
      [multipleChoiceQuestion.id]: ['alpha']
    })

    act(() => root.render(<QuestionnaireView node={expandedQuestionnaireNode} />))

    expect(summary()?.textContent).toContain('1 of 2 correct answers')
    expect(container.querySelectorAll('[data-slot="questionnaire-item"]')).toHaveLength(2)
    for (const item of container.querySelectorAll('[data-slot="questionnaire-item"]')) {
      expect(item.hasAttribute('hidden')).toBe(false)
    }
    expect(choiceResult('second')).toBe('incorrect')
    expect(choiceResult('alpha')).toBe('correct')
    expect(visibleButton('Submit questionnaire').disabled).toBe(true)
  })
})
