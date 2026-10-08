import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewErrorOverlay } from '../../app/components/PreviewErrorOverlay';

describe('PreviewErrorOverlay', () => {
  it('renders an accessible alert with the author-facing message', () => {
    const html = renderToStaticMarkup(
      <PreviewErrorOverlay message='Broken content at lessons/intro.mdx:3' />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Content error');
    expect(html).toContain('Broken content at lessons/intro.mdx:3');
    expect(html).toContain('Fix the content and save');
  });
});
