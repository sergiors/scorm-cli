import { describe, expect, it } from 'vitest';
import type {
  ContentNode,
  ContentPackage,
  QuestionOption,
} from '@scorm-cli/core';
import { createContentManifest } from '../content-manifest';

const question = (
  id: string,
  prompt: ContentNode[],
  options: QuestionOption[] = [],
) => ({
  type: 'question' as const,
  id,
  questionType: 'single-choice' as const,
  prompt,
  options,
});

describe('content manifest', () => {
  it('deterministically indexes pages, nested questionnaires, questions, and authored options', () => {
    const content: ContentPackage = {
      metadata: { title: 'Course' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'p-a',
            source: 'a.mdx',
            metadata: { title: 'First' },
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Before' }],
              },
              {
                type: 'quote',
                children: [
                  {
                    type: 'list',
                    ordered: false,
                    items: [
                      {
                        children: [
                          {
                            type: 'questionnaire',
                            id: 'quiz-a',
                            questions: [
                              question(
                                'q1',
                                [
                                  {
                                    type: 'paragraph',
                                    children: [
                                      { type: 'text', value: 'Choose ' },
                                      {
                                        type: 'emphasis',
                                        children: [
                                          { type: 'text', value: 'one' },
                                        ],
                                      },
                                    ],
                                  },
                                ],
                                [
                                  {
                                    value: 'a',
                                    correct: true,
                                    content: [
                                      {
                                        type: 'paragraph',
                                        children: [
                                          { type: 'text', value: 'Alpha' },
                                        ],
                                      },
                                    ],
                                  },
                                  {
                                    value: 'b',
                                    correct: false,
                                    content: [
                                      {
                                        type: 'paragraph',
                                        children: [
                                          {
                                            type: 'strong',
                                            children: [
                                              { type: 'text', value: 'Beta' },
                                            ],
                                          },
                                        ],
                                      },
                                    ],
                                  },
                                ],
                              ),
                              question(
                                'q2',
                                [{ type: 'code', value: 'Second prompt' }],
                                [],
                              ),
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'questionnaire',
                id: 'quiz-b',
                questions: [
                  question('q3', [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'Third' }],
                    },
                  ]),
                ],
              },
            ],
          },
          {
            type: 'page',
            id: 'p-b',
            source: 'b.mdx',
            metadata: { title: 'Second' },
            content: [],
          },
        ],
      },
    };
    const first = createContentManifest(content);
    expect(first).toEqual(createContentManifest(content));
    expect(first).toMatchObject({
      schemaVersion: 1,
      title: 'Course',
      presentation: 'scroll',
      pages: {
        '0': {
          id: 'p-a',
          title: 'First',
          questions: {
            '0': {
              id: 'q1',
              prompt: 'Choose one',
              options: {
                '0': { value: 'a', label: 'Alpha' },
                '1': { value: 'b', label: 'Beta' },
              },
            },
            '1': { id: 'q2', prompt: 'Second prompt', options: {} },
            '2': { id: 'q3', prompt: 'Third', options: {} },
          },
        },
        '1': { id: 'p-b', title: 'Second', questions: {} },
      },
    });
    expect(JSON.stringify(first)).not.toMatch(/correct|quiz-a|Before/);
  });

  it('indexes grid items using stable item and question ids', () => {
    const content: ContentPackage = {
      metadata: { title: 'Grid' },
      presentation: {
        type: 'grid',
        items: [
          {
            type: 'item',
            id: 'item-1',
            source: '1',
            metadata: { title: 'One' },
            content: [],
          },
          {
            type: 'item',
            id: 'item-2',
            source: '2',
            metadata: { title: 'Two' },
            content: [
              {
                type: 'questionnaire',
                id: 'quiz',
                questions: [question('stable-question-id', [])],
              },
            ],
          },
        ],
      },
    };
    expect(createContentManifest(content)).toMatchObject({
      presentation: 'grid',
      pages: {
        '0': { id: 'item-1' },
        '1': { id: 'item-2', questions: { '0': { id: 'stable-question-id' } } },
      },
    });
  });
});
