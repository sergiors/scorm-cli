import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import type { ContentPackage } from '@scorm-cli/core';
import { resolvePlayerLocale } from '../../app/i18n/locale';
import { createPackageDataPlugin } from '../vite-app';

const HTML =
  '<!doctype html><html lang="en"><head><title>Package</title></head><body><div id="root"></div></body></html>';

function packageWithLang(lang?: string): ContentPackage {
  return {
    metadata: lang === undefined ? { title: 'T' } : { title: 'T', lang },
    presentation: { type: 'scroll', pages: [] },
  };
}

function transformIndexHtml(plugin: Plugin, html: string): string {
  const hook = plugin.transformIndexHtml;
  if (typeof hook !== 'function') {
    throw new Error('expected transformIndexHtml to be a function');
  }
  return hook(html, undefined as never) as string;
}

describe('resolvePlayerLocale', () => {
  it('maps every English tag to English', () => {
    for (const lang of ['en', 'en-US', 'en-GB', 'EN']) {
      expect(resolvePlayerLocale(lang)).toBe('en');
    }
  });

  it('maps every Portuguese tag to Brazilian Portuguese', () => {
    for (const lang of ['pt', 'pt-BR', 'pt-br', 'pt-PT', 'PT']) {
      expect(resolvePlayerLocale(lang)).toBe('pt-BR');
    }
  });

  it('matches on the base language after trimming and lowercasing', () => {
    expect(resolvePlayerLocale(' pt-BR ')).toBe('pt-BR');
    expect(resolvePlayerLocale('\tPT-PT\n')).toBe('pt-BR');
  });

  it('falls back to English for unsupported, absent, empty and malformed tags', () => {
    for (const lang of [undefined, null, '', '   ', 'fr', 'not_a_tag']) {
      expect(resolvePlayerLocale(lang)).toBe('en');
    }
  });
});

describe('document language', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the authored tag verbatim, supported or not', () => {
    expect(
      transformIndexHtml(
        createPackageDataPlugin({ current: packageWithLang('pt-br') }),
        HTML,
      ),
    ).toContain('<html lang="pt-br">');
    expect(
      transformIndexHtml(
        createPackageDataPlugin({ current: packageWithLang('en-US') }),
        HTML,
      ),
    ).toContain('<html lang="en-US">');
    expect(
      transformIndexHtml(
        createPackageDataPlugin({ current: packageWithLang('fr') }),
        HTML,
      ),
    ).toContain('<html lang="fr">');
  });

  it('defaults to English when no language is declared', () => {
    const plugin = createPackageDataPlugin({ current: packageWithLang() });
    expect(transformIndexHtml(plugin, HTML)).toContain('<html lang="en">');
  });

  it('escapes the authored tag rather than injecting markup', () => {
    const plugin = createPackageDataPlugin({
      current: packageWithLang('en"><script>alert(1)</script>'),
    });
    const html = transformIndexHtml(plugin, HTML);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('matches the real lang attribute, not look-alikes such as data-lang', () => {
    const plugin = createPackageDataPlugin({
      current: packageWithLang('pt-br'),
    });

    // No `lang` yet: the look-alike must be left untouched while `lang` is added.
    const added = transformIndexHtml(
      plugin,
      '<!doctype html><html data-lang="keep"><head><title>Package</title></head><body></body></html>',
    );
    expect(added).toContain('data-lang="keep"');
    expect(added).toContain('<html lang="pt-br" data-lang="keep">');

    // An existing `lang` is updated without disturbing the look-alike.
    const updated = transformIndexHtml(
      plugin,
      '<!doctype html><html data-lang="keep" lang="en"><head><title>Package</title></head><body></body></html>',
    );
    expect(updated).toContain('data-lang="keep"');
    expect(updated).toContain('<html data-lang="keep" lang="pt-br">');
  });
});

describe('unsupported language warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once for a language with no player dictionary', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = createPackageDataPlugin({ current: packageWithLang('fr') });

    const html = transformIndexHtml(plugin, HTML);
    expect(html).toContain('<html lang="fr">');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /Unsupported content language "fr"/,
    );
  });

  it('warns at most once per unsupported language across transforms', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = createPackageDataPlugin({ current: packageWithLang('fr') });

    transformIndexHtml(plugin, HTML);
    transformIndexHtml(plugin, HTML);
    transformIndexHtml(plugin, HTML);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not warn for absent, English or Portuguese languages', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const lang of [undefined, 'en-US', 'pt-BR']) {
      const plugin = createPackageDataPlugin({
        current: packageWithLang(lang),
      });
      transformIndexHtml(plugin, HTML);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
