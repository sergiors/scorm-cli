/**
 * UI locales the player ships a message catalog for. This is the player's only
 * locale concept; the document's declared `lang` is resolved separately (see
 * `vite-app`) and is deliberately not narrowed to these values.
 */
export type PlayerLocale = 'en' | 'pt-BR';

/**
 * Resolves an authored BCP-47 language tag to the UI locale whose catalog
 * renders the generated player chrome.
 *
 * The tag is matched on its base language: `pt` and every `pt-*` variant render
 * Brazilian Portuguese, while English, unsupported languages, absent tags and
 * malformed input all render English. Trimming, lowercasing and splitting on the
 * base keeps the mapping resilient to authored casing, surrounding whitespace
 * and region subtags without canonicalizing the tag.
 */
export function resolvePlayerLocale(lang?: string | null): PlayerLocale {
  const base = lang?.trim().toLowerCase().split('-')[0];
  return base === 'pt' ? 'pt-BR' : 'en';
}
