import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderReactPackage, reactRenderer } from '..';
import type { RenderResult } from '..';
import { samplePackage } from './fixtures';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`;

let workDir: string;
let outputDirectory: string;
let entrypoint: RenderResult;
let indexHtml: string;
let appJs: string;
let bundleJs: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'renderer-react-'));
  outputDirectory = path.join(workDir, 'out');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'stale.txt'), 'should be removed');
  await writeFile(path.join(workDir, 'thumb.svg'), SVG);

  entrypoint = await renderReactPackage(samplePackage, {
    outputDirectory,
    assets: [
      {
        sourcePath: path.join(workDir, 'thumb.svg'),
        targetPath: 'assets/thumb.svg',
      },
    ],
  });

  indexHtml = await readFile(path.join(outputDirectory, 'index.html'), 'utf-8');
  appJs = await readFile(
    path.join(outputDirectory, 'assets', 'app.js'),
    'utf-8',
  );

  // Concatenate every emitted script (not just the entry) so the exclusion
  // checks below cover lazily split dev-only chunks too.
  const assetFiles = await readdir(path.join(outputDirectory, 'assets'));
  const jsFiles = assetFiles.filter((name) => name.endsWith('.js'));
  bundleJs = (
    await Promise.all(
      jsFiles.map((name) =>
        readFile(path.join(outputDirectory, 'assets', name), 'utf-8'),
      ),
    )
  ).join('\n');
}, 120_000);

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe('renderReactPackage', () => {
  it('returns the output directory and index.html entrypoint', () => {
    expect(entrypoint.directory).toBe(path.resolve(outputDirectory));
    expect(entrypoint.entrypoint).toBe('index.html');
  });

  it('generates a self-contained index.html', () => {
    expect(indexHtml).toContain('<div id="root">');
    expect(indexHtml).toContain('./assets/app.js');
    expect(indexHtml).toContain('rel="stylesheet"');
    expect(indexHtml).toContain('href="./assets/');
    expect(indexHtml).toContain('<title>Rendering Fundamentals</title>');
    // Relative base so the output works from the file system or any subpath.
    expect(indexHtml).not.toContain('src="/assets');
  });

  it('clears stale files from the output directory', async () => {
    await expect(
      readFile(path.join(outputDirectory, 'stale.txt'), 'utf-8'),
    ).rejects.toThrow();
  });

  it('embeds deterministic package data in the bundle', () => {
    expect(appJs).toContain('Introduction');
    expect(appJs).toContain('Rendering Fundamentals');
    // No runtime JSON fetch is used to load the package.
    expect(appJs).not.toContain('virtual:package-data');
  });

  it('does not ship the dev-only preview error channel', () => {
    expect(appJs).not.toContain('scorm:preview-error');
    expect(appJs).not.toContain('scorm:preview-clear');
    expect(appJs).not.toContain('import.meta.hot');
  });

  it('does not ship the SCORM runtime event inspector or its panel', () => {
    for (const marker of [
      'scorm:runtime-event',
      '__SCORM_DEV_EVENT_BUFFER__',
      'ScormRuntimeEventInspector',
      'SCORM runtime event inspector',
      'SCORM events',
      'Mock LMS',
      'No SCORM runtime events yet',
      'Clear captured SCORM events',
      'lms.api-found',
      'lms.api-missing',
      'lms.initialize',
      'lms.get-value',
      'lms.set-value',
      'lms.commit',
      'lms.finish',
    ]) {
      expect(bundleJs).not.toContain(marker);
    }
    expect(bundleJs).not.toContain('import.meta.hot');
  });

  it('emits a compiled stylesheet', async () => {
    const assets = await readdir(path.join(outputDirectory, 'assets'));
    const cssFile = assets.find((name) => name.endsWith('.css'));
    expect(cssFile).toBeDefined();
    const css = await readFile(
      path.join(outputDirectory, 'assets', cssFile as string),
      'utf-8',
    );
    expect(css.length).toBeGreaterThan(0);
  });

  it('copies provided assets to their target paths', async () => {
    const copied = await readFile(
      path.join(outputDirectory, 'assets', 'thumb.svg'),
      'utf-8',
    );
    expect(copied).toBe(SVG);
  });

  it('rejects an asset target that escapes the output directory', async () => {
    await expect(
      renderReactPackage(samplePackage, {
        outputDirectory,
        assets: [
          {
            sourcePath: path.join(workDir, 'thumb.svg'),
            targetPath: '../evil',
          },
        ],
      }),
    ).rejects.toThrow(/escapes the output directory/);
  });

  it('requires an output directory', async () => {
    await expect(
      renderReactPackage(samplePackage, { outputDirectory: '' }),
    ).rejects.toThrow(/outputDirectory/);
  });
});

describe('reactRenderer', () => {
  it('exposes renderReactPackage through the renderer contract', () => {
    expect(reactRenderer.build).toBe(renderReactPackage);
  });
});
