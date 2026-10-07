import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseApp } from '../app/App';
import { CompletionNotice } from '../app/components/CompletionNotice';
import { CoursePlayer } from '../app/components/CoursePlayer';
import { makeEmptyCourse, sampleCourse } from './fixtures';

function renderPlayer() {
  return renderToStaticMarkup(<CoursePlayer course={sampleCourse} />);
}

describe('CoursePlayer', () => {
  it('renders the course title and description', () => {
    const html = renderPlayer();
    expect(html).toContain('Rendering Fundamentals');
    expect(html).toContain('A short course used by the renderer test suite.');
  });

  it('renders both navigation landmarks without a router', () => {
    const html = renderPlayer();
    const matches = html.match(/aria-label="Course navigation"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('Skip to content');
  });

  it('renders section titles following their presentation', () => {
    const html = renderPlayer();
    expect(html).toContain('Getting started');
    expect(html).toContain('Media');
    // list section stays a vertical flex column
    expect(html).toContain('flex-col');
    // grid section with 2 columns is exposed via a semantic list
    expect(html).toContain('grid-cols-2');
  });

  it('renders grid thumbnails for items that provide one', () => {
    const html = renderPlayer();
    expect(html).toContain('src="./assets/setup.svg"');
  });

  it('shows the first item as current and its content', () => {
    const html = renderPlayer();
    expect(html).toContain('Item 1 of 3');
    expect(html).toContain('Introduction');
    expect(html).toContain('Welcome');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Current item');
  });

  it('does not render course progress UI and disables previous on the first item', () => {
    const html = renderPlayer();
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('items visited');
    const previousButton = html.slice(html.indexOf('Previous'));
    expect(previousButton).toContain('disabled');
  });

  it('does not show the completion notice before finishing', () => {
    const html = renderPlayer();
    expect(html).not.toContain('Course complete');
    expect(html).not.toContain('Completed');
  });

  it('shows an empty state when the course has no items', () => {
    const html = renderToStaticMarkup(
      <CoursePlayer course={makeEmptyCourse()} />,
    );
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
    expect(html).toContain('Course complete');
  });
});

describe('CourseApp', () => {
  it('renders the player for the provided course', () => {
    const html = renderToStaticMarkup(<CourseApp course={sampleCourse} />);
    expect(html).toContain('Rendering Fundamentals');
  });
});
