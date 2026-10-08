// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackageView } from '../../app/components/PackageView';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '../../app/components/ui/dialog';
import type { ContentPackage } from '../../app/types';
import { I18nProvider } from '../../app/lib/use-i18n';
import { gridPackage } from './fixtures';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const ptGridPackage: ContentPackage = {
  ...gridPackage,
  metadata: { ...gridPackage.metadata, lang: 'pt-BR' },
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
});

function findButton(prefix: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((node) =>
    node.textContent?.trim().startsWith(prefix),
  );
  if (!button) {
    throw new Error(`Button not found: ${prefix}`);
  }
  return button;
}

describe('i18n: grid dialog', () => {
  it('localizes the dialog description and close controls', () => {
    act(() =>
      root.render(
        <I18nProvider lang='pt-BR'>
          <PackageView contentPackage={ptGridPackage} />
        </I18nProvider>,
      ),
    );

    act(() => findButton('Functions').click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // Authored title is interpolated into the localized description...
    expect(document.body.textContent).toContain('Conteúdo de Functions');
    // ...and both the screen-reader close and the authored body are present.
    expect(document.body.textContent).toContain('Fechar');
    expect(document.body.textContent).toContain('Function body.');
  });

  it('localizes the footer fallback close button', () => {
    act(() =>
      root.render(
        <I18nProvider lang='pt-BR'>
          <Dialog open>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Painel</DialogTitle>
              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>
        </I18nProvider>,
      ),
    );

    expect(document.body.textContent).toContain('Fechar');
    // The icon close (screen-reader label) and the footer fallback both render
    // their localized label.
    const closeButtons = Array.from(document.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === 'Fechar',
    );
    expect(closeButtons.length).toBeGreaterThanOrEqual(2);
  });
});
