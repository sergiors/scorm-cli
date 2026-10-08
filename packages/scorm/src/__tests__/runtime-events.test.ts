import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { ContentManifest } from '../content-manifest';
import { createScormRuntime } from '../runtime';

const manifest: ContentManifest = {
  schemaVersion: 1,
  title: 'Runtime events',
  presentation: 'scroll',
  pages: {
    '0': { id: 'page-one', title: 'One', questions: {} },
  },
};

const runtime = createScormRuntime(manifest);

const suspendManifest: ContentManifest = {
  schemaVersion: 1,
  title: 'Suspend events',
  presentation: 'scroll',
  pages: {
    '0': {
      id: 'page-one',
      title: 'One',
      questions: {
        '0': {
          id: 'q-one',
          type: 'multiple-choice',
          prompt: '',
          options: {
            '0': { value: 'alpha', label: 'Alpha' },
            '1': { value: 'beta', label: 'Beta' },
          },
        },
      },
    },
  },
};

/** A valid compact payload that already carries page progress and answers. */
const initialSuspendData = JSON.stringify({
  v: 1,
  p: 50,
  x: '1',
  d: { '0': { a: { '0': [0, 1] } } },
});

interface CreateWindowOptions {
  devtools?: boolean;
  console?: boolean;
  /** Raw suspend_data returned by the mock LMS for `cmi.suspend_data` reads. */
  suspendData?: string;
  /** Makes every `LMSGetValue` call throw, simulating a failing read. */
  getValueThrows?: boolean;
  /** Removes `LMSGetValue` entirely, simulating an unsupported method. */
  getValueMissing?: boolean;
  /** Makes `LMSSetValue` of `cmi.suspend_data` return `'false'`. */
  setValueRejectsSuspendData?: boolean;
  /** Makes `LMSSetValue` of `cmi.suspend_data` throw, simulating a failing write. */
  setValueThrowsSuspendData?: boolean;
}

/**
 * Runs the generated runtime inside a vm sandbox with a mock LMS API and a
 * console spy, mirroring how `scorm dev` injects it into the page.
 */
function createWindow(options: CreateWindowOptions = {}) {
  const logs: unknown[][] = [];
  const api: Record<string, unknown> = {
    LMSInitialize: () => 'true',
    LMSGetValue: (key?: string) => {
      if (options.getValueThrows) throw new Error('read failed');
      return options.suspendData !== undefined && key === 'cmi.suspend_data'
        ? options.suspendData
        : '';
    },
    LMSSetValue: (key?: string) => {
      if (key === 'cmi.suspend_data' && options.setValueThrowsSuspendData) {
        throw new Error('write failed');
      }
      if (key === 'cmi.suspend_data' && options.setValueRejectsSuspendData) {
        return 'false';
      }
      return 'true';
    },
    LMSCommit: () => 'true',
    LMSFinish: () => 'true',
  };
  if (options.getValueMissing) delete api.LMSGetValue;
  const window: Record<string, any> = { API: api };
  if (options.devtools !== false) window.__SCORM_DEVTOOLS__ = true;
  if (options.console !== false) {
    window.console = { log: (...args: unknown[]) => logs.push(args) };
  }
  window.parent = window;
  window.addEventListener = () => {};
  return { window, logs };
}

describe('SCORM runtime dev event logging', () => {
  it('logs every event to the console with no cap', () => {
    const { window, logs } = createWindow();
    vm.runInNewContext(runtime, { window });

    // Startup discovery, initialize, resume reads/writes and commit.
    const startupCount = logs.length;
    expect(startupCount).toBeGreaterThan(0);

    for (let index = 0; index < 40; index += 1) {
      window.scormBridge.saveState({
        location: `page-${index}`,
        pages: { 'page-one': { visited: true } },
      });
    }

    // Each save writes lesson_location, then suspend_data, then commits.
    expect(logs.length).toBe(startupCount + 40 * 3);
    expect(logs.length).toBeGreaterThan(100);

    for (const args of logs) {
      expect(args[0]).toMatch(/^\[scorm\] lms\./);
      expect(args[1]).toMatchObject({
        name: expect.any(String),
        at: expect.any(Number),
        details: expect.any(Object),
      });
    }
  });

  it('does not log when dev tools are disabled', () => {
    const { window, logs } = createWindow({
      devtools: false,
      suspendData: initialSuspendData,
    });
    vm.runInNewContext(runtime, { window });

    window.scormBridge.saveState({
      location: 'page-one',
      pages: { 'page-one': { visited: true } },
    });

    expect(logs).toHaveLength(0);
  });

  it('does not throw when no console is available', () => {
    const { window } = createWindow({ console: false });

    expect(() => vm.runInNewContext(runtime, { window })).not.toThrow();
    expect(() =>
      window.scormBridge.saveState({ location: 'page-one', pages: {} }),
    ).not.toThrow();
  });

  it('logs the complete serialized suspend_data on read and write events', () => {
    const { window, logs } = createWindow({ suspendData: initialSuspendData });
    vm.runInNewContext(createScormRuntime(suspendManifest), { window });

    window.scormBridge.saveState({
      location: 'page-one',
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { 'q-one': ['alpha', 'beta'] },
        },
      },
    });

    const events = logs.map(
      (args) => args[1] as { name: string; details: Record<string, unknown> },
    );
    const readEvent = events.find(
      (event) =>
        event.name === 'lms.get-value' &&
        event.details.key === 'cmi.suspend_data',
    );
    const writeEvent = events.find(
      (event) =>
        event.name === 'lms.set-value' &&
        event.details.key === 'cmi.suspend_data',
    );

    // Reads carry the raw LMS value in both `value` and `result`.
    expect(readEvent?.details.value).toBe(initialSuspendData);
    expect(readEvent?.details.result).toBe(initialSuspendData);
    expect(readEvent?.details.length).toBe(initialSuspendData.length);

    // Writes carry the full encoded payload, not just its length.
    const serialized = writeEvent?.details.value as string;
    expect(typeof serialized).toBe('string');
    expect(writeEvent?.details.length).toBe(serialized.length);
    expect(JSON.parse(serialized)).toEqual({
      v: 1,
      p: 100,
      x: '1',
      d: { '0': { a: { '0': [0, 1] } } },
    });

    expect(JSON.stringify([readEvent, writeEvent])).not.toContain('redacted');
  });

  it('retains the full serialized suspend_data when the LMS rejects the write', () => {
    const scenarios = [
      { label: 'returns false', options: { setValueRejectsSuspendData: true } },
      { label: 'throws', options: { setValueThrowsSuspendData: true } },
    ] as const;

    for (const scenario of scenarios) {
      const { window, logs } = createWindow(scenario.options);
      vm.runInNewContext(createScormRuntime(suspendManifest), { window });

      const saved = window.scormBridge.saveState({
        location: 'page-one',
        pages: {
          'page-one': {
            visited: true,
            completed: true,
            answers: { 'q-one': ['alpha', 'beta'] },
          },
        },
      });
      expect(saved, scenario.label).toBe(false);

      const writeEvent = logs
        .map(
          (args) =>
            args[1] as { name: string; details: Record<string, unknown> },
        )
        .find(
          (event) =>
            event.name === 'lms.set-value' &&
            event.details.key === 'cmi.suspend_data',
        );

      expect(writeEvent?.details.method, scenario.label).toBe('LMSSetValue');

      // The dev event keeps the complete attempted payload and its length,
      // even though the LMS rejected it.
      const serialized = writeEvent?.details.value as string;
      expect(typeof serialized, scenario.label).toBe('string');
      expect(writeEvent?.details.length, scenario.label).toBe(
        serialized.length,
      );
      expect(JSON.parse(serialized), scenario.label).toEqual({
        v: 1,
        p: 100,
        x: '1',
        d: { '0': { a: { '0': [0, 1] } } },
      });

      // ...and records how the write failed.
      if (scenario.label === 'returns false') {
        expect(writeEvent?.details.result, scenario.label).toBe('false');
      } else {
        expect(writeEvent?.details.result, scenario.label).toBe('');
        expect(writeEvent?.details.error, scenario.label).toBe('write failed');
      }
    }
  });

  it('does not report the suspend_data key as data when a read throws', () => {
    const { window, logs } = createWindow({ getValueThrows: true });
    vm.runInNewContext(createScormRuntime(suspendManifest), { window });

    const readEvent = logs
      .map(
        (args) => args[1] as { name: string; details: Record<string, unknown> },
      )
      .find(
        (event) =>
          event.name === 'lms.get-value' &&
          event.details.key === 'cmi.suspend_data',
      );

    expect(readEvent?.details.method).toBe('LMSGetValue');
    expect(readEvent?.details.result).toBe('');
    expect(readEvent?.details.error).toBe('read failed');
    expect(readEvent?.details).not.toHaveProperty('value');
    expect(readEvent?.details).not.toHaveProperty('length');
  });

  it('does not report the suspend_data key as data when a read is unavailable', () => {
    const { window, logs } = createWindow({ getValueMissing: true });
    vm.runInNewContext(createScormRuntime(suspendManifest), { window });

    const readEvent = logs
      .map(
        (args) => args[1] as { name: string; details: Record<string, unknown> },
      )
      .find(
        (event) =>
          event.name === 'lms.get-value' &&
          event.details.key === 'cmi.suspend_data',
      );

    expect(readEvent?.details.method).toBe('LMSGetValue');
    expect(readEvent?.details.reason).toBe('method-unavailable');
    expect(readEvent?.details).not.toHaveProperty('value');
    expect(readEvent?.details).not.toHaveProperty('length');
  });
});
