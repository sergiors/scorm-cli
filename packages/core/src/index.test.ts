import { describe, expect, it } from 'vitest';
import {
  collectAssetReferences,
  isPackageComplete,
  type ContentPackage,
} from './index';

const contentPackage: ContentPackage = {
  metadata: { title: 'Package' },
  children: [
    {
      type: 'item',
      id: 'a',
      source: 'a.mdx',
      presentation: { open: 'page' },
      metadata: { title: 'A', thumbnail: 'images/a.png' },
      content: [
        { type: 'image', src: 'images/z.png', alt: 'Z' },
        { type: 'video', src: 'https://example.test/v.mp4' },
      ],
    },
    {
      type: 'section',
      id: 'section:1',
      presentation: { layout: 'grid', columns: 2 },
      children: [
        {
          type: 'item',
          id: 'b',
          source: 'b.mdx',
          presentation: { open: 'modal' },
          metadata: { title: 'B' },
          content: [],
        },
      ],
    },
  ],
};

describe('core package helpers', () => {
  it('defines completion as all items visited', () => {
    expect(isPackageComplete(contentPackage, ['a'])).toBe(false);
    expect(isPackageComplete(contentPackage, ['a', 'b'])).toBe(true);
    expect(
      isPackageComplete({ metadata: { title: 'Empty' }, children: [] }, []),
    ).toBe(false);
  });

  it('collects sorted unique local asset references', () => {
    expect(collectAssetReferences(contentPackage)).toEqual([
      'images/a.png',
      'images/z.png',
    ]);
  });

  it('collects local media references recursively throughout the content AST', () => {
    const nested: ContentPackage = {
      metadata: { title: 'Nested' },
      children: [
        {
          type: 'item',
          id: 'nested',
          source: 'nested.mdx',
          presentation: { open: 'page' },
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
                        { type: 'image', src: 'inline/list.svg', alt: 'list' },
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
              type: 'callout',
              variant: 'info',
              children: [
                { type: 'image', src: 'inline/callout.svg', alt: 'callout' },
              ],
            },
            {
              type: 'example',
              children: [
                { type: 'image', src: 'inline/example.svg', alt: 'example' },
              ],
            },
            {
              type: 'question',
              questionType: 'single-choice',
              prompt: [
                { type: 'image', src: 'inline/prompt.svg', alt: 'prompt' },
              ],
              options: [
                {
                  value: 'local',
                  correct: true,
                  content: [
                    { type: 'image', src: 'inline/option.svg', alt: 'option' },
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
            {
              type: 'steps',
              steps: [
                {
                  children: [
                    {
                      type: 'video',
                      src: 'media/step.mp4',
                      poster: 'media/poster.svg',
                      captions: 'media/captions.vtt',
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
    };
    expect(collectAssetReferences(nested)).toEqual([
      'inline/callout.svg',
      'inline/example.svg',
      'inline/heading.svg',
      'inline/list.svg',
      'inline/option.svg',
      'inline/prompt.svg',
      'inline/quote.svg',
      'inline/remote-poster.svg',
      'media/captions.vtt',
      'media/lesson-captions.vtt',
      'media/lesson-poster.svg',
      'media/lesson.mp4',
      'media/poster.svg',
      'media/step.mp4',
    ]);
  });
});
