import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { scormDevMock } from './mock';

const preferenceKey = 'scorm-cli:dev:persist-cmi';
const stateKey = 'scorm-cli:dev:cmi-state';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createMock(storage: MemoryStorage) {
  const window: Record<string, any> = { localStorage: storage };
  vm.runInNewContext(scormDevMock, { window });
  return window;
}

describe('SCORM dev mock CMI persistence', () => {
  it('defaults to enabled and stores that preference on first run', () => {
    const storage = new MemoryStorage();
    const window = createMock(storage);

    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(true);
    expect(storage.getItem(preferenceKey)).toBe('true');
  });

  it('restores existing state when the preference is absent', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      stateKey,
      JSON.stringify({ 'cmi.core.lesson_location': 'existing-lesson' }),
    );

    const window = createMock(storage);
    expect(storage.getItem(preferenceKey)).toBe('true');
    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(true);
    expect(window.API.LMSInitialize('')).toBe('true');
    expect(window.API.LMSGetValue('cmi.core.lesson_location')).toBe(
      'existing-lesson',
    );
  });

  it('saves CMI on first run and restores it after reload', () => {
    const storage = new MemoryStorage();
    const firstRun = createMock(storage);

    expect(firstRun.API.LMSInitialize('')).toBe('true');
    expect(
      firstRun.API.LMSSetValue('cmi.core.lesson_location', 'lesson-2'),
    ).toBe('true');
    expect(JSON.parse(storage.getItem(stateKey)!)).toMatchObject({
      'cmi.core.lesson_location': 'lesson-2',
    });

    const reloaded = createMock(storage);
    expect(reloaded.scormDevTools.getCmiPersistenceEnabled()).toBe(true);
    expect(reloaded.API.LMSInitialize('')).toBe('true');
    expect(reloaded.API.LMSGetValue('cmi.core.lesson_location')).toBe(
      'lesson-2',
    );
  });

  it('keeps an explicit false preference disabled and clears saved state', () => {
    const storage = new MemoryStorage();
    const firstRun = createMock(storage);
    expect(firstRun.API.LMSInitialize('')).toBe('true');
    expect(
      firstRun.API.LMSSetValue('cmi.core.lesson_location', 'lesson-2'),
    ).toBe('true');
    expect(storage.getItem(stateKey)).not.toBeNull();

    firstRun.scormDevTools.setCmiPersistenceEnabled(false);
    expect(storage.getItem(preferenceKey)).toBe('false');
    expect(storage.getItem(stateKey)).toBeNull();

    storage.setItem(
      stateKey,
      JSON.stringify({ 'cmi.core.lesson_location': 'stale' }),
    );
    const reloaded = createMock(storage);
    expect(reloaded.scormDevTools.getCmiPersistenceEnabled()).toBe(false);
    expect(storage.getItem(stateKey)).toBeNull();
    expect(reloaded.API.LMSInitialize('')).toBe('true');
    expect(reloaded.API.LMSGetValue('cmi.core.lesson_location')).toBe('');
  });

  it('honors an explicit true preference and restores saved CMI', () => {
    const storage = new MemoryStorage();
    storage.setItem(preferenceKey, 'true');
    storage.setItem(
      stateKey,
      JSON.stringify({ 'cmi.core.lesson_location': 'lesson-3' }),
    );

    const window = createMock(storage);
    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(true);
    expect(window.API.LMSInitialize('')).toBe('true');
    expect(window.API.LMSGetValue('cmi.core.lesson_location')).toBe('lesson-3');
  });

  it('does not crash when localStorage is unavailable', () => {
    const window: Record<string, any> = {};
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage unavailable');
      },
    });

    expect(() => vm.runInNewContext(scormDevMock, { window })).not.toThrow();
    expect(window.scormDevTools.getCmiPersistenceEnabled()).toBe(false);
    expect(window.API.LMSInitialize('')).toBe('true');
    expect(window.API.LMSSetValue('cmi.core.lesson_location', 'lesson-2')).toBe(
      'true',
    );
  });
});
