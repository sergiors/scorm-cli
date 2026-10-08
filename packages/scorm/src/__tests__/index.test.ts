import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { create } from 'xmlbuilder2';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContentPackage } from '@scorm-cli/core';
import {
  createContentManifest,
  createManifest,
  decodeSuspendData,
  encodeSuspendData,
  packageScorm,
  scormDevMock,
} from '../index';

let temp: string;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

const content: ContentPackage = {
  metadata: { title: 'Package title' },
  presentation: {
    type: 'grid',
    items: [
      {
        type: 'item',
        id: 'item-one',
        source: 'one.mdx',
        metadata: { title: 'Lesson' },
        content: [
          {
            type: 'questionnaire',
            id: 'wrapper-id',
            questions: [
              {
                type: 'question',
                id: 'question-id',
                questionType: 'single-choice',
                prompt: [
                  {
                    type: 'paragraph',
                    children: [
                      { type: 'text', value: 'Do not persist prompt' },
                    ],
                  },
                ],
                options: [
                  {
                    value: 'known-answer',
                    correct: true,
                    content: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'text', value: 'Known' }],
                      },
                    ],
                  },
                  {
                    value: 'other-answer',
                    correct: false,
                    content: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'text', value: 'Other' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
};

describe('SCORM 1.2 package', () => {
  it('creates a manifest with metadata and a single SCO resource', () => {
    const xml = createManifest({ title: 'A <Course>' }, [
      'index.html',
      'index.html',
    ]);
    const root = create(xml).root().node as any;
    const namespace = 'http://www.imsproject.org/xsd/imscp_rootv1p1p2';
    const resources = root.getElementsByTagNameNS(namespace, 'resource');
    expect(resources).toHaveLength(1);
    expect(resources[0].getAttribute('href')).toBe('index.html');
    expect(root.getElementsByTagNameNS(namespace, 'title')[0].textContent).toBe(
      'A <Course>',
    );
  });

  it('writes the exact content dictionary to the ZIP and references it in imsmanifest', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-test-'));
    const renderDir = path.join(temp, 'render');
    await mkdir(renderDir);
    await writeFile(
      path.join(renderDir, 'index.html'),
      '<!doctype html><html><head></head><body></body></html>',
    );
    await writeFile(path.join(renderDir, 'app.js'), 'window.booted = true;');
    const contentManifest = createContentManifest(content);
    const output = await packageScorm({
      metadata: content.metadata,
      contentManifest,
      renderResult: { directory: renderDir, entrypoint: 'index.html' },
      outputPath: path.join(temp, 'content-package.zip'),
    });
    const zip = await JSZip.loadAsync(await readFile(output));
    expect(Object.keys(zip.files)).toContain('content-manifest.json');
    expect(Object.keys(zip.files)).toContain('scorm-runtime.js');
    expect(Object.keys(zip.files)).not.toContain('scorm-dev-mock.js');

    const manifestContents = await zip
      .file('content-manifest.json')!
      .async('string');
    expect(JSON.parse(manifestContents)).toEqual(contentManifest);
    const xml = create(
      await zip.file('imsmanifest.xml')!.async('string'),
    ).root().node as any;
    const namespace = 'http://www.imsproject.org/xsd/imscp_rootv1p1p2';
    const files = xml.getElementsByTagNameNS(namespace, 'file');
    expect([...files].map((file: any) => file.getAttribute('href'))).toContain(
      'content-manifest.json',
    );
    const runtime = await zip.file('scorm-runtime.js')!.async('string');
    expect(runtime).toContain(JSON.stringify(contentManifest));
    expect(await zip.file('index.html')!.async('string')).toContain(
      'scorm-runtime.js',
    );

    // The serialized selection can be restored with precisely the shipped dictionary.
    const state = {
      pages: {
        'item-one': {
          visited: true,
          answers: { 'question-id': 'known-answer' },
        },
      },
    };
    const saved = encodeSuspendData(contentManifest, state, 100);
    expect(decodeSuspendData(contentManifest, JSON.stringify(saved))).toEqual({
      pages: {
        'item-one': {
          visited: true,
          answers: { 'question-id': 'known-answer' },
        },
      },
    });
  });

  it('keeps the dev mock isolated from production packaging', () => {
    expect(scormDevMock).toContain('scorm-cli:dev:');
  });
});
