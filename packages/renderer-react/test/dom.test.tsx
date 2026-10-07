// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoursePlayer } from '../app/components/CoursePlayer';
import { sampleCourse } from './fixtures';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.courseRuntime;
  vi.restoreAllMocks();
});

function text(): string {
  return container.textContent ?? '';
}

function findButton(prefix: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((node) =>
    node.textContent?.trim().startsWith(prefix),
  );
  if (!button) {
    throw new Error(`Button not found: ${prefix}`);
  }
  return button;
}

describe('CoursePlayer interactions', () => {
  it('navigates with next/previous without rendering progress UI', () => {
    act(() => root.render(<CoursePlayer course={sampleCourse} />));
    expect(text()).toContain('Item 1 of 3');
    expect(text()).toContain('Introduction');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text()).not.toContain('items visited');

    act(() => findButton('Next').click());
    expect(text()).toContain('Item 2 of 3');
    expect(text()).toContain('Setting things up');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();

    act(() => findButton('Previous').click());
    expect(text()).toContain('Item 1 of 3');
  });

  it('disables previous on the first item', () => {
    act(() => root.render(<CoursePlayer course={sampleCourse} />));
    expect(findButton('Previous').disabled).toBe(true);
    expect(findButton('Next').disabled).toBe(false);
  });

  it('selects an item from the navigation', () => {
    act(() => root.render(<CoursePlayer course={sampleCourse} />));
    const navButton = Array.from(container.querySelectorAll('button')).find(
      (node) => node.textContent?.includes('Wrap up'),
    );
    expect(navButton).toBeDefined();
    act(() => navButton?.click());
    expect(text()).toContain('Item 3 of 3');
    expect(text()).toContain('Wrap up');
  });

  it('completes once every item is visited and notifies the runtime once', () => {
    const markCompleted = vi.fn();
    const finish = vi.fn();
    window.courseRuntime = { markCompleted, finish };

    act(() => root.render(<CoursePlayer course={sampleCourse} />));
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());

    expect(text()).toContain('Item 3 of 3');
    expect(text()).toContain('Course complete');
    expect(markCompleted).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('works without any runtime bridge', () => {
    expect(window.courseRuntime).toBeUndefined();
    act(() => root.render(<CoursePlayer course={sampleCourse} />));
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());
    expect(text()).toContain('Course complete');
  });
});
