import { describe, expect, it } from 'vitest';
import {
  collectAssetReferences,
  getPackageProgress,
  isPackageComplete,
  type ContentPackage,
} from '../index';

const contentPackage: ContentPackage = {
  metadata: { title: 'Package' },
  presentation: {
    type: 'grid',
    columns: 2,
    items: [
      {
        type: 'item',
        id: 'a',
        source: 'a.mdx',
        metadata: { title: 'A' },
        content: [
          { type: 'image', src: 'images/z.png', alt: 'Z' },
          { type: 'video', src: 'https://example.test/v.mp4' },
        ],
      },
      {
        type: 'item',
        id: 'b',
        source: 'b.mdx',
        metadata: { title: 'B' },
        content: [],
      },
    ],
  },
};

describe('core package helpers', () => {
  it('defines completion as all items visited', () => {
    expect(isPackageComplete(contentPackage, ['a'])).toBe(false);
    expect(isPackageComplete(contentPackage, ['a', 'b'])).toBe(true);
    expect(
      isPackageComplete(
        {
          metadata: { title: 'Empty' },
          presentation: { type: 'scroll', pages: [] },
        },
        [],
      ),
    ).toBe(false);
    expect(
      isPackageComplete(
        {
          metadata: { title: 'Scroll' },
          presentation: {
            type: 'scroll',
            pages: [
              {
                type: 'page',
                id: 'page:a',
                source: 'a.mdx',
                metadata: { title: 'A' },
                content: [],
              },
            ],
          },
        },
        ['page:a'],
      ),
    ).toBe(true);
  });

  it('collects sorted unique local asset references', () => {
    expect(collectAssetReferences(contentPackage)).toEqual(['images/z.png']);
  });

  it('calculates integer progress from completed scroll pages and visited grid items', () => {
    expect(
      getPackageProgress(contentPackage, { pages: { a: { visited: true } } }),
    ).toBe(50);
    const scroll: ContentPackage = {
      metadata: { title: 'Scroll' },
      presentation: {
        type: 'scroll',
        pages: ['one', 'two', 'three'].map((id) => ({
          type: 'page',
          id,
          source: id,
          metadata: { title: id },
          content: [],
        })),
      },
    };
    expect(
      getPackageProgress(scroll, { pages: { one: { completed: true } } }),
    ).toBe(33);
    expect(
      getPackageProgress(scroll, { pages: { one: { visited: true } } }),
    ).toBe(0);
  });

  it('collects assets from tight list inline runs and their sibling blocks', () => {
    const tight: ContentPackage = {
      metadata: { title: 'Tight' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'tight',
            source: 'tight.mdx',
            metadata: { title: 'Tight' },
            content: [
              {
                type: 'list',
                ordered: false,
                spread: false,
                items: [
                  {
                    children: [
                      {
                        type: 'inlineContent',
                        children: [
                          { type: 'text', value: 'See ' },
                          {
                            type: 'image',
                            src: 'inline/tight.svg',
                            alt: 'tight',
                          },
                        ],
                      },
                      { type: 'image', src: 'block/tight.svg', alt: 'block' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(collectAssetReferences(tight)).toEqual([
      'block/tight.svg',
      'inline/tight.svg',
    ]);
  });

  it('collects local media references recursively throughout the content AST', () => {
    const nested: ContentPackage = {
      metadata: { title: 'Nested' },
      presentation: {
        type: 'scroll',
        pages: [
          {
            type: 'page',
            id: 'nested',
            source: 'nested.mdx',
            metadata: { title: 'Nested' },
            content: [
              {
                type: 'heading',
                depth: 2,
                children: [
                  { type: 'text', value: 'See ' },
                  {
                    type: 'link',
                    href: 'https://example.test',
                    children: [
                      {
                        type: 'emphasis',
                        children: [
                          {
                            type: 'strong',
                            children: [
                              {
                                type: 'image',
                                src: 'inline/heading.svg',
                                alt: 'heading',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    children: [
                      {
                        type: 'paragraph',
                        children: [
                          {
                            type: 'image',
                            src: 'inline/list.svg',
                            alt: 'list',
                          },
                        ],
                      },
                      {
                        type: 'quote',
                        children: [
                          {
                            type: 'paragraph',
                            children: [
                              {
                                type: 'image',
                                src: 'inline/quote.svg',
                                alt: 'quote',
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'quote',
                children: [
                  {
                    type: 'image',
                    src: 'inline/quote-nested.svg',
                    alt: 'quote',
                  },
                ],
              },
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    children: [
                      {
                        type: 'image',
                        src: 'inline/list-nested.svg',
                        alt: 'list',
                      },
                    ],
                  },
                ],
              },
              {
                type: 'questionnaire',
                id: 'questionnaire:nested.mdx:1:1',
                questions: [
                  {
                    type: 'question',
                    id: 'question:nested.mdx:2:1',
                    questionType: 'single-choice',
                    prompt: [
                      {
                        type: 'image',
                        src: 'inline/prompt.svg',
                        alt: 'prompt',
                      },
                    ],
                    options: [
                      {
                        value: 'local',
                        correct: true,
                        content: [
                          {
                            type: 'image',
                            src: 'inline/option.svg',
                            alt: 'option',
                          },
                        ],
                      },
                      {
                        value: 'remote',
                        correct: false,
                        content: [
                          {
                            type: 'video',
                            src: 'https://example.test/remote.mp4',
                            poster: 'inline/remote-poster.svg',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                type: 'video',
                src: 'media/lesson.mp4',
                poster: 'media/lesson-poster.svg',
                captions: 'media/lesson-captions.vtt',
              },
            ],
          },
        ],
      },
    };
    expect(collectAssetReferences(nested)).toEqual([
      'inline/heading.svg',
      'inline/list-nested.svg',
      'inline/list.svg',
      'inline/option.svg',
      'inline/prompt.svg',
      'inline/quote-nested.svg',
      'inline/quote.svg',
      'inline/remote-poster.svg',
      'media/lesson-captions.vtt',
      'media/lesson-poster.svg',
      'media/lesson.mp4',
    ]);
  });
});
