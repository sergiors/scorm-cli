// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Questionnaire,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireTitle
} from '../../app/components/ui/questionnaire'

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

function questionnaireInput(): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>('[data-slot="questionnaire-input"]')
  if (!element) {
    throw new Error('Questionnaire input not found')
  }
  return element
}

/**
 * Renders a single-item questionnaire wrapping the `QuestionnaireInput` so the
 * primitive has the Item context it requires.
 */
function renderInput({
  itemProps,
  inputProps
}: {
  itemProps?: Partial<ComponentProps<typeof QuestionnaireItem>>
  inputProps?: ComponentProps<typeof QuestionnaireInput>
} = {}) {
  act(() =>
    root.render(
      <Questionnaire items={[{ name: 'field', required: true }]}>
        <QuestionnaireItem name="field" required {...itemProps}>
          <QuestionnaireTitle>Field</QuestionnaireTitle>
          <QuestionnaireInput aria-label="Field" {...inputProps} />
        </QuestionnaireItem>
      </Questionnaire>
    )
  )
}

/** React only reports `onChange` when the native value setter is used. */
function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('QuestionnaireInput', () => {
  it('renders the questionnaire control inside its wrapper slot', () => {
    renderInput()

    // The wrapper and control slots are the structure consumers and the
    // questionnaire primitives target, independent of the styling layered on
    // top by the composed shadcn `Input`.
    const wrapper = container.querySelector<HTMLElement>(
      '[data-slot="questionnaire-input-wrapper"]'
    )
    expect(wrapper).not.toBeNull()

    const input = questionnaireInput()
    expect(input.tagName).toBe('INPUT')
    expect(wrapper?.contains(input)).toBe(true)
  })

  it('preserves primitive props such as type, disabled and aria-label', () => {
    renderInput({ inputProps: { type: 'email', disabled: true } })

    const input = questionnaireInput()
    expect(input.type).toBe('email')
    expect(input.disabled).toBe(true)
    expect(input.getAttribute('aria-label')).toBe('Field')
  })

  it('reflects the primitive invalid state on the rendered element', () => {
    renderInput({ itemProps: { invalid: true } })

    expect(questionnaireInput().getAttribute('aria-invalid')).toBe('true')
  })

  it('keeps the primitive filled/empty state semantics', () => {
    renderInput()

    const input = questionnaireInput()
    expect(input.getAttribute('data-empty')).toBe('')
    expect(input.hasAttribute('data-filled')).toBe(false)

    act(() => setValue(input, 'hello'))

    expect(input.hasAttribute('data-empty')).toBe(false)
    expect(input.getAttribute('data-filled')).toBe('')
    expect(input.value).toBe('hello')
  })
})
