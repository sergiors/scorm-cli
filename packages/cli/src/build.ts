import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Renderer } from '@scorm-cli/core';
import { collectAssetReferences } from '@scorm-cli/core';
import { parsePackage } from '@scorm-cli/parser';
import { packageScorm } from '@scorm-cli/scorm';

async function loadRendererBuild(): Promise<Renderer['build']> {
  const rendererPackage = '@scorm-cli/renderer-react';
  const renderer = (await import(rendererPackage)) as {
    renderReactPackage: Renderer['build'];
  };
  if (typeof renderer.renderReactPackage !== 'function')
    throw new Error(
      '@scorm-cli/renderer-react does not export renderReactPackage',
    );
  return renderer.renderReactPackage;
}

function packageName(contentPath: string): string {
  const absolute = path.resolve(contentPath);
  const name =
    path.basename(absolute).toLowerCase() === 'index.mdx'
      ? path.basename(path.dirname(absolute))
      : path.basename(absolute, path.extname(absolute));
  return name || 'content';
}

export async function buildPackage(
  contentPath: string,
  outputPath?: string,
  rendererBuild?: Renderer['build'],
): Promise<string> {
  const contentPackage = await parsePackage(contentPath);
  const output = path.resolve(
    outputPath ?? path.join('dist', `${packageName(contentPath)}.zip`),
  );
  const renderer = rendererBuild ?? (await loadRendererBuild());
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scorm-cli-build-'));
  const renderedDirectory = path.join(tempRoot, 'rendered');
  try {
    const contentRoot = (await fs.stat(path.resolve(contentPath))).isDirectory()
      ? path.resolve(contentPath)
      : path.dirname(path.resolve(contentPath));
    const assets = collectAssetReferences(contentPackage).map((reference) => ({
      sourcePath: path.resolve(contentRoot, reference),
      targetPath: reference,
    }));
    const renderResult = await renderer(contentPackage, {
      outputDirectory: renderedDirectory,
      assets,
    });
    return await packageScorm({
      metadata: contentPackage.metadata,
      renderResult,
      outputPath: output,
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
