import { describe, expect, it } from 'vitest';
import {
  emptyPlayerState,
  sanitizePlayerState,
  sameAnswer,
  updatePageState,
  withLocation,
} from '../../app/lib/player-state';
import type { ContentPackage, PlayerState } from '../../app/types';
import { questionnaireNode, scrollPackage } from './fixtures';

/** A scroll package whose first page carries the shared questionnaire fixture. */
const questionnairePackage: ContentPackage = {
  metadata: { title: 'Questionnaire package' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:intro.mdx',
        source: 'intro.mdx',
        metadata: { title: 'Introduction' },
        content: [questionnaireNode],
      },
      {
        type: 'page',
        id: 'page:setup.mdx',
        source: 'setup.mdx',
        metadata: { title: 'Setup' },
        content: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Setup instructions.' }],
          },
        ],
      },
    ],
  },
};

describe('sanitizePlayerState', () => {
  it('returns an empty plain state for missing or non-object input', () => {
    expect(sanitizePlayerState(scrollPackage.presentation, undefined)).toEqual({
      pages: {},
    });
    expect(sanitizePlayerState(scrollPackage.presentation, null)).toEqual({
      pages: {},
    });
    expect(sanitizePlayerState(scrollPackage.presentation, 'nope')).toEqual({
      pages: {},
    });
  });

  it('keeps a known location and drops an unknown one', () => {
    const known = sanitizePlayerState(questionnairePackage.presentation, {
      location: 'page:setup.mdx',
      pages: {},
    });
    expect(known.location).toBe('page:setup.mdx');

    const unknown = sanitizePlayerState(questionnairePackage.presentation, {
      location: 'page:missing.mdx',
      pages: {},
    });
    expect(unknown.location).toBeUndefined();
  });

  it('drops unknown page ids but keeps known page flags', () => {
    const state = sanitizePlayerState(questionnairePackage.presentation, {
      pages: {
        'page:intro.mdx': { visited: true, completed: false },
        'page:missing.mdx': { visited: true },
      },
    });
    expect(state.pages).toEqual({
      'page:intro.mdx': { visited: true },
    });
  });

  it('keeps answers to known questions and drops unknown ones', () => {
    const state = sanitizePlayerState(questionnairePackage.presentation, {
      pages: {
        'page:intro.mdx': {
          answers: {
            [questionnaireNode.questions[0].id]: 'first',
            'question:missing': 'whatever',
          },
        },
      },
    });
    expect(state.pages['page:intro.mdx']?.answers).toEqual({
      [questionnaireNode.questions[0].id]: 'first',
    });
  });

  it('drops answers with an option that no longer exists', () => {
    const state = sanitizePlayerState(questionnairePackage.presentation, {
      pages: {
        'page:intro.mdx': {
          answers: { [questionnaireNode.questions[0].id]: 'gone' },
        },
      },
    });
    expect(state.pages['page:intro.mdx']).toBeUndefined();
  });

  it('drops answers whose shape does not match the question type', () => {
    const [single, multiple] = questionnaireNode.questions;
    const state = sanitizePlayerState(questionnairePackage.presentation, {
      pages: {
        'page:intro.mdx': {
          answers: {
            [single.id]: ['first'],
            [multiple.id]: 'alpha',
          },
        },
      },
    });
    expect(state.pages['page:intro.mdx']).toBeUndefined();
  });

  it('keeps multiple-choice answers as deduplicated string arrays', () => {
    const multiple = questionnaireNode.questions[1];
    const state = sanitizePlayerState(questionnairePackage.presentation, {
      pages: {
        'page:intro.mdx': {
          answers: { [multiple.id]: ['beta', 'alpha', 'beta'] },
        },
      },
    });
    expect(state.pages['page:intro.mdx']?.answers).toEqual({
      [multiple.id]: ['beta', 'alpha'],
    });
  });

  it('keeps only reachable submitted questionnaire ids', () => {
    const state = sanitizePlayerState(questionnairePackage.presentation, {
      pages: {
        'page:intro.mdx': {
          submittedQuestionnaires: [
            questionnaireNode.id,
            'questionnaire:missing',
          ],
        },
      },
    });
    expect(state.pages['page:intro.mdx']?.submittedQuestionnaires).toEqual([
      questionnaireNode.id,
    ]);
  });

  it('scopes a reused question id to each page independently', () => {
    const shared: ContentPackage = {
      metadata: { title: 'Shared question' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'page:a.mdx',
            source: 'a.mdx',
            metadata: { title: 'A' },
            content: [questionnaireNode],
          },
          {
            type: 'page',
            id: 'page:b.mdx',
            source: 'b.mdx',
            metadata: { title: 'B' },
            content: [questionnaireNode],
          },
        ],
      },
    };
    const questionId = questionnaireNode.questions[0].id;

    const state = sanitizePlayerState(shared.presentation, {
      pages: {
        'page:a.mdx': { answers: { [questionId]: 'first' } },
        'page:b.mdx': { answers: { [questionId]: 'second' } },
      },
    });

    // The same stable id resolves against the page that owns it.
    expect(state.pages['page:a.mdx']?.answers).toEqual({
      [questionId]: 'first',
    });
    expect(state.pages['page:b.mdx']?.answers).toEqual({
      [questionId]: 'second',
    });
  });

  it('never mutates the raw persisted object', () => {
    const raw = {
      pages: { 'page:intro.mdx': { visited: true } },
    };
    const state = sanitizePlayerState(questionnairePackage.presentation, raw);
    state.pages['page:intro.mdx']!.visited = false;
    expect(raw.pages['page:intro.mdx'].visited).toBe(true);
  });
});

describe('player state updates', () => {
  it('preserves referential identity when a page update changes nothing', () => {
    const state: PlayerState = { pages: {} };
    expect(updatePageState(state, 'page:a', (page) => page)).toBe(state);
  });

  it('replaces only the targeted page', () => {
    const state: PlayerState = {
      pages: { 'page:a': { visited: true }, 'page:b': { visited: true } },
    };
    const next = updatePageState(state, 'page:a', (page) => ({
      ...page,
      completed: true,
    }));
    expect(next).not.toBe(state);
    expect(next.pages['page:a']).toEqual({ visited: true, completed: true });
    expect(next.pages['page:b']).toBe(state.pages['page:b']);
  });

  it('preserves identity when the location is unchanged', () => {
    const state: PlayerState = { location: 'page:a', pages: {} };
    expect(withLocation(state, 'page:a')).toBe(state);
    expect(withLocation(state, 'page:b')).toEqual({
      location: 'page:b',
      pages: {},
    });
  });

  it('compares string and array answers', () => {
    expect(sameAnswer('a', 'a')).toBe(true);
    expect(sameAnswer('a', 'b')).toBe(false);
    expect(sameAnswer(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameAnswer(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameAnswer(['a'], 'a')).toBe(false);
  });

  it('starts empty', () => {
    expect(emptyPlayerState()).toEqual({ pages: {} });
  });
});
