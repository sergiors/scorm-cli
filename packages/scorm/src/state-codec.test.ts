import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { ContentPackage, PlayerState } from '@scorm-cli/core';
import { createContentManifest } from './content-manifest';
import { decodeSuspendData, encodeSuspendData } from './state-codec';
import { createScormRuntime } from './runtime';

const packageContent: ContentPackage = {
  metadata: { title: 'Codec test' },
  presentation: {
    type: 'scroll',
    pages: ['page-one', 'page-two'].map((id, pageIndex) => ({
      type: 'page',
      id,
      source: `${id}.mdx`,
      metadata: { title: id },
      content: [
        {
          type: 'questionnaire',
          id: `quiz-${pageIndex}`,
          questions: [
            {
              type: 'question',
              id: 'q1',
              questionType: 'multiple-choice',
              prompt: [
                {
                  type: 'paragraph',
                  children: [{ type: 'text', value: 'Private prompt' }],
                },
              ],
              options: [
                {
                  value: 'red',
                  correct: true,
                  content: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Red label' }],
                    },
                  ],
                },
                {
                  value: 'blue',
                  correct: false,
                  content: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Blue label' }],
                    },
                  ],
                },
                {
                  value: 'green',
                  correct: false,
                  content: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Green label' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })),
  },
};
const manifest = createContentManifest(packageContent);

describe('compact suspend-data codec', () => {
  it('encodes only compact indexes and decodes answers through the same manifest', () => {
    const state: PlayerState = {
      location: 'must-not-persist',
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { q1: ['green', 'red'] },
        },
        'page-two': { visited: false, answers: { q1: ['blue'] } },
      },
    };
    const encoded = encodeSuspendData(manifest, state, 50);
    expect(encoded).toEqual({
      v: 1,
      p: 50,
      x: '10',
      d: { '0': { a: { '0': [0, 2] } }, '1': { a: { '0': [1] } } },
    });
    expect(Object.keys(encoded).sort()).toEqual(['d', 'p', 'v', 'x']);
    const serialized = JSON.stringify(encoded);
    expect(serialized).not.toMatch(
      /location|Private prompt|Red label|correct|red|blue|green/,
    );
    expect(decodeSuspendData(manifest, serialized)).toEqual({
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { q1: ['red', 'green'] },
        },
        'page-two': { answers: { q1: ['blue'] } },
      },
    });
  });

  it('nests single answers under each page so question indexes are page-local', () => {
    const singleChoiceManifest = structuredClone(manifest);
    Object.values(singleChoiceManifest.pages).forEach((page) => {
      page.questions['0']!.type = 'single-choice';
    });
    const encoded = encodeSuspendData(
      singleChoiceManifest,
      {
        pages: {
          'page-one': { answers: { q1: 'blue' } },
          'page-two': { answers: { q1: 'green' } },
        },
      },
      0,
    );
    expect(encoded).toEqual({
      v: 1,
      p: 0,
      x: '00',
      d: { '0': { a: { '0': 1 } }, '1': { a: { '0': 2 } } },
    });
    expect(Object.keys(encoded).sort()).toEqual(['d', 'p', 'v', 'x']);
    expect(
      decodeSuspendData(singleChoiceManifest, JSON.stringify(encoded)),
    ).toEqual({
      pages: {
        'page-one': { answers: { q1: 'blue' } },
        'page-two': { answers: { q1: 'green' } },
      },
    });
  });

  it('handles string answers, omits unknown values, and clamps progress bounds', () => {
    const single: ContentPackage = {
      ...packageContent,
      presentation: {
        type: 'grid',
        items: [
          {
            type: 'item',
            id: 'item',
            source: 'item',
            metadata: { title: 'Item' },
            content: [
              {
                type: 'questionnaire',
                id: 'q',
                questions: [
                  {
                    type: 'question',
                    id: 'str-q',
                    questionType: 'single-choice',
                    prompt: [],
                    options: [
                      { value: 'yes', correct: true, content: [] },
                      { value: 'no', correct: false, content: [] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const dictionary = createContentManifest(single);
    expect(
      encodeSuspendData(
        dictionary,
        {
          pages: {
            item: { visited: true, answers: { 'str-q': 'no', unknown: 'yes' } },
          },
        },
        -5,
      ),
    ).toEqual({
      v: 1,
      p: 0,
      x: '1',
      d: { '0': { a: { '0': 1 } } },
    });
    expect(encodeSuspendData(dictionary, { pages: {} }, 101)).toEqual({
      v: 1,
      p: 100,
      x: '0',
    });
    expect(decodeSuspendData(dictionary, { v: 1, p: 151, x: '1' })).toEqual({
      pages: {},
    });
    expect(decodeSuspendData(dictionary, { v: 1, p: 99, x: '1' })).toEqual({
      pages: { item: { visited: true } },
    });
  });

  it('returns a fresh state for malformed data and unsupported versions', () => {
    for (const raw of [
      'no json',
      '{"v":2,"p":0,"x":"00"}',
      '{"v":1,"p":101,"x":"00"}',
      '{"v":1,"p":0,"x":"bad"}',
    ]) {
      expect(decodeSuspendData(manifest, raw)).toEqual({ pages: {} });
    }
  });

  it('ignores malformed answer namespaces while preserving valid progress', () => {
    for (const d of [null, [], 'invalid', 42]) {
      expect(decodeSuspendData(manifest, { v: 1, p: 0, x: '10', d })).toEqual({
        pages: { 'page-one': { visited: true } },
      });
    }
    expect(
      decodeSuspendData(manifest, {
        v: 1,
        p: 0,
        x: '00',
        d: { '0': null, '1': { a: [] } },
      }),
    ).toEqual({ pages: {} });
  });

  it('ignores page, question, and option indexes outside the manifest', () => {
    expect(
      decodeSuspendData(manifest, {
        v: 1,
        p: 0,
        x: '00',
        d: {
          '0': { a: { '0': 99, '99': 0 } },
          '1': { a: { '0': [0, 99] } },
          '99': { a: { '0': 1 } },
        },
      }),
    ).toEqual({ pages: { 'page-two': { answers: { q1: ['red'] } } } });
  });

  it('uses the embedded manifest for LMS resume/save while keeping location separate', () => {
    const initial = encodeSuspendData(
      manifest,
      { pages: { 'page-one': { visited: true, answers: { q1: ['blue'] } } } },
      50,
    );
    const values: Record<string, string> = {
      'cmi.core.lesson_status': '',
      'cmi.core.lesson_location': 'page:resume',
      'cmi.suspend_data': JSON.stringify(initial),
    };
    const window: any = {
      __SCORM_DEVTOOLS__: true,
      parent: null,
      API: {
        LMSInitialize: () => 'true',
        LMSGetValue: (key: string) => values[key] ?? '',
        LMSSetValue: (key: string, value: string) => {
          values[key] = value;
          return 'true';
        },
        LMSCommit: () => 'true',
        LMSFinish: () => 'true',
      },
      addEventListener: () => undefined,
      dispatchEvent: () => undefined,
      CustomEvent: class {},
    };
    window.parent = window;
    vm.runInNewContext(createScormRuntime(manifest), { window });
    expect(window.scormBridge.getResumeState()).toEqual({
      location: 'page:resume',
      pages: {
        'page-one': {
          visited: true,
          completed: true,
          answers: { q1: ['blue'] },
        },
      },
    });
    expect(
      window.scormBridge.saveState({
        location: 'page:next',
        pages: {
          'page-two': { visited: true, answers: { q1: ['green', 'red'] } },
        },
      }),
    ).toBe(true);
    expect(values['cmi.core.lesson_location']).toBe('page:next');
    const compact = JSON.parse(values['cmi.suspend_data']!);
    expect(compact).toEqual({
      v: 1,
      p: 0,
      x: '01',
      d: { '1': { a: { '0': [0, 2] } } },
    });
    expect(compact).toEqual(
      encodeSuspendData(
        manifest,
        {
          location: 'page:next',
          pages: {
            'page-two': { visited: true, answers: { q1: ['green', 'red'] } },
          },
        },
        0,
      ),
    );
    expect(JSON.stringify(compact)).not.toMatch(
      /page:next|green|red|Private prompt/,
    );
  });

  it('rejects oversized SCORM 1.2 data without writing it, while saving location and committing', () => {
    const manyPages: ContentPackage = {
      metadata: { title: 'Large' },
      presentation: {
        type: 'grid',
        items: Array.from({ length: 4100 }, (_, index) => ({
          type: 'item' as const,
          id: `item-${index}`,
          source: 'item',
          metadata: { title: 'Item' },
          content: [],
        })),
      },
    };
    const largeManifest = createContentManifest(manyPages);
    const calls: string[][] = [];
    const values: Record<string, string> = {};
    const events: any[] = [];
    const window: any = {
      __SCORM_DEVTOOLS__: true,
      parent: null,
      API: {
        LMSInitialize: () => 'true',
        LMSGetValue: (key: string) => values[key] ?? '',
        LMSSetValue: (key: string, value: string) => {
          calls.push([key, value]);
          values[key] = value;
          return 'true';
        },
        LMSCommit: () => {
          calls.push(['commit']);
          return 'true';
        },
        LMSFinish: () => 'true',
      },
      addEventListener: () => undefined,
      dispatchEvent: (event: any) => events.push(event.detail),
      CustomEvent: class {
        detail: any;
        constructor(_name: string, options: any) {
          this.detail = options.detail;
        }
      },
    };
    window.parent = window;
    vm.runInNewContext(createScormRuntime(largeManifest), { window });
    expect(
      window.scormBridge.saveState({ location: 'still-saved', pages: {} }),
    ).toBe(false);
    expect(calls).toContainEqual(['cmi.core.lesson_location', 'still-saved']);
    expect(calls.some(([key]) => key === 'cmi.suspend_data')).toBe(false);
    expect(calls.at(-1)).toEqual(['commit']);
    expect(
      events.some((event) => event.name === 'lms.suspend-data-too-large'),
    ).toBe(true);
  });
});
