import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewErrorOverlay } from '../../app/components/PreviewErrorOverlay';
import { I18nProvider } from '../../app/lib/use-i18n';

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

  it('localizes its fixed copy under a Portuguese package language', () => {
    const html = renderToStaticMarkup(
      <I18nProvider lang='pt-BR'>
        <PreviewErrorOverlay message='Broken content at lessons/intro.mdx:3' />
      </I18nProvider>,
    );
    expect(html).toContain('Erro de conteúdo');
    expect(html).toContain('Corrija o conteúdo e salve');
    expect(html).not.toContain('Content error');
    // The dev server's diagnostic message is not dictionary copy and passes
    // through verbatim.
    expect(html).toContain('Broken content at lessons/intro.mdx:3');
  });
});
