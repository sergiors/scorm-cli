// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Checkbox } from '../../app/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger
} from '../../app/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '../../app/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../app/components/ui/select'

/**
 * Keyboard and accessibility checks for the migrated interactive wrappers
 * (`select`, `checkbox`, `dialog`, `popover`). Everything asserted here follows
 * real Base UI semantics, for example:
 *
 * - open/closed is marked with `data-open` / `data-closed` (never the Radix
 *   `data-state` attributes),
 * - the checkbox control is a `role="checkbox"` element backed by a hidden
 *   native input, and only Space (never Enter) toggles it,
 * - select items only commit presses that begin on the option.
 */

/** jsdom does not scroll; the item-aligned select uses this to reveal options. */
Element.prototype.scrollIntoView = () => {}

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

function keydown(element: EventTarget, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

function keyup(element: EventTarget, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  })
}

/**
 * A full mouse press on `element`: Base UI treats an option as pressed only
 * when the click begins on it (an explicit `pointerdown`), mirroring how real
 * browsers sequence the pair.
 */
function mousePress(element: EventTarget): void {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }))
    ;(element as HTMLElement).click()
  })
}

describe('Dialog wrapper', () => {
  function DialogHarness(props: React.ComponentProps<typeof Dialog> & { description?: string }) {
    const { description, ...dialogProps } = props
    return (
      <Dialog {...dialogProps}>
        <DialogTrigger>Open panel</DialogTrigger>
        <DialogContent>
          <DialogTitle>Preview panel</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogContent>
      </Dialog>
    )
  }

  it('opens through the trigger with labelled-dialog semantics and closes on Escape', () => {
    act(() => root.render(<DialogHarness description="Explains the panel." />))

    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="dialog-trigger"]')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    act(() => trigger.click())

    const popup = document.querySelector('[role="dialog"]') as HTMLElement
    expect(popup).not.toBeNull()
    expect(popup.getAttribute('data-open')).toBe('')
    // The Base UI popup is labelled by its rendered Title part...
    expect(popup.getAttribute('aria-labelledby')).toBe(
      document.querySelector('[data-slot="dialog-title"]')?.id
    )
    expect(popup.getAttribute('aria-describedby')).toBe(
      document.querySelector('[data-slot="dialog-description"]')?.id
    )
    // ...and the trigger points assistive tech at the open panel.
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    keydown(document, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes through the injected close button without unlabelled chrome', () => {
    act(() => root.render(<DialogHarness />))
    act(() => container.querySelector<HTMLButtonElement>('[data-slot="dialog-trigger"]')!.click())

    const popup = document.querySelector('[role="dialog"]') as HTMLElement
    // The title part exists, so the dialog is never an unlabelled dialog.
    expect(popup.querySelector('[data-slot="dialog-title"]')).not.toBeNull()
    // The icon close button is wired into the same popup through ids, not
    // `aria-controls` (Base UI close parts act, they are not regions).
    const close = popup.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')
    expect(close?.getAttribute('aria-controls')).toBeNull()

    act(() => close!.click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('controls the panel through the open prop instead of uncontrolled state', () => {
    const onOpenChange = vi.fn()
    function ControlledHarness() {
      const [open, setOpen] = React.useState(false)
      return (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            onOpenChange(next)
          }}
        >
          <DialogTrigger
            render={
              <button type="button" onClick={() => setOpen(!open)}>
                Open panel
              </button>
            }
          />
          <DialogContent>
            <DialogTitle>Preview panel</DialogTitle>
          </DialogContent>
        </Dialog>
      )
    }
    act(() => root.render(<ControlledHarness />))

    act(() => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(true)

    keydown(document, 'Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })
})

describe('Select wrapper', () => {
  interface SelectHarnessProps {
    disabled?: boolean
    defaultValue?: string
    onValueChange?: (value: string | null) => void
  }

  function SelectHarness({ disabled, defaultValue, onValueChange }: SelectHarnessProps) {
    return (
      <Select
        items={{ red: 'Red', green: 'Green' }}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger aria-label="Accent color">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="red">Red</SelectItem>
          <SelectItem value="green">Green</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  function selectTrigger(): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]')!
  }

  function option(label: string): HTMLElement {
    const item = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find(
      (candidate) => candidate.textContent?.trim() === label
    )
    if (!item) {
      throw new Error(`Select option "${label}" not found`)
    }
    return item as HTMLElement
  }

  it('passes data-slot="select" to the Base UI root', () => {
    const select = Select({ children: null })
    expect(select.props['data-slot']).toBe('select')
  })

  it('renders an accessible combobox whose menu stays closed until asked', () => {
    act(() => root.render(<SelectHarness defaultValue="red" />))

    const trigger = selectTrigger()
    expect(trigger.getAttribute('role')).toBe('combobox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // The popup only exists in the portal while the menu is open.
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull()

    act(() => trigger.click())

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const popup = document.querySelector('[data-slot="select-content"]') as HTMLElement
    expect(popup).not.toBeNull()
    expect(popup.getAttribute('data-open')).toBe('')
    // Options are exposed as a real listbox surface, and the committed value is
    // marked selected.
    const options = document.querySelectorAll('[role="option"]')
    expect(options).toHaveLength(2)
    expect(option('Red').getAttribute('aria-selected')).toBe('true')
    expect(option('Green').getAttribute('aria-selected')).toBe('false')
  })

  it('opens with the keyboard and commits the focused option with Enter', () => {
    const onValueChange = vi.fn()
    act(() =>
      root.render(<SelectHarness defaultValue="red" onValueChange={(v) => onValueChange(v)} />)
    )

    keydown(selectTrigger(), 'ArrowDown')
    const popup = document.querySelector('[data-slot="select-content"]') as HTMLElement
    expect(popup).not.toBeNull()

    // Keyboard activation is a real Base UI path: the combobox opens from the
    // trigger's key press, and Enter on a focused option commits it.
    const green = option('Green')
    act(() => green.focus())
    keydown(green, 'Enter')
    expect(onValueChange).toHaveBeenCalledWith('green')
    // A commit dismisses the menu.
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull()
  })

  it('commits an option pressed with the mouse and keeps the label current', () => {
    const onValueChange = vi.fn()
    act(() =>
      root.render(<SelectHarness defaultValue="red" onValueChange={(v) => onValueChange(v)} />)
    )

    act(() => selectTrigger().click())
    mousePress(option('Green'))

    expect(onValueChange).toHaveBeenCalledWith('green')
    expect(selectTrigger().textContent).toContain('Green')
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull()
  })

  it('closes the open menu on Escape without committing anything', () => {
    const onValueChange = vi.fn()
    act(() => root.render(<SelectHarness onValueChange={(v) => onValueChange(v)} />))

    act(() => selectTrigger().click())
    expect(document.querySelector('[data-slot="select-content"]')).not.toBeNull()

    keydown(document.querySelector('[data-slot="select-content"]') as Element, 'Escape')
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(selectTrigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('never opens a disabled combobox', () => {
    act(() => root.render(<SelectHarness disabled />))
    const trigger = selectTrigger()
    expect(trigger.disabled).toBe(true)

    act(() => trigger.click())
    expect(document.querySelector('[data-slot="select-content"]')).toBeNull()
  })
})

describe('Checkbox wrapper', () => {
  function CheckboxHarness(props: Partial<React.ComponentProps<typeof Checkbox>>) {
    const { onCheckedChange, indeterminate, ...rest } = props
    const [checked, setChecked] = React.useState(false)
    const controlled = props.checked
    return (
      <label htmlFor="probe-checkbox">
        <Checkbox
          id="probe-checkbox"
          checked={controlled ?? checked}
          indeterminate={indeterminate}
          onCheckedChange={(value, details) => {
            setChecked(value === true)
            onCheckedChange?.(value, details)
          }}
          {...rest}
        />
        Mark the probe
      </label>
    )
  }

  function checkboxControl(): HTMLElement {
    const element = document.querySelector('[data-slot="checkbox"]')
    if (!element) {
      throw new Error('Checkbox control not found')
    }
    return element as HTMLElement
  }

  it('exposes a role=checkbox control backed by a hidden native input', () => {
    act(() => root.render(<CheckboxHarness checked={true} />))

    const checkbox = checkboxControl()
    expect(checkbox.getAttribute('role')).toBe('checkbox')
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    expect(checkbox.getAttribute('tabindex')).toBe('0')
    // The control is named through the html `label` wired to its backing input.
    expect(document.querySelector('[for="probe-checkbox"]')).not.toBeNull()

    const input = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(input).not.toBeNull()
    expect(input?.id).toBe('probe-checkbox')
    // The native input never reaches assistive tech or the tab order.
    expect(input?.getAttribute('aria-hidden')).toBe('true')
    expect(input?.tabIndex).toBe(-1)
  })

  it('reports a mixed state so the control keeps a distinct third value', () => {
    act(() => root.render(<CheckboxHarness indeterminate checked={false} />))
    expect(checkboxControl().getAttribute('aria-checked')).toBe('mixed')
  })

  it('toggles through Space like a native checkbox and never through Enter', () => {
    const onCheckedChange = vi.fn()
    act(() => root.render(<CheckboxHarness onCheckedChange={onCheckedChange} />))

    const checkbox = checkboxControl()
    expect(checkbox.getAttribute('aria-checked')).toBe('false')

    keydown(checkbox, ' ')
    keyup(checkbox, ' ')
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
    expect(checkbox.getAttribute('aria-checked')).toBe('true')

    // Enter must not toggle: it would otherwise submit surrounding forms
    // exactly like a stray Enter would.
    keydown(checkbox, 'Enter')
    keyup(checkbox, 'Enter')
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
  })

  it('toggles through the field label click that targets the backing input', () => {
    const onCheckedChange = vi.fn()
    act(() => root.render(<CheckboxHarness onCheckedChange={onCheckedChange} />))

    act(() =>
      (document.querySelector<HTMLLabelElement>(
        '[for="probe-checkbox"]'
      ) as HTMLLabelElement)!.click()
    )
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
    expect(checkboxControl().getAttribute('aria-checked')).toBe('true')
  })

  it('marks an unavailable control disabled and inert through ARIA', () => {
    act(() => root.render(<CheckboxHarness disabled checked={false} onCheckedChange={vi.fn()} />))

    const checkbox = checkboxControl()
    expect(checkbox.getAttribute('aria-disabled')).toBe('true')
    expect(checkbox.getAttribute('data-disabled')).toBe('')
    // The backing field input is disabled too, so form data never moves.
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true)

    keydown(checkbox, ' ')
    keyup(checkbox, ' ')
    expect(checkboxControl().getAttribute('aria-checked')).toBe('false')
  })
})

describe('Popover wrapper', () => {
  function PopoverHarness() {
    return (
      <Popover>
        <PopoverTrigger>More options</PopoverTrigger>
        <PopoverContent aria-label="More options">
          <p>Popover body</p>
        </PopoverContent>
      </Popover>
    )
  }

  it('labels the dialog popup and closes on Escape', () => {
    act(() => root.render(<PopoverHarness />))

    const trigger = document.querySelector('[data-slot="popover-trigger"]') as HTMLElement
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()

    act(() => trigger.click())

    const content = document.querySelector('[data-slot="popover-content"]') as HTMLElement
    expect(content.getAttribute('data-open')).toBe('')
    expect(content.getAttribute('role')).toBe('dialog')
    expect(content.getAttribute('aria-label')).toBe('More options')
    expect(trigger.getAttribute('aria-controls')).toBe(content.id)

    keydown(document, 'Escape')
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
})
