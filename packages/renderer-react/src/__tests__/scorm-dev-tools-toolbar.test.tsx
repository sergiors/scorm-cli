// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScormDevToolsToolbar } from '../../app/components/ScormDevToolsToolbar';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  delete window.scormDevTools;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.scormDevTools;
});

/**
 * Installs a mock `window.scormDevTools` whose persisted flag can be read and
 * written. Returns the spies so tests can assert on calls.
 */
function installBridge(initialEnabled: boolean): {
  getCmiPersistenceEnabled: ReturnType<typeof vi.fn>;
  setCmiPersistenceEnabled: ReturnType<typeof vi.fn>;
} {
  const bridge = { enabled: initialEnabled };
  const getCmiPersistenceEnabled = vi.fn(() => bridge.enabled);
  const setCmiPersistenceEnabled = vi.fn((enabled: boolean) => {
    bridge.enabled = enabled;
  });
  window.scormDevTools = {
    getCmiPersistenceEnabled,
    setCmiPersistenceEnabled,
  };
  return { getCmiPersistenceEnabled, setCmiPersistenceEnabled };
}

/** The shadcn Popover portals its content into `document.body`. */
function popover(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="popover-content"]');
}

/** The shadcn checkbox is a `role="checkbox"` button carrying `data-slot`. */
function persistenceCheckbox(): HTMLButtonElement {
  const checkbox = document.querySelector<HTMLButtonElement>(
    '[data-slot="checkbox"]',
  );
  if (!checkbox) {
    throw new Error('CMI persistence checkbox not found');
  }
  return checkbox;
}

/** Reads the checked state from the Radix checkbox's ARIA attribute. */
function persistenceCheckboxChecked(): boolean {
  return persistenceCheckbox().getAttribute('aria-checked') === 'true';
}

function statusText(): string {
  return document.querySelector('[role="status"]')?.textContent?.trim() ?? '';
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

function toolbarToggle(): HTMLButtonElement {
  const button = buttons().find((candidate) =>
    candidate.textContent?.includes('Dev tools'),
  );
  if (!button) {
    throw new Error('Dev tools toggle not found');
  }
  return button;
}

function hasToolbarToggle(): boolean {
  return buttons().some((candidate) =>
    candidate.textContent?.includes('Dev tools'),
  );
}

/** Clicks the trigger inside `act` so the portaled popover mounts/unmounts. */
function togglePopover(): void {
  act(() => toolbarToggle().click());
}

describe('ScormDevToolsToolbar', () => {
  it('is collapsed by default and labelled as dev tools', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />));

    const toggle = toolbarToggle();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-haspopup')).toBe('dialog');
    expect(toggle.textContent).toContain('Dev tools');
    // No panel is mounted until the popover is opened.
    expect(popover()).toBeNull();
    expect(document.querySelector('[role="log"]')).toBeNull();
    expect(container.textContent).not.toContain('SCORM events');
  });

  it('opens a portaled shadcn popover with its slots and title', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />));
    togglePopover();

    const content = popover();
    expect(content).not.toBeNull();
    expect(content?.dataset.slot).toBe('popover-content');
    expect(content?.dataset.state).toBe('open');
    // Anchored to the end of the top-right trigger.
    expect(content?.dataset.align).toBe('end');
    expect(content?.getAttribute('role')).toBe('dialog');
    expect(content?.getAttribute('aria-label')).toBe('Dev tools');

    // Composes the shadcn header/title parts around the persistence control.
    const header = content?.querySelector('[data-slot="popover-header"]');
    expect(header).not.toBeNull();
    expect(
      content?.querySelector('[data-slot="popover-title"]')?.textContent,
    ).toBe('LMS persistence');

    // The trigger is wired to the portaled content for assistive tech.
    const toggle = toolbarToggle();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(content?.id);
  });

  it('closes the popover through the trigger and on Escape', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />));

    togglePopover();
    expect(popover()).not.toBeNull();
    expect(toolbarToggle().getAttribute('aria-expanded')).toBe('true');

    // Second trigger press toggles it closed and unmounts the portal.
    togglePopover();
    expect(popover()).toBeNull();
    expect(toolbarToggle().getAttribute('aria-expanded')).toBe('false');

    // Escape (handled by the Radix dismissable layer) closes it too.
    togglePopover();
    expect(popover()).not.toBeNull();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(popover()).toBeNull();
    expect(toolbarToggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('never exposes internal "mock" wording in its user-facing text', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />));

    // Collapsed control: the toggle label and nothing else.
    expect(document.body.textContent ?? '').not.toMatch(/mock/i);

    togglePopover();

    // Expanded popover: title, labels, description and helper copy.
    expect(popover()).not.toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/mock/i);
  });

  it('shows only the persistence toggle, never a clear action or event list', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />));
    togglePopover();

    const content = popover();
    expect(content).not.toBeNull();

    // The popover hosts exactly one control: the persistence checkbox.
    const panelButtons = content?.querySelectorAll<HTMLButtonElement>('button');
    expect(panelButtons).toHaveLength(1);
    expect(panelButtons?.[0]?.dataset.slot).toBe('checkbox');

    // The obsolete clear action and the event inspector are both gone.
    expect(document.body.textContent).not.toContain('Clear saved CMI');
    expect(document.querySelector('[role="log"]')).toBeNull();
    expect(document.body.textContent).not.toContain('SCORM events');
    expect(document.body.textContent).not.toContain(
      'No SCORM runtime events yet',
    );
  });

  it('renders nothing when the dev client is absent', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled={false} />));

    expect(container.textContent).toBe('');
    expect(hasToolbarToggle()).toBe(false);
    expect(popover()).toBeNull();
  });

  it('reads the initial state from the dev bridge and toggles it on and off', () => {
    const bridge = installBridge(true);
    act(() => root.render(<ScormDevToolsToolbar enabled />));
    togglePopover();

    expect(bridge.getCmiPersistenceEnabled).toHaveBeenCalledTimes(1);
    expect(bridge.setCmiPersistenceEnabled).not.toHaveBeenCalled();
    expect(persistenceCheckboxChecked()).toBe(true);
    expect(statusText()).toBe('');

    act(() => persistenceCheckbox().click());

    expect(bridge.setCmiPersistenceEnabled).toHaveBeenLastCalledWith(false);
    expect(persistenceCheckboxChecked()).toBe(false);
    expect(statusText()).toBe('');

    act(() => persistenceCheckbox().click());

    expect(bridge.setCmiPersistenceEnabled).toHaveBeenLastCalledWith(true);
    expect(persistenceCheckboxChecked()).toBe(true);
  });

  it('renders the toggle as a shadcn checkbox wired to a shadcn field label', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />));
    togglePopover();

    const checkbox = persistenceCheckbox();
    // Radix checkbox is a button exposing the checkbox role, not a native input.
    expect(checkbox.getAttribute('role')).toBe('checkbox');
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();

    const label = document.querySelector<HTMLLabelElement>(
      '[data-slot="field-label"]',
    );
    expect(label?.textContent).toBe('Persist CMI data');
    expect(label?.getAttribute('for')).toBe(checkbox.id);

    const description = document.querySelector(
      '[data-slot="field-description"]',
    );
    expect(description?.id).toBe(checkbox.getAttribute('aria-describedby'));
  });

  it('disables the control and shows a status when the dev bridge is absent', () => {
    act(() => root.render(<ScormDevToolsToolbar enabled />));
    togglePopover();

    const checkbox = persistenceCheckbox();
    expect(checkbox.disabled).toBe(true);
    expect(persistenceCheckboxChecked()).toBe(false);
    expect(statusText()).toContain('unavailable');
  });

  it('surfaces a read error without crashing the toolbar', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => {
        throw new Error('storage blocked');
      },
      setCmiPersistenceEnabled: () => {},
    };

    act(() => root.render(<ScormDevToolsToolbar enabled />));
    togglePopover();

    expect(document.body.textContent).toContain('storage blocked');
    expect(persistenceCheckbox().disabled).toBe(false);
    expect(persistenceCheckboxChecked()).toBe(false);
  });

  it('shows a status and keeps the control usable when a write fails', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => false,
      setCmiPersistenceEnabled: () => {
        throw new Error('quota exceeded');
      },
    };

    act(() => root.render(<ScormDevToolsToolbar enabled />));
    togglePopover();
    expect(statusText()).toBe('');

    act(() => persistenceCheckbox().click());

    expect(document.body.textContent).toContain('quota exceeded');
    expect(persistenceCheckbox().disabled).toBe(false);
    expect(persistenceCheckboxChecked()).toBe(false);
  });
});
