import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type {
  ContentPackage,
  PlayerState,
  QuestionNode,
  QuestionOption,
  QuestionType,
} from '@scorm-cli/core';
import { createContentManifest } from '../content-manifest';
import {
  browserCodecSource,
  decodeSuspendData,
  encodeSuspendData,
} from '../state-codec';
import { createScormRuntime } from '../runtime';

function option(value: string, label: string): QuestionOption {
  return {
    value,
    correct: false,
    content: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: label }],
      },
    ],
  };
}

function question(
  id: string,
  questionType: QuestionType,
  options: Array<[value: string, label: string]>,
): QuestionNode {
  return {
    type: 'question',
    id,
    questionType,
    prompt: [],
    options: options.map(([value, label]) => option(value, label)),
  };
}

function questionnaire(id: string, questions: QuestionNode[]) {
  return { type: 'questionnaire' as const, id, questions };
}

// Mirrors what the parser produces for authored Question components: option
// indexes follow source order, which is deliberately not alphabetical here.
const content: ContentPackage = {
  metadata: { title: 'Codec integration' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page-0',
        source: '0.mdx',
        metadata: { title: 'Zero' },
        content: [],
      },
      {
        type: 'page',
        id: 'page-1',
        source: '1.mdx',
        metadata: { title: 'One' },
        content: [],
      },
      {
        type: 'page',
        id: 'page-2',
        source: '2.mdx',
        metadata: { title: 'Two' },
        content: [],
      },
      {
        type: 'page',
        id: 'page-3',
        source: '3.mdx',
        metadata: { title: 'Three' },
        content: [
          questionnaire('quiz-3', [
            question('q-3-multi', 'multiple-choice', [
              ['zebra', 'Zebra'],
              ['mango', 'Mango'],
              ['apple', 'Apple'],
            ]),
            question('q-3-single', 'single-choice', [
              ['beta', 'Beta'],
              ['alpha', 'Alpha'],
            ]),
          ]),
        ],
      },
      {
        type: 'page',
        id: 'page-4',
        source: '4.mdx',
        metadata: { title: 'Four' },
        content: [
          questionnaire('quiz-4', [
            question('q-4-single', 'single-choice', [
              ['gamma', 'Gamma'],
              ['delta', 'Delta'],
            ]),
          ]),
        ],
      },
    ],
  },
};

const manifest = createContentManifest(content);

// The target shape from the plan: page 3 holds a multiple-choice answer (array)
// at question index 0 and a single-choice answer (scalar) at index 1; page 4
// holds a scalar at question index 0. Question indexes are page-local.
const compact = {
  v: 1,
  p: 0,
  x: '00000',
  d: { '3': { a: { '0': [1], '1': 1 } }, '4': { a: { '0': 0 } } },
};

// A complete persisted payload: answers match `compact`, but progress is 100%
// and every one of the five pages is flagged visited.
const supplied = {
  v: 1,
  p: 100,
  x: '11111',
  d: { '3': { a: { '0': [1], '1': 1 } }, '4': { a: { '0': 0 } } },
};

const selected: PlayerState = {
  pages: {
    'page-3': { answers: { 'q-3-multi': ['mango'], 'q-3-single': 'alpha' } },
    'page-4': { answers: { 'q-4-single': 'gamma' } },
  },
};

const restored: PlayerState = {
  pages: {
    'page-3': { answers: { 'q-3-multi': ['mango'], 'q-3-single': 'alpha' } },
    'page-4': { answers: { 'q-4-single': 'gamma' } },
  },
};

const normalize = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value)) as unknown;

describe('suspend-data codec integration', () => {
  it('maps authored option order into manifest indexes without sorting values', () => {
    expect(manifest.pages['3']!.questions['0']!.options).toEqual({
      '0': { value: 'zebra', label: 'Zebra' },
      '1': { value: 'mango', label: 'Mango' },
      '2': { value: 'apple', label: 'Apple' },
    });
    expect(manifest.pages['3']!.questions['1']!.options).toEqual({
      '0': { value: 'beta', label: 'Beta' },
      '1': { value: 'alpha', label: 'Alpha' },
    });
    // Index 1 is the authored second option, not the alphabetically first value.
    expect(manifest.pages['3']!.questions['0']!.options['1']!.value).toBe(
      'mango',
    );
    expect(manifest.pages['3']!.questions['0']!.options['2']!.value).toBe(
      'apple',
    );
    expect(manifest.pages['3']!.questions['1']!.options['1']!.value).toBe(
      'alpha',
    );
  });

  it('encodes scalar vs array per question type and decodes page-local values', () => {
    const encoded = encodeSuspendData(manifest, selected, 0);
    expect(encoded).toEqual(compact);

    const serialized = JSON.stringify(encoded);
    // No semantic values or labels may leak into the persisted payload.
    expect(serialized).not.toMatch(/zebra|mango|apple|beta|alpha|gamma|delta/i);
    expect(encoded).not.toHaveProperty('location');

    const decoded = decodeSuspendData(manifest, serialized);
    expect(decoded).toEqual(restored);
    const answers3 = decoded.pages['page-3']!.answers!;
    expect(Array.isArray(answers3['q-3-multi'])).toBe(true);
    expect(answers3['q-3-multi']).toEqual(['mango']);
    expect(typeof answers3['q-3-single']).toBe('string');
    expect(answers3['q-3-single']).toBe('alpha');
    expect(typeof decoded.pages['page-4']!.answers!['q-4-single']).toBe(
      'string',
    );
  });

  it('round-trips the target fixture for both question types', () => {
    const decoded = decodeSuspendData(manifest, JSON.stringify(compact));
    expect(decoded).toEqual(restored);
    expect(encodeSuspendData(manifest, decoded, 0)).toEqual(compact);
  });

  it('decodes the complete supplied payload through manifest option indexes', () => {
    const decoded = decodeSuspendData(manifest, JSON.stringify(supplied));

    // Page 3 question index 0 is the multiple-choice question, so scalar/array
    // index 1 resolves to the authored second option (mango), not the
    // alphabetically first value.
    const questions3 = manifest.pages['3']!.questions;
    expect(questions3['0']!.type).toBe('multiple-choice');
    expect(questions3['0']!.options['1']!.value).toBe('mango');
    expect(decoded.pages['page-3']!.answers!['q-3-multi']).toEqual(['mango']);

    // Page 3 question index 1 is page-local: scalar 1 resolves to alpha.
    expect(questions3['1']!.type).toBe('single-choice');
    expect(questions3['1']!.options['1']!.value).toBe('alpha');
    expect(decoded.pages['page-3']!.answers!['q-3-single']).toBe('alpha');

    // Page 4 also uses question index 0: scalar 0 resolves to gamma through its
    // own options, independent of page 3.
    expect(manifest.pages['4']!.questions['0']!.options['0']!.value).toBe(
      'gamma',
    );
    expect(decoded.pages['page-4']!.answers!['q-4-single']).toBe('gamma');

    // p: 100 completes all five pages and x: '11111' marks each visited.
    for (const pageId of ['page-0', 'page-1', 'page-2', 'page-3', 'page-4']) {
      expect(decoded.pages[pageId]).toMatchObject({
        visited: true,
        completed: true,
      });
    }
  });

  it('keeps the same question index independent across pages', () => {
    const decoded = decodeSuspendData(manifest, JSON.stringify(compact));
    // Both pages use question index '0', resolved through their own options.
    expect(decoded.pages['page-3']!.answers!['q-3-multi']).toEqual(['mango']);
    expect(decoded.pages['page-4']!.answers!['q-4-single']).toBe('gamma');
    expect(decoded.pages['page-3']!.answers).not.toHaveProperty('q-4-single');
    expect(decoded.pages['page-4']!.answers).not.toHaveProperty('q-3-multi');
  });

  it('matches the browser runtime codec for encode and decode', () => {
    const context: Record<string, unknown> = {};
    vm.createContext(context);
    vm.runInContext(browserCodecSource(), context);
    const browserEncode = context.compactEncode as (
      manifest: unknown,
      state: unknown,
      progress: number,
    ) => string;
    const browserDecode = context.compactDecode as (
      manifest: unknown,
      raw: unknown,
    ) => PlayerState;
    expect(typeof browserEncode).toBe('function');
    expect(typeof browserDecode).toBe('function');

    expect(JSON.parse(browserEncode(manifest, selected, 0))).toEqual(
      encodeSuspendData(manifest, selected, 0),
    );
    expect(normalize(browserDecode(manifest, JSON.stringify(compact)))).toEqual(
      decodeSuspendData(manifest, JSON.stringify(compact)),
    );
  });

  it('saves compact suspend data without values and keeps location separate', () => {
    const values: Record<string, string> = {};
    const window: any = {
      __SCORM_DEVTOOLS__: false,
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

    expect(
      window.scormBridge.saveState({ location: 'page:resume-4', ...selected }),
    ).toBe(true);
    expect(values['cmi.core.lesson_location']).toBe('page:resume-4');
    const suspendData = values['cmi.suspend_data']!;
    expect(suspendData).not.toMatch(
      /page:resume-4|zebra|mango|apple|beta|alpha|gamma|delta/i,
    );
    expect(JSON.parse(suspendData)).toEqual(compact);
    expect(window.scormBridge.getResumeState()).toEqual({
      location: 'page:resume-4',
      ...restored,
    });
  });
});
