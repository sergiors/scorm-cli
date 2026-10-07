import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Course } from '@scorm-cli/core';
import { build as viteBuild, type Plugin } from 'vite';
import type {
  RenderAsset,
  RenderOptions,
  RenderResult,
  Renderer,
} from './types';

const ENTRYPOINT = 'index.html';
const COURSE_DATA_ID = 'virtual:course-data';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inlines the already-parsed course as a virtual module so the generated
 * application ships with deterministic, self-contained data. No network
 * request is ever made to load the course.
 */
function courseDataPlugin(course: Course): Plugin {
  const resolvedId = `\0${COURSE_DATA_ID}`;

  return {
    name: 'scorm-cli:course-data',
    resolveId(id) {
      return id === COURSE_DATA_ID ? resolvedId : null;
    },
    load(id) {
      if (id !== resolvedId) {
        return null;
      }
      return `export default ${JSON.stringify(course)};`;
    },
    transformIndexHtml(html) {
      const title = escapeHtml(course.metadata.title || 'Course');
      return html.replace(
        /<title>[\s\S]*?<\/title>/,
        () => `<title>${title}</title>`,
      );
    },
  };
}

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
 * Builds a standalone static React player for `course` into
 * `options.outputDirectory`, returning the generated entrypoint.
 *
 * The course must already be parsed; this renderer never reads or parses MDX.
 */
export async function buildReactCourse(
  course: Course,
  options: RenderOptions,
): Promise<RenderResult> {
  if (!options?.outputDirectory) {
    throw new Error('buildReactCourse requires an outputDirectory option.');
  }

  const outputDirectory = path.resolve(options.outputDirectory);
  const packageRoot = findPackageRoot(
    path.dirname(fileURLToPath(import.meta.url)),
  );
  const appRoot = path.join(packageRoot, 'app');
  const indexHtml = path.join(appRoot, ENTRYPOINT);

  if (!existsSync(indexHtml)) {
    throw new Error(
      `Renderer app template not found. Expected ${indexHtml}. ` +
        "The 'app' directory must be shipped with the package.",
    );
  }

  await fs.mkdir(outputDirectory, { recursive: true });

  const assetTargets = resolveAssetTargets(options.assets, outputDirectory);

  await viteBuild({
    configFile: false,
    root: appRoot,
    base: './',
    logLevel: 'warn',
    plugins: [react(), tailwindcss(), courseDataPlugin(course)],
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

export const reactRenderer: Renderer = { build: buildReactCourse };
