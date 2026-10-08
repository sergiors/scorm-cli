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
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPackage } from './build';

let temp: string;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe('CLI build orchestration', () => {
  it('parses, forwards assets to the renderer, and packages a SCORM ZIP', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-cli-test-'));
    const contentDir = path.join(temp, 'content');
    await mkdir(path.join(contentDir, 'media'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'index.mdx'),
      `---\ntitle: Demo\n---\n<Grid><Item src="lesson.mdx" /></Grid>`,
    );
    await writeFile(
      path.join(contentDir, 'lesson.mdx'),
      `---\ntitle: Lesson\n---\n<Image src="media/picture.svg" alt="Picture" />`,
    );
    await writeFile(path.join(contentDir, 'media', 'picture.svg'), '<svg/>');
    const output = path.join(temp, 'out.zip');
    let seenAssets: unknown;
    const zipPath = await buildPackage(
      contentDir,
      output,
      async (_contentPackage, options) => {
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
        sourcePath: path.join(contentDir, 'media', 'picture.svg'),
        targetPath: 'media/picture.svg',
      },
    ]);
    const archive = await readFile(zipPath);
    expect(archive.subarray(0, 2).toString()).toBe('PK');
    expect((await stat(zipPath)).size).toBeGreaterThan(100);
    const zip = await JSZip.loadAsync(archive);
    const contentManifest = JSON.parse(
      await zip.file('content-manifest.json')!.async('string'),
    );
    expect(contentManifest).toMatchObject({
      title: 'Demo',
      presentation: 'grid',
      pages: {
        '0': { id: expect.any(String), title: 'Lesson', questions: {} },
      },
    });
    expect(await zip.file('scorm-runtime.js')!.async('string')).toContain(
      JSON.stringify(contentManifest),
    );
  });
});
