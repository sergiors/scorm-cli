import { describe, expect, it, vi } from 'vitest';
import {
  parsePreviewErrorMessage,
  PREVIEW_CLEAR_EVENT,
  PREVIEW_ERROR_EVENT,
  subscribeToPreviewEvents,
  type PreviewHotContext,
} from '../app/lib/preview-events';

function makeHot(): {
  hot: PreviewHotContext;
  emit(event: string, data?: unknown): void;
} {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    hot: {
      on(event, listener) {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      off(event, listener) {
        listeners.get(event)?.delete(listener);
      },
    },
    emit(event, data) {
      listeners.get(event)?.forEach((listener) => listener(data));
    },
  };
}

describe('parsePreviewErrorMessage', () => {
  it('returns a non-empty string message', () => {
    expect(parsePreviewErrorMessage({ message: 'Missing asset' })).toBe(
      'Missing asset',
    );
  });

  it('falls back for missing, empty or malformed payloads', () => {
    expect(parsePreviewErrorMessage(undefined)).toMatch(
      /could not be rendered/,
    );
    expect(parsePreviewErrorMessage({ message: '   ' })).toMatch(
      /could not be rendered/,
    );
    expect(parsePreviewErrorMessage({ message: 42 })).toMatch(
      /could not be rendered/,
    );
  });
});

describe('subscribeToPreviewEvents', () => {
  it('forwards errors and clears, and unsubscribes cleanly', () => {
    const { hot, emit } = makeHot();
    const onError = vi.fn();
    const onClear = vi.fn();

    const unsubscribe = subscribeToPreviewEvents(hot, { onError, onClear });

    emit(PREVIEW_ERROR_EVENT, { message: 'Parse failed' });
    expect(onError).toHaveBeenCalledWith('Parse failed');

    emit(PREVIEW_CLEAR_EVENT);
    expect(onClear).toHaveBeenCalledTimes(1);

    unsubscribe();
    emit(PREVIEW_ERROR_EVENT, { message: 'Ignored' });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
