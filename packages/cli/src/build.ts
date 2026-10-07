import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Renderer } from '@scorm-cli/core';
import { collectAssetReferences } from '@scorm-cli/core';
import { packageScorm } from '@scorm-cli/scorm';
import { loadPackage } from './content';
import { loadRenderer } from './renderer';

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
  const { content: contentPackage, contentRoot } =
    await loadPackage(contentPath);
  const output = path.resolve(
    outputPath ?? path.join('dist', `${packageName(contentPath)}.zip`),
  );
  const renderer = rendererBuild ?? (await loadRenderer()).build;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scorm-cli-build-'));
  const renderedDirectory = path.join(tempRoot, 'rendered');
  try {
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
