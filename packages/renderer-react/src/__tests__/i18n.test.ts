import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'vite';
import type { ContentPackage } from '@scorm-cli/core';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  documentLanguage,
  normalizeLanguageTag,
  resolveLanguage,
  resolveLocale,
} from '../../app/lib/i18n';
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

describe('normalizeLanguageTag', () => {
  it('canonicalizes valid BCP-47 tags', () => {
    expect(normalizeLanguageTag('en')).toBe('en');
    expect(normalizeLanguageTag('pt-br')).toBe('pt-BR');
    expect(normalizeLanguageTag(' pt-BR ')).toBe('pt-BR');
    expect(normalizeLanguageTag('EN-us')).toBe('en-US');
  });

  it('rejects absent, empty and invalid tags', () => {
    expect(normalizeLanguageTag(undefined)).toBeUndefined();
    expect(normalizeLanguageTag(null)).toBeUndefined();
    expect(normalizeLanguageTag('')).toBeUndefined();
    expect(normalizeLanguageTag('   ')).toBeUndefined();
    expect(normalizeLanguageTag('not_a_tag')).toBeUndefined();
  });
});

describe('resolveLanguage', () => {
  it('maps every English tag to English', () => {
    for (const lang of ['en', 'en-US', 'en-GB', 'EN']) {
      const resolved = resolveLanguage(lang);
      expect(resolved.locale).toBe('en');
      expect(resolved.supported).toBe(true);
    }
  });

  it('maps every Portuguese tag to Brazilian Portuguese', () => {
    for (const lang of ['pt', 'pt-BR', 'pt-br', 'pt-PT']) {
      const resolved = resolveLanguage(lang);
      expect(resolved.locale).toBe('pt-BR');
      expect(resolved.supported).toBe(true);
    }
  });

  it('falls back to English for unsupported languages', () => {
    const resolved = resolveLanguage('fr');
    expect(resolved).toEqual({
      locale: 'en',
      language: 'fr',
      supported: false,
    });
  });

  it('treats an absent or invalid tag as the default, not a fallback', () => {
    for (const lang of [undefined, null, '', 'not_a_tag']) {
      const resolved = resolveLanguage(lang);
      expect(resolved.locale).toBe(DEFAULT_LOCALE);
      expect(resolved.language).toBeUndefined();
      expect(resolved.supported).toBe(true);
    }
  });

  it('exposes the supported locales', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('pt-BR');
  });
});

describe('documentLanguage', () => {
  it('preserves a normalized declared language, supported or not', () => {
    expect(documentLanguage('pt-br')).toBe('pt-BR');
    expect(documentLanguage('fr')).toBe('fr');
    expect(documentLanguage('en-US')).toBe('en-US');
  });

  it('defaults to English when absent or invalid', () => {
    expect(documentLanguage(undefined)).toBe('en');
    expect(documentLanguage('')).toBe('en');
    expect(documentLanguage('not_a_tag')).toBe('en');
  });

  it('agrees with resolveLocale on the supported tags', () => {
    expect(resolveLocale('pt-PT')).toBe('pt-BR');
    expect(resolveLocale('fr')).toBe('en');
  });
});

describe('package-data HTML transform', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets the document language to the declared normalized tag', () => {
    const plugin = createPackageDataPlugin({
      current: packageWithLang('pt-br'),
    });
    const html = transformIndexHtml(plugin, HTML);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('<title>T</title>');
  });

  it('keeps an unsupported language in the document while the UI falls back', () => {
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

  it('defaults the document language to English when no language is declared', () => {
    const plugin = createPackageDataPlugin({ current: packageWithLang() });
    expect(transformIndexHtml(plugin, HTML)).toContain('<html lang="en">');
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
    expect(added).toContain('<html lang="pt-BR" data-lang="keep">');

    // An existing `lang` is updated without disturbing the look-alike.
    const updated = transformIndexHtml(
      plugin,
      '<!doctype html><html data-lang="keep" lang="en"><head><title>Package</title></head><body></body></html>',
    );
    expect(updated).toContain('data-lang="keep"');
    expect(updated).toContain('<html data-lang="keep" lang="pt-BR">');
  });
});
