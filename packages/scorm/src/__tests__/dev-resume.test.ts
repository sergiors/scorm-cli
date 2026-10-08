import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { ContentPackage } from '@scorm-cli/core';
import { createContentManifest } from '../content-manifest';
import { scormDevMock } from '../mock';
import { createScormRuntime } from '../runtime';

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

const content: ContentPackage = {
  metadata: { title: 'Resume test' },
  presentation: {
    type: 'grid',
    items: [
      {
        type: 'item',
        id: 'types',
        source: 'types.mdx',
        metadata: { title: 'Types' },
        content: [
          {
            type: 'questionnaire',
            id: 'types-check',
            questions: [
              {
                type: 'question',
                id: 'types-question',
                questionType: 'multiple-choice',
                prompt: [],
                options: [
                  { value: 'string', correct: true, content: [] },
                  { value: 'array', correct: true, content: [] },
                  { value: 'number', correct: false, content: [] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'item',
        id: 'functions',
        source: 'functions.mdx',
        metadata: { title: 'Functions' },
        content: [],
      },
    ],
  },
};

describe('SCORM dev reload resume', () => {
  it('restores the location and compact player state through the dev mock and generated runtime', () => {
    const storage = new MemoryStorage();
    const manifest = createContentManifest(content);
    const runtime = createScormRuntime(manifest);
    const createWindow = () => {
      const window: Record<string, any> = { localStorage: storage };
      window.parent = window;

      // Keep script order in sync with CLI dev: mock first, then manifest runtime.
      vm.runInNewContext(scormDevMock, { window });
      vm.runInNewContext(runtime, { window });
      return window;
    };

    const firstWindow = createWindow();
    expect(firstWindow.scormDevTools.getCmiPersistenceEnabled()).toBe(true);
    expect(storage.getItem('scorm-cli:dev:persist-cmi')).toBe('true');
    expect(
      firstWindow.scormBridge.saveState(
        {
          location: 'page:types',
          pages: {
            types: {
              visited: true,
              answers: { 'types-question': ['array', 'string'] },
            },
          },
        },
        50,
      ),
    ).toBe(true);

    const secondWindow = createWindow();
    expect(secondWindow.scormDevTools.getCmiPersistenceEnabled()).toBe(true);
    expect(secondWindow.scormBridge.restoreState()).toEqual({
      location: 'page:types',
      pages: {
        types: {
          visited: true,
          answers: { 'types-question': ['string', 'array'] },
        },
      },
    });
  });
});
