import fs from 'node:fs/promises';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { ContentPackage } from '@scorm-cli/core';
import { build as viteBuild } from 'vite';
import type { RenderAsset, RenderOptions, RenderResult } from './types';
import {
  createPackageDataPlugin,
  ENTRYPOINT,
  resolveAppRoot,
} from './vite-app';

function resolveAssetTargets(
  assets: RenderAsset[] | undefined,
  outputDirectory: string,
): Array<{ source: string; destination: string }> {
  if (!assets || assets.length === 0) {
    return [];
  }

  const root = path.resolve(outputDirectory);

  return assets.map((asset) => {
    const destination = path.resolve(root, asset.targetPath);
    if (destination !== root && !destination.startsWith(root + path.sep)) {
      throw new Error(
        `Asset target path escapes the output directory: ${asset.targetPath}`,
      );
    }
    return { source: asset.sourcePath, destination };
  });
}

async function copyAssets(
  targets: Array<{ source: string; destination: string }>,
): Promise<void> {
  for (const target of targets) {
    await fs.mkdir(path.dirname(target.destination), { recursive: true });
    await fs.copyFile(target.source, target.destination);
  }
}

/**
 * Builds a standalone static React view for `contentPackage` into
 * `options.outputDirectory`, returning the generated entrypoint.
 *
 * The content package must already be parsed; this renderer never reads or
 * parses MDX.
 */
export async function renderReactPackage(
  contentPackage: ContentPackage,
  options: RenderOptions,
): Promise<RenderResult> {
  if (!options?.outputDirectory) {
    throw new Error('renderReactPackage requires an outputDirectory option.');
  }

  const outputDirectory = path.resolve(options.outputDirectory);
  const appRoot = resolveAppRoot(import.meta.url);
  const indexHtml = path.join(appRoot, ENTRYPOINT);

  await fs.mkdir(outputDirectory, { recursive: true });

  const assetTargets = resolveAssetTargets(options.assets, outputDirectory);

  await viteBuild({
    configFile: false,
    root: appRoot,
    base: './',
    logLevel: 'warn',
    // Generated shadcn components import through the `@/` alias; resolve it to
    // the shipped `app` directory.
    resolve: { alias: { '@': appRoot } },
    plugins: [
      react(),
      tailwindcss(),
      createPackageDataPlugin({ current: contentPackage }),
    ],
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: {
        input: indexHtml,
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  });

  await copyAssets(assetTargets);

  return { directory: outputDirectory, entrypoint: ENTRYPOINT };
}
