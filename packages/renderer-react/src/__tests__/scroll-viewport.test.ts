import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(
  new URL('../../app/styles.css', import.meta.url),
);

describe('scroll viewport stylesheet', () => {
  it('lets the document grow and scroll instead of pinning the viewport', async () => {
    const css = await readFile(stylesPath, 'utf-8');

    // The player scrolls the document, so `html`, `body` and the React root
    // grow with their content rather than being pinned to the viewport height.
    const rootRule =
      css.match(/html,\s*body,\s*#root\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rootRule).toMatch(/min-height:\s*100%/);
    // A fixed `height` (without the `min-` prefix) would clip the document and
    // reintroduce an inner scroller.
    expect(rootRule).not.toMatch(/(?<!min-)height:\s*100%/);

    // The body keeps no default margin and never hides its own overflow, so the
    // document is the single scroll container.
    const bodyRule = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bodyRule).toMatch(/margin:\s*0/);
    expect(bodyRule).not.toMatch(/overflow:\s*hidden/);
  });
});
