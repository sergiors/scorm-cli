import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentPackage } from '@scorm-cli/core';
import type { Plugin } from 'vite';

/** HTML template shipped with the package and used by both build and dev. */
export const ENTRYPOINT = 'index.html';

/** Public virtual module id consumed by the app as `virtual:package-data`. */
export const PACKAGE_DATA_ID = 'virtual:package-data';

/**
 * Resolved id Vite stores in its module graph. Kept here so dev mode can
 * invalidate the virtual module when the authored content changes.
 */
export const RESOLVED_PACKAGE_DATA_ID = `\0${PACKAGE_DATA_ID}`;

function findPackageRoot(startDirectory: string): string {
  let directory = startDirectory;
  for (;;) {
    if (existsSync(path.join(directory, 'package.json'))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(
        'Could not locate the renderer-react package root (no package.json found).',
      );
    }
    directory = parent;
  }
}

/**
 * Resolves the shipped `app` directory from the calling module URL, validating
 * that the HTML template exists so failures surface early with a clear message.
 */
export function resolveAppRoot(moduleUrl: string): string {
  const packageRoot = findPackageRoot(path.dirname(fileURLToPath(moduleUrl)));
  const appRoot = path.join(packageRoot, 'app');
  const indexHtml = path.join(appRoot, ENTRYPOINT);

  if (!existsSync(indexHtml)) {
    throw new Error(
      `Renderer app template not found. Expected ${indexHtml}. ` +
        "The 'app' directory must be shipped with the package.",
    );
  }

  return appRoot;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The document's declared language: the authored tag verbatim when present,
 * else `en`. Only surrounding whitespace is trimmed, so a declared language is
 * never rewritten to a canonical form and stays independent from the UI locale
 * the generated player renders in.
 */
function declaredDocumentLanguage(lang: string | undefined): string {
  const declared = lang?.trim();
  return declared ? declared : 'en';
}

/**
 * Whether the player ships a UI dictionary for the base language of an authored
 * tag. This is a local authoring check only: it decides whether to warn that the
 * chrome will render in English and never alters the declared document language.
 */
function hasPlayerDictionary(language: string): boolean {
  const base = language.toLowerCase().split('-')[0];
  return base === 'en' || base === 'pt';
}

/**
 * Rewrites the document's `lang` attribute to `language`, adding it when the
 * template has none. The declared language is preserved even when it is not a
 * supported UI locale, so the browser and assistive tech still see it.
 */
function setDocumentLanguage(html: string, language: string): string {
  const escaped = escapeHtml(language);
  return html.replace(/<html\b[^>]*>/i, (tag) => {
    // Require an attribute boundary (whitespace) before `lang` so look-alikes
    // such as `data-lang` or `xml:lang` are not matched and rewritten.
    if (/(\s)lang\s*=/i.test(tag)) {
      return tag.replace(
        /(\s)lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        `$1lang="${escaped}"`,
      );
    }
    return tag.replace(/^<html/i, `<html lang="${escaped}"`);
  });
}

/**
 * Mutable holder for the current package. Dev mode replaces `current` in place
 * so the plugin always serves the latest authored content without re-creating
 * the Vite server.
 */
export interface PackageDataHandle {
  current: ContentPackage;
}

/**
 * Inlines the already-parsed content package as a virtual module so the
 * generated application ships with deterministic, self-contained data. No
 * network request is ever made to load the package.
 */
export function createPackageDataPlugin(handle: PackageDataHandle): Plugin {
  // Dedupe warnings per declared language so a dev server does not warn on
  // every request (and every reload) for the same unsupported package.
  const warnedLanguages = new Set<string>();

  return {
    name: 'scorm-cli:package-data',
    resolveId(id) {
      return id === PACKAGE_DATA_ID ? RESOLVED_PACKAGE_DATA_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_PACKAGE_DATA_ID) {
        return null;
      }
      return `export default ${JSON.stringify(handle.current)};`;
    },
    transformIndexHtml(html) {
      const { metadata } = handle.current;
      const title = escapeHtml(metadata.title || 'Content');
      const language = declaredDocumentLanguage(metadata.lang);

      if (!hasPlayerDictionary(language) && !warnedLanguages.has(language)) {
        warnedLanguages.add(language);
        console.warn(
          `[scorm-cli] Unsupported content language "${language}". ` +
            `Rendering the player in English; supported languages are en, pt-BR.`,
        );
      }

      const withTitle = html.replace(
        /<title>[\s\S]*?<\/title>/,
        () => `<title>${title}</title>`,
      );
      return setDocumentLanguage(withTitle, language);
    },
  };
}
