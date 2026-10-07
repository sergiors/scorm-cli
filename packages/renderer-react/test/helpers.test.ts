import { describe, expect, it } from 'vitest';
import {
  addVisited,
  getAdjacentItems,
  getCourseItems,
  getCourseSections,
  isCourseComplete,
} from '../app/lib/course-helpers';
import { makeEmptyCourse, sampleCourse } from './fixtures';

describe('getCourseItems', () => {
  it('flattens items in document order', () => {
    expect(getCourseItems(sampleCourse).map((item) => item.id)).toEqual([
      'intro',
      'setup',
      'wrap-up',
    ]);
  });

  it('returns an empty list for an empty course', () => {
    expect(getCourseItems(makeEmptyCourse())).toEqual([]);
  });
});

describe('getCourseSections', () => {
  it('returns only top-level sections', () => {
    expect(
      getCourseSections(sampleCourse).map((section) => section.id),
    ).toEqual(['getting-started', 'media']);
  });
});

describe('isCourseComplete', () => {
  it('is false until every item has been visited', () => {
    expect(isCourseComplete(sampleCourse, ['intro', 'setup'])).toBe(false);
  });

  it('is true once every item has been visited', () => {
    expect(isCourseComplete(sampleCourse, ['intro', 'setup', 'wrap-up'])).toBe(
      true,
    );
  });

  it('is false for an empty course', () => {
    expect(isCourseComplete(makeEmptyCourse(), [])).toBe(false);
  });
});

describe('getAdjacentItems', () => {
  const items = getCourseItems(sampleCourse);

  it('resolves current, previous and next', () => {
    const adjacent = getAdjacentItems(items, 'setup');
    expect(adjacent.index).toBe(1);
    expect(adjacent.previous?.id).toBe('intro');
    expect(adjacent.next?.id).toBe('wrap-up');
  });

  it('has no previous for the first item', () => {
    const adjacent = getAdjacentItems(items, 'intro');
    expect(adjacent.previous).toBeUndefined();
    expect(adjacent.next?.id).toBe('setup');
  });

  it('has no next for the last item', () => {
    const adjacent = getAdjacentItems(items, 'wrap-up');
    expect(adjacent.previous?.id).toBe('setup');
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
