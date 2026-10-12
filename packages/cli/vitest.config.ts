import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** Built output of a private workspace package, which the CLI bundles at build time. */
const workspace = (name: string): string =>
  path.join(repoRoot, 'packages', name, 'dist', 'index.js');

export default defineConfig({
  // The CLI does not declare the private workspace packages as dependencies, so
  // tests resolve them straight to their built output, mirroring the bundle.
  resolve: {
    alias: {
      '@scorm-cli/core': workspace('core'),
      '@scorm-cli/parser': workspace('parser'),
      '@scorm-cli/renderer-react': workspace('renderer-react'),
      '@scorm-cli/scorm': workspace('scorm'),
    },
  },
});
