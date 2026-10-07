import { describe, expect, it } from 'vitest';
import {
  addVisited,
  findItem,
  getAdjacentItems,
  getPackageItems,
  getPackageSections,
  isPackageComplete,
} from '../app/lib/content-helpers';
import { makeEmptyPackage, samplePackage } from './fixtures';

describe('getPackageItems', () => {
  it('flattens items in document order', () => {
    expect(getPackageItems(samplePackage).map((item) => item.id)).toEqual([
      'intro',
      'setup',
      'details',
      'step-one',
      'step-two',
    ]);
  });

  it('returns an empty list for an empty package', () => {
    expect(getPackageItems(makeEmptyPackage())).toEqual([]);
  });
});

describe('getPackageSections', () => {
  it('returns only top-level sections', () => {
    expect(
      getPackageSections(samplePackage).map((section) => section.id),
    ).toEqual(['getting-started', 'media', 'walkthrough']);
  });
});

describe('findItem', () => {
  it('resolves an item by id and returns undefined otherwise', () => {
    const items = getPackageItems(samplePackage);
    expect(findItem(items, 'details')?.id).toBe('details');
    expect(findItem(items, 'missing')).toBeUndefined();
    expect(findItem(items, undefined)).toBeUndefined();
  });
});

describe('isPackageComplete', () => {
  it('is false until every item has been visited', () => {
    expect(isPackageComplete(samplePackage, ['intro', 'setup'])).toBe(false);
  });

  it('is true once every item has been visited', () => {
    expect(
      isPackageComplete(samplePackage, [
        'intro',
        'setup',
        'details',
        'step-one',
        'step-two',
      ]),
    ).toBe(true);
  });

  it('is false for an empty package', () => {
    expect(isPackageComplete(makeEmptyPackage(), [])).toBe(false);
  });
});

describe('getAdjacentItems', () => {
  const items = getPackageItems(samplePackage);

  it('resolves current, previous and next', () => {
    const adjacent = getAdjacentItems(items, 'details');
    expect(adjacent.index).toBe(2);
    expect(adjacent.previous?.id).toBe('setup');
    expect(adjacent.next?.id).toBe('step-one');
  });

  it('has no previous for the first item', () => {
    const adjacent = getAdjacentItems(items, 'intro');
    expect(adjacent.previous).toBeUndefined();
    expect(adjacent.next?.id).toBe('setup');
  });

  it('has no next for the last item', () => {
    const adjacent = getAdjacentItems(items, 'step-two');
    expect(adjacent.previous?.id).toBe('step-one');
    expect(adjacent.next).toBeUndefined();
  });

  it('returns -1 when the current id is unknown', () => {
    const adjacent = getAdjacentItems(items, 'missing');
    expect(adjacent.index).toBe(-1);
    expect(adjacent.previous).toBeUndefined();
    expect(adjacent.next).toBeUndefined();
  });
});

describe('addVisited', () => {
  it('adds an id and preserves identity for duplicates', () => {
    const initial = new Set(['intro']);
    const added = addVisited(initial, 'setup');
    expect([...added]).toEqual(['intro', 'setup']);

    const again = addVisited(added, 'setup');
    expect(again).toBe(added);
  });
});
