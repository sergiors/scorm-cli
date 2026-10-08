/**
 * Supported UI locales. The renderer ships a small hand-written dictionary for
 * each (see `use-i18n`); any other authored language falls back to English at
 * runtime without changing the document's declared language.
 */
export type Locale = 'en' | 'pt-BR';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'pt-BR'];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Canonicalizes an authored BCP-47 tag (e.g. `pt-br` -> `pt-BR`). Returns
 * `undefined` for absent, empty or invalid tags so callers can fall back to the
 * default instead of trusting an unparseable value.
 */
export function normalizeLanguageTag(
  lang: string | undefined | null,
): string | undefined {
  if (typeof lang !== 'string') {
    return undefined;
  }
  const value = lang.trim();
  if (value.length === 0) {
    return undefined;
  }
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

/**
 * The value for the document's `lang` attribute: the declared tag normalized to
 * canonical BCP-47, or `en` when absent or invalid. This deliberately preserves
 * an unsupported language (e.g. `fr`) even though the generated UI falls back
 * to English, so assistive tech and browsers still see the authored language.
 */
export function documentLanguage(lang: string | undefined | null): string {
  return normalizeLanguageTag(lang) ?? DEFAULT_LOCALE;
}

export interface ResolvedLanguage {
  /** UI locale whose dictionary renders the generated player chrome. */
  locale: Locale;
  /** Canonical declared tag, when a valid one was provided. */
  language?: string;
  /** Whether the declared language maps to a supported UI locale. */
  supported: boolean;
}

/**
 * Resolves an authored language tag to a supported UI locale:
 * - English tags (`en`, `en-US`, ...) render English.
 * - Portuguese tags (`pt`, `pt-BR`, `pt-PT`, ...) render Brazilian Portuguese.
 * - Everything else falls back to English and reports `supported: false`.
 *
 * An absent tag is the parser's default (`en`) and is therefore treated as
 * supported, not as a fallback, so no warning is emitted for it.
 */
export function resolveLanguage(
  lang: string | undefined | null,
): ResolvedLanguage {
  const language = normalizeLanguageTag(lang);
  if (!language) {
    return { locale: DEFAULT_LOCALE, supported: true };
  }
  const base = language.split('-')[0]?.toLowerCase();
  if (base === 'en') {
    return { locale: 'en', language, supported: true };
  }
  if (base === 'pt') {
    return { locale: 'pt-BR', language, supported: true };
  }
  return { locale: DEFAULT_LOCALE, language, supported: false };
}

/** Convenience wrapper returning only the UI locale. */
export function resolveLocale(lang: string | undefined | null): Locale {
  return resolveLanguage(lang).locale;
}
