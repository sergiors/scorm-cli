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
      const title = escapeHtml(handle.current.metadata.title || 'Content');
      return html.replace(
        /<title>[\s\S]*?<\/title>/,
        () => `<title>${title}</title>`,
      );
    },
  };
}
