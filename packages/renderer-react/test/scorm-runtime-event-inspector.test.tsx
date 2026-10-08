// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScormRuntimeEventInspector } from '../app/components/ScormRuntimeEventInspector';
import {
  MAX_SCORM_RUNTIME_EVENTS,
  SCORM_RUNTIME_EVENT_NAME,
} from '../app/lib/scorm-runtime-events';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  clearDevEventBuffer();
  clearScormDevTools();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearDevEventBuffer();
  clearScormDevTools();
});

/** Installs the runtime-owned dev buffer, as the injected runtime would. */
function setDevEventBuffer(entries: unknown[]): void {
  (
    window as { __SCORM_DEV_EVENT_BUFFER__?: unknown }
  ).__SCORM_DEV_EVENT_BUFFER__ = entries;
}

function clearDevEventBuffer(): void {
  (
    window as { __SCORM_DEV_EVENT_BUFFER__?: unknown }
  ).__SCORM_DEV_EVENT_BUFFER__ = undefined;
}

function clearScormDevTools(): void {
  delete window.scormDevTools;
}

/**
 * Installs a mock `window.scormDevTools` whose persisted flag can be read and
 * written, mirroring the dev mock's contract. Returns the spies so tests can
 * assert on calls.
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
  window.scormDevTools = { getCmiPersistenceEnabled, setCmiPersistenceEnabled };
  return { getCmiPersistenceEnabled, setCmiPersistenceEnabled };
}

function persistenceCheckbox(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!input) {
    throw new Error('CMI persistence checkbox not found');
  }
  return input;
}

function persistenceStatus(): string {
  return container.querySelector('[role="status"]')?.textContent?.trim() ?? '';
}

/** Dispatches a raw `scorm:runtime-event` CustomEvent on `window`. */
function dispatch(detail: unknown): void {
  window.dispatchEvent(new CustomEvent(SCORM_RUNTIME_EVENT_NAME, { detail }));
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'));
}

function toggle(): HTMLButtonElement {
  const button = buttons().find((candidate) =>
    candidate.textContent?.includes('SCORM events'),
  );
  if (!button) {
    throw new Error('Inspector toggle not found');
  }
  return button;
}

function clearButton(): HTMLButtonElement {
  const button = buttons().find(
    (candidate) =>
      candidate.getAttribute('aria-label') === 'Clear captured SCORM events',
  );
  if (!button) {
    throw new Error('Clear button not found');
  }
  return button;
}

function rows(): HTMLElement[] {
  return Array.from(container.querySelectorAll('[role="log"] li'));
}

describe('ScormRuntimeEventInspector', () => {
  it('is collapsed by default and labelled as a mock LMS feed', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled />));

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('(Mock LMS)');
    expect(container.querySelector('[role="log"]')).toBeNull();
  });

  it('shows SCORM runtime events newest-first with method, details and time', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled />));

    act(() =>
      dispatch({
        name: 'lms.initialize',
        at: Date.now(),
        details: { method: 'LMSInitialize', result: 'true' },
      }),
    );
    act(() =>
      dispatch({
        name: 'lms.set-value',
        at: Date.now(),
        details: {
          method: 'LMSSetValue',
          key: 'cmi.core.lesson_status',
          value: 'completed',
        },
      }),
    );

    act(() => toggle().click());

    const items = rows();
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('lms.set-value');
    expect(items[0]?.textContent).toContain('method=LMSSetValue');
    expect(items[0]?.textContent).toContain('value=completed');
    expect(items[1]?.textContent).toContain('lms.initialize');
    expect(items[0]?.querySelector('time')?.textContent).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3}$/,
    );
  });

  it('ignores events that do not match the wire contract', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled />));

    act(() => dispatch({ nope: true }));
    act(() => dispatch({ name: 'lms.commit', at: 1, details: { bad: {} } }));
    act(() => toggle().click());

    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('No SCORM runtime events yet');
  });

  it('does not listen when the dev client is absent', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled={false} />));

    act(() =>
      dispatch({ name: 'lms.commit', at: 1, details: { method: 'LMSCommit' } }),
    );
    act(() => toggle().click());

    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('No SCORM runtime events yet');
  });

  it('clears the captured history', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled />));
    act(() =>
      dispatch({ name: 'lms.finish', at: 1, details: { method: 'LMSFinish' } }),
    );
    act(() => toggle().click());
    expect(rows()).toHaveLength(1);

    act(() => clearButton().click());

    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('No SCORM runtime events yet');
  });

  it('caps the history and drops the oldest events', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled />));

    act(() => {
      for (let index = 0; index < MAX_SCORM_RUNTIME_EVENTS + 5; index += 1) {
        dispatch({
          name: 'lms.get-value',
          at: index,
          details: { method: 'LMSGetValue', key: `key-${index}` },
        });
      }
    });
    act(() => toggle().click());

    const items = rows();
    expect(items).toHaveLength(MAX_SCORM_RUNTIME_EVENTS);
    expect(items[0]?.textContent).toContain(
      `key-${MAX_SCORM_RUNTIME_EVENTS + 4}`,
    );
    expect(items.at(-1)?.textContent).toContain('key-5');
  });

  it('replays buffered startup events on mount, then appends live events once', () => {
    setDevEventBuffer([
      { name: 'lms.api-found', at: 1, details: {} },
      {
        name: 'lms.initialize',
        at: 2,
        details: { method: 'LMSInitialize', result: 'true' },
      },
      {
        name: 'lms.get-value',
        at: 3,
        details: {
          method: 'LMSGetValue',
          key: 'cmi.core.lesson_status',
          value: '',
        },
      },
      {
        name: 'lms.set-value',
        at: 4,
        details: {
          method: 'LMSSetValue',
          key: 'cmi.core.lesson_status',
          value: 'incomplete',
        },
      },
      { name: 'lms.commit', at: 5, details: { method: 'LMSCommit' } },
    ]);

    act(() => root.render(<ScormRuntimeEventInspector enabled />));
    act(() => toggle().click());

    let items = rows();
    expect(items).toHaveLength(5);
    // Chronological replay + newest-first append: latest startup event on top.
    expect(items[0]?.textContent).toContain('lms.commit');
    expect(items[4]?.textContent).toContain('lms.api-found');

    act(() =>
      dispatch({
        name: 'lms.set-value',
        at: 6,
        details: {
          method: 'LMSSetValue',
          key: 'cmi.core.lesson_status',
          value: 'completed',
        },
      }),
    );

    items = rows();
    expect(items).toHaveLength(6);
    expect(items[0]?.textContent).toContain('value=completed');
    // Each buffered startup event is still present exactly once.
    const text = items.map((item) => item.textContent ?? '').join('\n');
    expect((text.match(/lms\.initialize/g) ?? []).length).toBe(1);
    expect((text.match(/lms\.commit/g) ?? []).length).toBe(1);
  });

  it('does not duplicate buffered startup events under StrictMode', () => {
    setDevEventBuffer([
      { name: 'lms.api-found', at: 1, details: {} },
      {
        name: 'lms.initialize',
        at: 2,
        details: { method: 'LMSInitialize', result: 'true' },
      },
      { name: 'lms.commit', at: 3, details: { method: 'LMSCommit' } },
    ]);

    act(() =>
      root.render(
        <StrictMode>
          <ScormRuntimeEventInspector enabled />
        </StrictMode>,
      ),
    );
    act(() => toggle().click());

    expect(rows()).toHaveLength(3);
  });

  it('ignores malformed buffered records', () => {
    setDevEventBuffer([
      { nope: true },
      { name: 'lms.commit', at: 1, details: { nested: {} } },
      { name: 'lms.initialize', at: 2, details: { method: 'LMSInitialize' } },
    ]);

    act(() => root.render(<ScormRuntimeEventInspector enabled />));
    act(() => toggle().click());

    const items = rows();
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('lms.initialize');
  });

  it('does not replay buffered events when the dev client is absent', () => {
    setDevEventBuffer([
      { name: 'lms.commit', at: 1, details: { method: 'LMSCommit' } },
    ]);

    act(() => root.render(<ScormRuntimeEventInspector enabled={false} />));
    act(() => toggle().click());

    expect(rows()).toHaveLength(0);
    expect(container.textContent).toContain('No SCORM runtime events yet');
  });
});

describe('ScormRuntimeEventInspector CMI persistence control', () => {
  it('reads the initial state from the dev bridge and toggles it on and off', () => {
    const bridge = installBridge(true);
    act(() => root.render(<ScormRuntimeEventInspector enabled />));
    act(() => toggle().click());

    expect(bridge.getCmiPersistenceEnabled).toHaveBeenCalledTimes(1);
    expect(bridge.setCmiPersistenceEnabled).not.toHaveBeenCalled();
    expect(persistenceCheckbox().checked).toBe(true);
    expect(persistenceStatus()).toBe('');

    act(() => persistenceCheckbox().click());

    expect(bridge.setCmiPersistenceEnabled).toHaveBeenLastCalledWith(false);
    expect(persistenceCheckbox().checked).toBe(false);
    expect(persistenceStatus()).toBe('');

    act(() => persistenceCheckbox().click());

    expect(bridge.setCmiPersistenceEnabled).toHaveBeenLastCalledWith(true);
    expect(persistenceCheckbox().checked).toBe(true);
  });

  it('disables the control and shows a status when the dev bridge is absent', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled />));
    act(() => toggle().click());

    const checkbox = persistenceCheckbox();
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.checked).toBe(false);
    expect(persistenceStatus().length).toBeGreaterThan(0);
    expect(persistenceStatus()).toContain('unavailable');
  });

  it('surfaces a read error without crashing the inspector', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => {
        throw new Error('storage blocked');
      },
      setCmiPersistenceEnabled: () => {},
    };

    act(() => root.render(<ScormRuntimeEventInspector enabled />));
    act(() => toggle().click());

    expect(container.textContent).toContain('storage blocked');
    expect(persistenceCheckbox().disabled).toBe(false);
    expect(persistenceCheckbox().checked).toBe(false);
  });

  it('shows a status and keeps the control usable when a write fails', () => {
    window.scormDevTools = {
      getCmiPersistenceEnabled: () => false,
      setCmiPersistenceEnabled: () => {
        throw new Error('quota exceeded');
      },
    };

    act(() => root.render(<ScormRuntimeEventInspector enabled />));
    act(() => toggle().click());
    expect(persistenceStatus()).toBe('');

    act(() => persistenceCheckbox().click());

    expect(container.textContent).toContain('quota exceeded');
    expect(persistenceCheckbox().disabled).toBe(false);
    expect(persistenceCheckbox().checked).toBe(false);
  });

  it('does not expose the control when the dev client is absent', () => {
    act(() => root.render(<ScormRuntimeEventInspector enabled={false} />));
    act(() => toggle().click());

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).not.toContain('Persist CMI data');
  });
});
