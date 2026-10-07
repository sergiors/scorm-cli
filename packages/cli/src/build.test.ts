import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPackage } from './build';

let temp: string;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe('CLI build orchestration', () => {
  it('parses, forwards assets to the renderer, and packages a SCORM ZIP', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-cli-test-'));
    const courseDir = path.join(temp, 'course');
    await mkdir(path.join(courseDir, 'media'), { recursive: true });
    await writeFile(
      path.join(courseDir, 'index.mdx'),
      `---\ntitle: Demo\n---\n<Item src="lesson.mdx" />`,
    );
    await writeFile(
      path.join(courseDir, 'lesson.mdx'),
      `---\ntitle: Lesson\n---\n<Image src="media/picture.svg" />`,
    );
    await writeFile(path.join(courseDir, 'media', 'picture.svg'), '<svg/>');
    const output = path.join(temp, 'out.zip');
    let seenAssets: unknown;
    const zipPath = await buildPackage(
      courseDir,
      output,
      async (_course, options) => {
        seenAssets = options.assets;
        await mkdir(options.outputDirectory, { recursive: true });
        await writeFile(
          path.join(options.outputDirectory, 'index.html'),
          '<html><head></head><body></body></html>',
        );
        return { directory: options.outputDirectory, entrypoint: 'index.html' };
      },
    );
    expect(seenAssets).toEqual([
      {
        sourcePath: path.join(courseDir, 'media', 'picture.svg'),
        targetPath: 'media/picture.svg',
      },
    ]);
    const archive = await readFile(zipPath);
    expect(archive.subarray(0, 2).toString()).toBe('PK');
    expect((await stat(zipPath)).size).toBeGreaterThan(100);
  });
});
