import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackageApp } from '../../app/App';
import { PackageView } from '../../app/components/PackageView';
import type { ContentPackage } from '../../app/types';
import {
  gridPackage,
  headingDepths,
  makeEmptyGridPackage,
  makeEmptyPackage,
  scrollPackage,
} from './fixtures';

const headingScrollPackage: ContentPackage = {
  metadata: { title: 'Headings' },
  presentation: {
    type: 'scroll',
    pages: [
      {
        type: 'page',
        id: 'page:headings.mdx',
        source: 'headings.mdx',
        metadata: { title: 'Headings' },
        content: headingDepths,
      },
    ],
  },
};

function renderView(contentPackage: ContentPackage) {
  return renderToStaticMarkup(<PackageView contentPackage={contentPackage} />);
}

describe('PackageView scroll presentation', () => {
  it('renders only the first page', () => {
    const html = renderView(scrollPackage);
    expect(html).toContain('Introduction');
    expect(html).toContain('Welcome');
    expect(html).not.toContain('Setting things up');
    expect(html).not.toContain('Setup instructions.');
  });

  it('does not render a package header, navigation shell or skip link', () => {
    const html = renderView(scrollPackage);
    expect(html).not.toContain('Rendering Fundamentals');
    expect(html).not.toContain('Package navigation');
    expect(html).not.toContain('Skip to content');
    expect(html).not.toContain('Item 1 of');
  });

  it('renders authored Markdown depths 1-6 as matching h1-h6', () => {
    const html = renderView(headingScrollPackage);
    for (let level = 1; level <= 6; level += 1) {
      expect(html).toContain(`<h${level}`);
      expect(html).toContain(`Level ${level}`);
    }
  });

  it('renders the current page as a full-height scene without paging controls', () => {
    const html = renderView(scrollPackage);
    // The displayed page fills the viewport; no adjacent page peeks in.
    expect(html).toContain('min-h-dvh');
    expect(html).not.toContain('snap-proximity');
    expect(html).not.toContain('snap-start');
    // The package never exposes scroll paging controls; the questionnaire's
    // own wizard controls are unrelated and may be present.
    expect(html).not.toContain('Previous page');
    expect(html).not.toContain('Continue to next page');
  });

  it('shows an empty state when a scroll package has no pages', () => {
    const html = renderView(makeEmptyPackage());
    expect(html).toContain('does not contain any content');
  });
});

describe('PackageView grid presentation', () => {
  it('renders item cards using the authored titles', () => {
    const html = renderView(gridPackage);
    expect(html).toContain('Functions');
    expect(html).toContain('Types');
    expect(html).toContain('Extra details');
  });

  it('does not render item content inline', () => {
    const html = renderView(gridPackage);
    expect(html).not.toContain('Function body.');
    expect(html).not.toContain('Modal body content.');
  });

  it('carries the authored column count into the responsive grid', () => {
    const html = renderView(gridPackage);
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('--grid-columns:2');
  });

  it('does not open a dialog until a card is selected', () => {
    const html = renderView(gridPackage);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('data-slot="dialog-content"');
  });

  it('shows an empty state when a grid package has no items', () => {
    const html = renderView(makeEmptyGridPackage());
    expect(html).toContain('does not contain any content');
  });
});

describe('PackageView shared', () => {
  it('does not render any progress or completion UI', () => {
    const scrollHtml = renderView(scrollPackage);
    const gridHtml = renderView(gridPackage);
    for (const html of [scrollHtml, gridHtml]) {
      expect(html).not.toContain('role="progressbar"');
      expect(html).not.toContain('items visited');
      expect(html).not.toContain('Package complete');
      expect(html).not.toContain('Completed');
    }
  });
});

describe('PackageApp', () => {
  it('renders the authored scroll view for the provided content package', () => {
    const html = renderToStaticMarkup(
      <PackageApp contentPackage={scrollPackage} />,
    );
    expect(html).toContain('Introduction');
  });

  it('renders the authored grid view for the provided content package', () => {
    const html = renderToStaticMarkup(
      <PackageApp contentPackage={gridPackage} />,
    );
    expect(html).toContain('Functions');
  });
});
