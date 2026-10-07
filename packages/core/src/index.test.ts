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
});
