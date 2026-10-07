// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageView } from '../app/components/PackageView';
import type { ContentPackage } from '../app/types';
import { samplePackage } from './fixtures';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const modalPackage: ContentPackage = {
  metadata: { title: 'Modal package' },
  children: [
    {
      type: 'section',
      id: 'group',
      title: 'Group',
      presentation: { layout: 'grid', columns: 2 },
      children: [
        {
          type: 'item',
          id: 'intro',
          source: 'intro.mdx',
          presentation: { open: 'page' },
          metadata: { title: 'Intro' },
          content: [{ type: 'paragraph', text: 'Intro body.' }],
        },
        {
          type: 'item',
          id: 'details',
          source: 'details.mdx',
          presentation: { open: 'modal' },
          metadata: { title: 'Details' },
          content: [{ type: 'paragraph', text: 'Modal body content.' }],
        },
      ],
    },
  ],
};

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
  delete window.scormBridge;
  vi.restoreAllMocks();
});

function text(): string {
  return container.textContent ?? '';
}

function documentText(): string {
  return document.body.textContent ?? '';
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

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

describe('PackageView interactions', () => {
  it('navigates with next/previous without rendering progress UI', () => {
    act(() => root.render(<PackageView contentPackage={samplePackage} />));
    expect(text()).toContain('Item 1 of 5');
    expect(text()).toContain('Introduction');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text()).not.toContain('items visited');

    act(() => findButton('Next').click());
    expect(text()).toContain('Item 2 of 5');
    expect(text()).toContain('Setting things up');
    expect(container.querySelector('[role="progressbar"]')).toBeNull();

    act(() => findButton('Previous').click());
    expect(text()).toContain('Item 1 of 5');
  });

  it('disables previous on the first item', () => {
    act(() => root.render(<PackageView contentPackage={samplePackage} />));
    expect(findButton('Previous').disabled).toBe(true);
    expect(findButton('Next').disabled).toBe(false);
  });

  it('selects a page item from the navigation', () => {
    act(() => root.render(<PackageView contentPackage={samplePackage} />));
    act(() => findButton('Step two').click());
    expect(text()).toContain('Item 5 of 5');
    expect(text()).toContain('Second step.');
  });

  it('opens a modal item from a grid card without switching the primary item', () => {
    act(() => root.render(<PackageView contentPackage={samplePackage} />));

    act(() => findButton('Extra details').click());

    expect(dialog()).not.toBeNull();
    expect(documentText()).toContain('Modal body content.');
    // The underlying primary item is untouched.
    expect(text()).toContain('Item 1 of 5');
    expect(text()).toContain('Introduction');
  });

  it('closes the modal and returns to the underlying item', () => {
    act(() => root.render(<PackageView contentPackage={samplePackage} />));
    act(() => findButton('Extra details').click());
    expect(dialog()).not.toBeNull();

    const close = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close dialog"]',
    );
    expect(close).not.toBeNull();
    act(() => close?.click());

    expect(dialog()).toBeNull();
    expect(text()).toContain('Item 1 of 5');
  });

  it('closes the modal on Escape', () => {
    act(() => root.render(<PackageView contentPackage={samplePackage} />));
    act(() => findButton('Extra details').click());
    expect(dialog()).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(dialog()).toBeNull();
  });

  it('records a modal item as visited so completion stays correct', () => {
    const markCompleted = vi.fn();
    window.scormBridge = { markCompleted };

    act(() => root.render(<PackageView contentPackage={modalPackage} />));
    expect(text()).not.toContain('Package complete');

    act(() => findButton('Details').click());

    expect(dialog()).not.toBeNull();
    expect(text()).toContain('Package complete');
    expect(markCompleted).toHaveBeenCalledTimes(1);
  });

  it('completes once every item is visited and notifies the bridge once', () => {
    const markCompleted = vi.fn();
    const finish = vi.fn();
    window.scormBridge = { markCompleted, finish };

    act(() => root.render(<PackageView contentPackage={samplePackage} />));
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());

    expect(text()).toContain('Item 5 of 5');
    expect(text()).toContain('Package complete');
    expect(markCompleted).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('works without any SCORM bridge', () => {
    expect(window.scormBridge).toBeUndefined();
    act(() => root.render(<PackageView contentPackage={samplePackage} />));
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());
    act(() => findButton('Next').click());
    expect(text()).toContain('Package complete');
  });
});
