import fs from 'node:fs/promises';
import path from 'node:path';
import type { ContentPackage } from '@scorm-cli/core';
import { parsePackage } from '@scorm-cli/parser';

export interface LoadedPackage {
  content: ContentPackage;
  contentRoot: string;
  entrypoint: string;
}

/** Parse authored content once and resolve the root used for local asset serving. */
export async function loadPackage(contentPath: string): Promise<LoadedPackage> {
  const absolutePath = path.resolve(contentPath);
  const stats = await fs.stat(absolutePath);
  const contentRoot = stats.isDirectory()
    ? absolutePath
    : path.dirname(absolutePath);
  const entrypoint = stats.isDirectory()
    ? path.join(absolutePath, 'index.mdx')
    : absolutePath;

  return {
    content: await parsePackage(contentPath),
    contentRoot,
    entrypoint,
  };
}
