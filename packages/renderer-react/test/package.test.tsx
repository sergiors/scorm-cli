import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageApp } from '../app/App';
import { CompletionNotice } from '../app/components/CompletionNotice';
import { PackageView } from '../app/components/PackageView';
import type { ContentPackage } from '../app/types';
import { makeEmptyPackage, samplePackage } from './fixtures';

function renderView(contentPackage: ContentPackage = samplePackage) {
  return renderToStaticMarkup(<PackageView contentPackage={contentPackage} />);
}

const sequencePackage: ContentPackage = {
  metadata: { title: 'Sequence only' },
  children: [
    {
      type: 'section',
      id: 'walkthrough',
      title: 'Walkthrough',
      presentation: { layout: 'sequence' },
      children: [
        {
          type: 'item',
          id: 'step-one',
          source: 'step-one.mdx',
          presentation: { open: 'page' },
          metadata: { title: 'Step one' },
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'First step.' }],
            },
          ],
        },
        {
          type: 'item',
          id: 'step-two',
          source: 'step-two.mdx',
          presentation: { open: 'page' },
          metadata: { title: 'Step two' },
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'Second step.' }],
            },
          ],
        },
      ],
    },
  ],
};

describe('PackageView', () => {
  it('renders the package title and description', () => {
    const html = renderView();
    expect(html).toContain('Rendering Fundamentals');
    expect(html).toContain('A short package used by the renderer test suite.');
  });

  it('renders both navigation landmarks without a router', () => {
    const html = renderView();
    const matches = html.match(/aria-label="Package navigation"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('Skip to content');
  });

  it('renders section titles following their presentation', () => {
    const html = renderView();
    expect(html).toContain('Getting started');
    expect(html).toContain('Media');
    expect(html).toContain('Walkthrough');
    // list section stays a vertical flex column
    expect(html).toContain('flex-col');
    // grid section with 2 columns is exposed via a responsive card grid
    expect(html).toContain('grid-cols-2');
  });

  it('renders grid thumbnails for items that provide one', () => {
    const html = renderView();
    expect(html).toContain('src="./assets/setup.svg"');
  });

  it('shows the first item as current and its content', () => {
    const html = renderView();
    expect(html).toContain('Item 1 of 5');
    expect(html).toContain('Introduction');
    expect(html).toContain('Welcome');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Current item');
  });

  it('does not open a modal until a modal item is selected', () => {
    const html = renderView();
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('Modal body content.');
  });

  it('does not render package progress UI and disables previous on the first item', () => {
    const html = renderView();
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('items visited');
    const previousButton = html.slice(html.indexOf('Previous'));
    expect(previousButton).toContain('disabled');
  });

  it('does not show the completion notice before finishing', () => {
    const html = renderView();
    expect(html).not.toContain('Package complete');
    expect(html).not.toContain('Completed');
  });

  it('opens a sequence package on its first item without a group presentation', () => {
    const html = renderView(sequencePackage);
    expect(html).toContain('Item 1 of 2');
    expect(html).toContain('Step one');
    expect(html).toContain('Step two');
    // Sequence sections use a compact ordered reference, not list/grid cards.
    expect(html).toContain('<ol');
    expect(html).not.toContain('<img');
  });

  it('shows an empty state when the package has no items', () => {
    const html = renderView(makeEmptyPackage());
    expect(html).toContain('does not contain any items');
  });
});

describe('CompletionNotice', () => {
  it('renders nothing when incomplete', () => {
    expect(renderToStaticMarkup(<CompletionNotice complete={false} />)).toBe(
      '',
    );
  });

  it('renders an accessible completion status', () => {
    const html = renderToStaticMarkup(<CompletionNotice complete />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Package complete');
  });
});

describe('PackageApp', () => {
  it('renders the view for the provided content package', () => {
    const html = renderToStaticMarkup(
      <PackageApp contentPackage={samplePackage} />,
    );
    expect(html).toContain('Rendering Fundamentals');
  });
});
