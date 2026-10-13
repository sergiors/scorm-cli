// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScormDevToolsToolbar } from '../../app/components/ScormDevToolsToolbar'

// jsdom does not implement `Element.scrollIntoView`, which Radix Select calls to
// reveal the highlighted option. Stub it so the combobox can be exercised here.
Element.prototype.scrollIntoView = () => {}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  delete window.scormDevTools
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete window.scormDevTools
})

type CmiSnapshot = Record<string, string>

/** A representative SCORM 1.2 `cmi.*` storage model. */
const CMI_12_SNAPSHOT: CmiSnapshot = {
  'cmi.core.lesson_location': '0',
  'cmi.core.lesson_status': 'incomplete',
  'cmi.core.score.raw': '0',
  'cmi.core.session_time': '0000:00:00'
}

/** A representative SCORM 2004 `cmi.*` storage model (no 1.2-only keys). */
const CMI_2004_SNAPSHOT: CmiSnapshot = {
  'cmi.location': '0',
  'cmi.completion_status': 'incomplete',
  'cmi.score.raw': '0',
  'cmi.session_time': 'PT0H0M0S'
}

/**
 * Installs a mock `window.scormDevTools` whose persisted flag, SCORM version and
 * CMI snapshot can be read and written. Returns the spies (and the emitted CMI
 * helpers) so tests can assert on calls and drive subscription notifications.
 */
function installBridge(
  initialEnabled: boolean,
  options: { version?: '1.2' | '2004'; cmi?: CmiSnapshot } = {}
): {
  getCmiPersistenceEnabled: ReturnType<typeof vi.fn>
  setCmiPersistenceEnabled: ReturnType<typeof vi.fn>
  getScormVersion: ReturnType<typeof vi.fn>
  getApiName: ReturnType<typeof vi.fn>
  setScormVersion: ReturnType<typeof vi.fn>
  getCmiSnapshot: ReturnType<typeof vi.fn>
  subscribeToCmi: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
  listeners: Set<(snapshot: CmiSnapshot) => void>
  /** Replaces the stored snapshot and notifies every current subscriber. */
  emitCmi: (snapshot: CmiSnapshot) => void
} {
  const bridge = {
    enabled: initialEnabled,
    version: options.version ?? ('1.2' as const),
    cmi: { ...(options.cmi ?? (options.version === '2004' ? CMI_2004_SNAPSHOT : CMI_12_SNAPSHOT)) }
  }
  const listeners = new Set<(snapshot: CmiSnapshot) => void>()
  const getCmiPersistenceEnabled = vi.fn(() => bridge.enabled)
  const setCmiPersistenceEnabled = vi.fn((enabled: boolean) => {
    bridge.enabled = enabled
  })
  const getScormVersion = vi.fn(() => bridge.version)
  const getApiName = vi.fn(() => (bridge.version === '2004' ? 'API_1484_11' : 'API'))
  const setScormVersion = vi.fn((version: '1.2' | '2004') => {
    bridge.version = version
  })
  // Fresh copies keep the inspector honest: it must treat each return as a
  // complete snapshot rather than mutating the mock's own storage.
  const getCmiSnapshot = vi.fn(() => ({ ...bridge.cmi }))
  const unsubscribe = vi.fn()
  const subscribeToCmi = vi.fn((listener: (snapshot: CmiSnapshot) => void) => {
    listeners.add(listener)
    // The runtime delivers a snapshot at subscription time as well as after
    // every state change.
    listener({ ...bridge.cmi })
    return () => {
      listeners.delete(listener)
      unsubscribe()
    }
  })
  const emitCmi = (snapshot: CmiSnapshot) => {
    bridge.cmi = { ...snapshot }
    for (const listener of listeners) {
      listener({ ...bridge.cmi })
    }
  }
  window.scormDevTools = {
    getCmiPersistenceEnabled,
    setCmiPersistenceEnabled,
    getScormVersion,
    getApiName,
    setScormVersion,
    getCmiSnapshot,
    subscribeToCmi
  }
  return {
    getCmiPersistenceEnabled,
    setCmiPersistenceEnabled,
    getScormVersion,
    getApiName,
    setScormVersion,
    getCmiSnapshot,
    subscribeToCmi,
    unsubscribe,
    listeners,
    emitCmi
  }
}

/** The shadcn/Radix Select trigger, rendered as a `combobox` button. */
function versionTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>('[data-slot="select-trigger"]')
  if (!trigger) {
    throw new Error('SCORM version select trigger not found')
  }
  return trigger
}

/** The Radix Select content portals into `document.body` only while open. */
function versionSelectContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="select-content"]')
}

/** Locates a portaled `role="option"` menu item by its visible label. */
function versionOption(label: string): HTMLElement {
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="select-item"]')
  ).find((candidate) => candidate.textContent?.trim() === label)
  if (!option) {
    throw new Error(`SCORM version option "${label}" not found`)
  }
  return option
}

/** Opens the version combobox by clicking its trigger. */
function openVersionSelect(): void {
  act(() => versionTrigger().click())
}

/** Finds a shadcn field label by its visible text. */
function fieldLabelWithText(text: string): HTMLLabelElement {
  const label = Array.from(
    document.querySelectorAll<HTMLLabelElement>('[data-slot="field-label"]')
  ).find((candidate) => candidate.textContent?.trim() === text)
  if (!label) {
    throw new Error(`Field label "${text}" not found`)
  }
  return label
}

/** Finds a shadcn field description containing the given text. */
function fieldDescriptionContaining(text: string): HTMLElement {
  const description = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="field-description"]')
  ).find((candidate) => candidate.textContent?.includes(text))
  if (!description) {
    throw new Error(`Field description containing "${text}" not found`)
  }
  return description
}

/** Reads the text of the field description that shows the active API name. */
/** The read-only CMI inspector's snapshot element, when the bridge exposes one. */
function cmiPre(): HTMLPreElement | null {
  return document.querySelector<HTMLPreElement>('pre[aria-label="CMI data"]')
}

/** Parses the rendered snapshot back into its flat `cmi.*` map. */
function cmiSnapshot(): CmiSnapshot {
  const pre = cmiPre()
  if (!pre) {
    throw new Error('CMI inspector snapshot not found')
  }
  return JSON.parse(pre.textContent ?? '{}') as CmiSnapshot
}

/** The shadcn Popover portals its content into `document.body`. */
function popover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="popover-content"]')
}

/** The shadcn checkbox is a `role="checkbox"` button carrying `data-slot`. */
function persistenceCheckbox(): HTMLButtonElement {
  const checkbox = document.querySelector<HTMLButtonElement>('[data-slot="checkbox"]')
  if (!checkbox) {
    throw new Error('CMI persistence checkbox not found')
  }
  return checkbox
}

/** Reads the checked state from the Radix checkbox's ARIA attribute. */
function persistenceCheckboxChecked(): boolean {
  return persistenceCheckbox().getAttribute('aria-checked') === 'true'
}

function statusText(): string {
  return document.querySelector('[role="status"]')?.textContent?.trim() ?? ''
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

function toolbarToggle(): HTMLButtonElement {
  const button = buttons().find((candidate) => candidate.textContent?.includes('Dev tools'))
  if (!button) {
    throw new Error('Dev tools toggle not found')
  }
  return button
}

function hasToolbarToggle(): boolean {
  return buttons().some((candidate) => candidate.textContent?.includes('Dev tools'))
}

/** Clicks the trigger inside `act` so the portaled popover mounts/unmounts. */
function togglePopover(): void {
  act(() => toolbarToggle().click())
}

describe('ScormDevToolsToolbar', () => {
  it('is collapsed by default and labelled as dev tools', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))

    const toggle = toolbarToggle()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-haspopup')).toBe('dialog')
    expect(toggle.textContent).toContain('Dev tools')
    // No panel is mounted until the popover is opened.
    expect(popover()).toBeNull()
    expect(document.querySelector('[role="log"]')).toBeNull()
    expect(container.textContent).not.toContain('SCORM events')
  })

  it('opens a portaled shadcn popover anchored to its trigger', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    const content = popover()
    expect(content).not.toBeNull()
    expect(content?.dataset.slot).toBe('popover-content')
    expect(content?.dataset.state).toBe('open')
    // Anchored to the end of the top-right trigger.
    expect(content?.dataset.align).toBe('end')
    expect(content?.getAttribute('role')).toBe('dialog')
    expect(content?.getAttribute('aria-label')).toBe('Dev tools')

    // The trigger is wired to the portaled content for assistive tech.
    const toggle = toolbarToggle()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-controls')).toBe(content?.id)
  })

  it('renders the popover without a header part', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    const content = popover()
    expect(content).not.toBeNull()
    // The panel hosts the control directly, with no header/title chrome.
    expect(content?.querySelector('[data-slot="popover-header"]')).toBeNull()
    expect(content?.querySelector('[data-slot="popover-title"]')).toBeNull()
  })

  it('closes the popover through the trigger and on Escape', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))

    togglePopover()
    expect(popover()).not.toBeNull()
    expect(toolbarToggle().getAttribute('aria-expanded')).toBe('true')

    // Second trigger press toggles it closed and unmounts the portal.
    togglePopover()
    expect(popover()).toBeNull()
    expect(toolbarToggle().getAttribute('aria-expanded')).toBe('false')

    // Escape (handled by the Radix dismissable layer) closes it too.
    togglePopover()
    expect(popover()).not.toBeNull()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(popover()).toBeNull()
    expect(toolbarToggle().getAttribute('aria-expanded')).toBe('false')
  })

  it('never exposes internal "mock" wording in its user-facing text', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))

    // Collapsed control: the toggle label and nothing else.
    expect(document.body.textContent ?? '').not.toMatch(/mock/i)

    togglePopover()

    // Expanded popover: title, labels, description and helper copy.
    expect(popover()).not.toBeNull()
    expect(document.body.textContent ?? '').not.toMatch(/mock/i)
  })

  it('shows only the persistence toggle, never a clear action or event list', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    const content = popover()
    expect(content).not.toBeNull()

    // The popover hosts exactly one control: the persistence checkbox.
    const panelButtons = content?.querySelectorAll<HTMLButtonElement>('button')
    expect(panelButtons).toHaveLength(1)
    expect(panelButtons?.[0]?.dataset.slot).toBe('checkbox')

    // The obsolete clear action and the event inspector are both gone.
    expect(document.body.textContent).not.toContain('Clear saved CMI')
    expect(document.querySelector('[role="log"]')).toBeNull()
    expect(document.body.textContent).not.toContain('SCORM events')
    expect(document.body.textContent).not.toContain('No SCORM runtime events yet')
  })

  it('renders nothing when the dev client is absent', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled={false} />))

    expect(container.textContent).toBe('')
    expect(hasToolbarToggle()).toBe(false)
    expect(popover()).toBeNull()
  })

  it('reads the initial state from the dev bridge and toggles it on and off', () => {
    const bridge = installBridge(true)
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(bridge.getCmiPersistenceEnabled).toHaveBeenCalledTimes(1)
    expect(bridge.setCmiPersistenceEnabled).not.toHaveBeenCalled()
    expect(persistenceCheckboxChecked()).toBe(true)
    expect(statusText()).toBe('')

    act(() => persistenceCheckbox().click())

    expect(bridge.setCmiPersistenceEnabled).toHaveBeenLastCalledWith(false)
    expect(persistenceCheckboxChecked()).toBe(false)
    expect(statusText()).toBe('')

    act(() => persistenceCheckbox().click())

    expect(bridge.setCmiPersistenceEnabled).toHaveBeenLastCalledWith(true)
    expect(persistenceCheckboxChecked()).toBe(true)
  })

  it('renders the toggle as a shadcn checkbox wired to a shadcn field label', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    const checkbox = persistenceCheckbox()
    // Radix checkbox is a button exposing the checkbox role, not a native input.
    expect(checkbox.getAttribute('role')).toBe('checkbox')
    expect(document.querySelector('input[type="checkbox"]')).toBeNull()

    const label = document.querySelector<HTMLLabelElement>('[data-slot="field-label"]')
    expect(label?.textContent).toBe('Persist CMI data')
    expect(label?.getAttribute('for')).toBe(checkbox.id)

    const description = document.querySelector('[data-slot="field-description"]')
    expect(description?.id).toBe(checkbox.getAttribute('aria-describedby'))
  })

  it('disables the control and shows a status when the dev bridge is absent', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    const checkbox = persistenceCheckbox()
    expect(checkbox.disabled).toBe(true)
    expect(persistenceCheckboxChecked()).toBe(false)
    expect(statusText()).toContain('unavailable')
  })

  it('surfaces a read error without crashing the toolbar', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => {
        throw new Error('storage blocked')
      },
      setCmiPersistenceEnabled: () => {}
    }

    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(document.body.textContent).toContain('storage blocked')
    expect(persistenceCheckbox().disabled).toBe(false)
    expect(persistenceCheckboxChecked()).toBe(false)
  })

  it('shows a status and keeps the control usable when a write fails', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => false,
      setCmiPersistenceEnabled: () => {
        throw new Error('quota exceeded')
      }
    }

    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()
    expect(statusText()).toBe('')

    act(() => persistenceCheckbox().click())

    expect(document.body.textContent).toContain('quota exceeded')
    expect(persistenceCheckbox().disabled).toBe(false)
    expect(persistenceCheckboxChecked()).toBe(false)
  })

  it('shows the active SCORM version and installed API from the dev bridge', () => {
    const bridge = installBridge(true, { version: '2004' })
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(bridge.getScormVersion).toHaveBeenCalled()
    expect(bridge.getApiName).toHaveBeenCalled()
    expect(versionTrigger().textContent).toContain('SCORM 2004')
  })

  it('renders the version control as an accessible combobox wired to its label', () => {
    installBridge(true)
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    const trigger = versionTrigger()
    expect(trigger.getAttribute('role')).toBe('combobox')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.disabled).toBe(false)

    const label = fieldLabelWithText('SCORM version')
    expect(label.getAttribute('for')).toBe(trigger.id)
  })

  it('switches the preview version through the dev bridge and reflects the new API', () => {
    const bridge = installBridge(true)
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(versionTrigger().textContent).toContain('SCORM 1.2')

    // The combobox is closed until its trigger is activated.
    expect(versionSelectContent()).toBeNull()
    openVersionSelect()
    expect(versionTrigger().getAttribute('aria-expanded')).toBe('true')
    expect(versionSelectContent()).not.toBeNull()

    // Choosing a version through the portaled menu drives the dev bridge.
    act(() => versionOption('SCORM 2004').click())

    expect(bridge.setScormVersion).toHaveBeenCalledWith('2004')
    expect(versionTrigger().textContent).toContain('SCORM 2004')
    // Selecting a version dismisses the menu.
    expect(versionSelectContent()).toBeNull()
    expect(versionTrigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('disables the version combobox when the bridge cannot switch versions', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => true,
      setCmiPersistenceEnabled: () => {},
      getScormVersion: () => '1.2',
      getApiName: () => 'API'
    }

    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    const trigger = versionTrigger()
    expect(trigger.disabled).toBe(true)
    expect(trigger.textContent).toContain('SCORM 1.2')

    // A disabled combobox never opens its menu.
    openVersionSelect()
    expect(versionSelectContent()).toBeNull()
  })

  it('hides the version selector when the dev bridge has no version contract', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => true,
      setCmiPersistenceEnabled: () => {}
    }

    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(document.querySelector('[data-slot="select-trigger"]')).toBeNull()
    expect(document.body.textContent).not.toContain('SCORM version')
    // The persistence control still renders on its own.
    expect(persistenceCheckboxChecked()).toBe(true)
  })

  it('shows the complete CMI snapshot hydrated from the dev bridge', () => {
    const bridge = installBridge(true)
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(bridge.getCmiSnapshot).toHaveBeenCalled()
    // The whole flat `cmi.*` map is rendered verbatim, pretty-printed.
    expect(cmiSnapshot()).toEqual(CMI_12_SNAPSHOT)
    expect(cmiPre()?.textContent).toContain('\n')
  })

  it('replaces the whole snapshot when the mock notifies subscribers', () => {
    const bridge = installBridge(true)
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(bridge.subscribeToCmi).toHaveBeenCalledTimes(1)
    expect(cmiSnapshot()).toEqual(CMI_12_SNAPSHOT)

    act(() => bridge.emitCmi({ 'cmi.core.lesson_status': 'completed' }))

    // Notifications are complete snapshots, so the previous keys are replaced
    // outright rather than merged with the new ones.
    expect(cmiSnapshot()).toEqual({ 'cmi.core.lesson_status': 'completed' })
    expect(cmiSnapshot()).not.toHaveProperty('cmi.core.lesson_location')
  })

  it('replaces the CMI model on a version switch without carrying 1.2 keys', () => {
    const bridge = installBridge(true)
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(Object.keys(cmiSnapshot())).toContain('cmi.core.lesson_location')

    openVersionSelect()
    act(() => versionOption('SCORM 2004').click())
    expect(bridge.setScormVersion).toHaveBeenCalledWith('2004')

    // The reloaded preview starts from its own 2004 storage; nothing from the
    // previous version is merged in.
    act(() => bridge.emitCmi(CMI_2004_SNAPSHOT))

    expect(cmiSnapshot()).toEqual(CMI_2004_SNAPSHOT)
    expect(Object.keys(cmiSnapshot()).some((key) => key.startsWith('cmi.core.'))).toBe(false)
  })

  it('unsubscribes from the mock when the inspector unmounts', () => {
    const bridge = installBridge(true)
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(bridge.subscribeToCmi).toHaveBeenCalledTimes(1)
    expect(bridge.listeners.size).toBe(1)
    expect(bridge.unsubscribe).not.toHaveBeenCalled()

    // Closing the popover unmounts the inspector, releasing its subscription.
    togglePopover()

    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)
    expect(bridge.listeners.size).toBe(0)
  })

  it('renders an empty snapshot as an empty object', () => {
    installBridge(true, { cmi: {} })
    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(cmiSnapshot()).toEqual({})
  })

  it('shows an unavailable note and no snapshot without the CMI contract', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => true,
      setCmiPersistenceEnabled: () => {}
    }

    act(() => root.render(<ScormDevToolsToolbar enabled />))
    togglePopover()

    expect(cmiPre()).toBeNull()
    expect(document.body.textContent).toContain('CMI data is not available')
  })
})
