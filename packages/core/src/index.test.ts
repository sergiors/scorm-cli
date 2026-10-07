import { describe, expect, it } from 'vitest';
import { collectAssetReferences, isCourseComplete, type Course } from './index';

const course: Course = {
  metadata: { title: 'Course' },
  children: [
    {
      type: 'item',
      id: 'a',
      source: 'a.mdx',
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
          metadata: { title: 'B' },
          content: [],
        },
      ],
    },
  ],
};

describe('core course helpers', () => {
  it('defines completion as all items visited', () => {
    expect(isCourseComplete(course, ['a'])).toBe(false);
    expect(isCourseComplete(course, ['a', 'b'])).toBe(true);
    expect(
      isCourseComplete({ metadata: { title: 'Empty' }, children: [] }, []),
    ).toBe(false);
  });

  it('collects sorted unique local asset references', () => {
    expect(collectAssetReferences(course)).toEqual([
      'images/a.png',
      'images/z.png',
    ]);
  });
});
