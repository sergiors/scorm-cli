// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendScormRuntimeEvent,
  MAX_SCORM_RUNTIME_EVENTS,
  parseScormRuntimeEvent,
  SCORM_RUNTIME_EVENT_NAME,
  subscribeToScormRuntimeEvents,
  type ScormRuntimeEvent,
} from '../app/lib/scorm-runtime-events';

function makeEvent(name: string, at: number): ScormRuntimeEvent {
  return { name, at, details: {} };
}

/** Dispatches a raw `scorm:runtime-event` CustomEvent on `window`. */
function dispatch(detail: unknown): void {
  window.dispatchEvent(new CustomEvent(SCORM_RUNTIME_EVENT_NAME, { detail }));
}

/** Installs the runtime-owned dev buffer, as the injected mock/runtime would. */
function setDevEventBuffer(
  entries: unknown[] | undefined,
): unknown[] | undefined {
  const buffer = entries;
  (
    window as { __SCORM_DEV_EVENT_BUFFER__?: unknown }
  ).__SCORM_DEV_EVENT_BUFFER__ = buffer;
  return buffer;
}

afterEach(() => {
  setDevEventBuffer(undefined);
});

describe('parseScormRuntimeEvent', () => {
  it('accepts a well-formed SCORM runtime payload', () => {
    expect(
      parseScormRuntimeEvent({
        name: 'lms.set-value',
        at: 42,
        details: {
          method: 'LMSSetValue',
          key: 'cmi.core.lesson_status',
          value: 'completed',
          result: true,
        },
      }),
    ).toEqual({
      name: 'lms.set-value',
      at: 42,
      details: {
        method: 'LMSSetValue',
        key: 'cmi.core.lesson_status',
        value: 'completed',
        result: true,
      },
    });
  });

  it('rejects payloads that do not match the wire contract', () => {
    expect(parseScormRuntimeEvent(undefined)).toBeUndefined();
    expect(parseScormRuntimeEvent(null)).toBeUndefined();
    expect(parseScormRuntimeEvent('lms.commit')).toBeUndefined();
    expect(
      parseScormRuntimeEvent({ name: '', at: 1, details: {} }),
    ).toBeUndefined();
    expect(
      parseScormRuntimeEvent({ name: 'lms.commit', at: 'now', details: {} }),
    ).toBeUndefined();
    expect(
      parseScormRuntimeEvent({
        name: 'lms.commit',
        at: Number.NaN,
        details: {},
      }),
    ).toBeUndefined();
    expect(
      parseScormRuntimeEvent({ name: 'lms.commit', at: 1, details: [] }),
    ).toBeUndefined();
    expect(
      parseScormRuntimeEvent({
        name: 'lms.commit',
        at: 1,
        details: { nested: { method: 'LMSCommit' } },
      }),
    ).toBeUndefined();
  });
});

describe('subscribeToScormRuntimeEvents', () => {
  it('consumes scorm:runtime-event payloads and unsubscribes cleanly', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, true);

    dispatch({
      name: 'lms.initialize',
      at: 7,
      details: { method: 'LMSInitialize', result: 'true' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({
      name: 'lms.initialize',
      at: 7,
      details: { method: 'LMSInitialize', result: 'true' },
    });

    unsubscribe();
    dispatch({ name: 'lms.commit', at: 8, details: {} });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores events that do not match the wire contract', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, true);

    dispatch({ nope: true });
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('does not subscribe when the dev client is absent', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, false);

    dispatch({ name: 'lms.commit', at: 1, details: {} });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('buffered startup events', () => {
  it('replays buffered events in original chronological order', () => {
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
    ]);

    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, true);

    expect(listener.mock.calls.map((call) => call[0])).toEqual([
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
    ]);

    unsubscribe();
  });

  it('delivers live events after the replay', () => {
    setDevEventBuffer([{ name: 'lms.api-found', at: 1, details: {} }]);

    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, true);
    expect(listener).toHaveBeenCalledTimes(1);

    dispatch({ name: 'lms.commit', at: 2, details: { method: 'LMSCommit' } });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toEqual({
      name: 'lms.commit',
      at: 2,
      details: { method: 'LMSCommit' },
    });

    unsubscribe();
  });

  it('ignores malformed buffered records', () => {
    setDevEventBuffer([
      { nope: true },
      { name: '', at: 1, details: {} },
      { name: 'lms.commit', at: 'later', details: {} },
      { name: 'lms.commit', at: 4, details: { nested: {} } },
      { name: 'lms.commit', at: 5, details: { method: 'LMSCommit' } },
    ]);

    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toEqual({
      name: 'lms.commit',
      at: 5,
      details: { method: 'LMSCommit' },
    });

    unsubscribe();
  });

  it('ignores a dev buffer that is not an array', () => {
    (
      window as { __SCORM_DEV_EVENT_BUFFER__?: unknown }
    ).__SCORM_DEV_EVENT_BUFFER__ = { events: [] };

    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, true);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('does not replay the same buffer on a repeated subscription', () => {
    setDevEventBuffer([{ name: 'lms.initialize', at: 1, details: {} }]);

    const first = vi.fn();
    const unsubscribeFirst = subscribeToScormRuntimeEvents(first, true);
    expect(first).toHaveBeenCalledTimes(1);
    unsubscribeFirst();

    const second = vi.fn();
    const unsubscribeSecond = subscribeToScormRuntimeEvents(second, true);
    expect(second).not.toHaveBeenCalled();
    unsubscribeSecond();
  });

  it('does not replay buffered events when the dev client is absent', () => {
    setDevEventBuffer([{ name: 'lms.commit', at: 1, details: {} }]);

    const listener = vi.fn();
    const unsubscribe = subscribeToScormRuntimeEvents(listener, false);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('appendScormRuntimeEvent', () => {
  it('prepends the newest event first', () => {
    const first = makeEvent('lms.initialize', 1);
    const second = makeEvent('lms.commit', 2);

    expect(
      appendScormRuntimeEvent(appendScormRuntimeEvent([], first), second),
    ).toEqual([second, first]);
  });

  it('caps the history at MAX_SCORM_RUNTIME_EVENTS, dropping the oldest', () => {
    let events: ScormRuntimeEvent[] = [];
    for (let index = 0; index < MAX_SCORM_RUNTIME_EVENTS + 5; index += 1) {
      events = appendScormRuntimeEvent(events, makeEvent('lms.commit', index));
    }

    expect(events).toHaveLength(MAX_SCORM_RUNTIME_EVENTS);
    // Newest first: the last appended event is retained, the oldest dropped.
    expect(events[0]?.at).toBe(MAX_SCORM_RUNTIME_EVENTS + 4);
    expect(events.at(-1)?.at).toBe(5);
  });
});
