import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import JSZip from 'jszip';
import { create } from 'xmlbuilder2';
import { afterEach, describe, expect, it } from 'vitest';
import { createManifest, packageScorm, scormRuntime } from './index';

let temp: string;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe('SCORM 1.2 package', () => {
  it('creates a well-formed manifest with metadata and a single SCO resource', () => {
    const title = `R&D <Safety> "101"`;
    const xml = createManifest({ title }, [
      'index.html',
      'assets/photo.svg',
      'assets/R&D <photo>.svg',
      'assets/photo.svg',
    ]);
    expect(xml).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<manifest[^\n]*\n  xmlns=/,
    );
    expect(xml).toContain('\n  xsi:schemaLocation=');
    const root = create(xml).root().node as any;
    const namespace = 'http://www.imsproject.org/xsd/imscp_rootv1p1p2';
    const organization = root.getElementsByTagNameNS(
      namespace,
      'organization',
    )[0];
    const titles = organization.getElementsByTagNameNS(namespace, 'title');
    const resources = root.getElementsByTagNameNS(namespace, 'resource');

    expect(root.namespaceURI).toBe(namespace);
    expect(root.lookupNamespaceURI('adlcp')).toBe(
      'http://www.adlnet.org/xsd/adlcp_rootv1p2',
    );
    expect(
      root.getAttributeNS(
        'http://www.w3.org/2001/XMLSchema-instance',
        'schemaLocation',
      ),
    ).toContain('imscp_rootv1p1p2.xsd');
    expect(titles[0].textContent).toBe(title);
    expect(titles[1].textContent).toBe(title);
    expect(resources).toHaveLength(1);
    expect(
      resources[0].getAttributeNS(
        'http://www.adlnet.org/xsd/adlcp_rootv1p2',
        'scormtype',
      ),
    ).toBe('sco');
    expect(resources[0].getAttribute('href')).toBe('index.html');
    expect(
      Array.from(
        resources[0].getElementsByTagNameNS(namespace, 'file'),
        (file: any) => file.getAttribute('href'),
      ),
    ).toEqual(['assets/R&D <photo>.svg', 'assets/photo.svg', 'index.html']);
  });

  it('creates a ZIP with the manifest at root and injects the SCORM bridge', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'scorm-test-'));
    const renderDir = path.join(temp, 'render');
    await mkdir(path.join(renderDir, 'assets'), { recursive: true });
    await writeFile(
      path.join(renderDir, 'index.html'),
      '<!doctype html><html><head></head><body><script src="app.js"></script></body></html>',
    );
    await writeFile(path.join(renderDir, 'app.js'), 'window.booted = true;');
    await writeFile(path.join(renderDir, 'assets', 'photo.svg'), '<svg/>');
    const output = await packageScorm({
      metadata: { title: 'A package' },
      renderResult: { directory: renderDir, entrypoint: 'index.html' },
      outputPath: path.join(temp, 'content-package.zip'),
    });
    const zip = await JSZip.loadAsync(await readFile(output));
    expect(Object.keys(zip.files)).toContain('imsmanifest.xml');
    expect(Object.keys(zip.files)).toContain('assets/photo.svg');
    expect(await zip.file('imsmanifest.xml')!.async('string')).toContain(
      'href="index.html"',
    );
    const html = await zip.file('index.html')!.async('string');
    expect(html.indexOf('scorm-runtime.js')).toBeLessThan(
      html.indexOf('app.js'),
    );
    expect(await zip.file('scorm-runtime.js')!.async('string')).toContain(
      'LMSInitialize',
    );
  });

  it('initializes, preserves completion, marks completed, and finishes once', () => {
    const calls: Array<[string, ...string[]]> = [];
    const api = {
      LMSInitialize: (value: string) => {
        calls.push(['init', value]);
        return 'true';
      },
      LMSGetValue: (key: string) => {
        calls.push(['get', key]);
        return 'incomplete';
      },
      LMSSetValue: (key: string, value: string) => {
        calls.push(['set', key, value]);
        return 'true';
      },
      LMSCommit: (value: string) => {
        calls.push(['commit', value]);
        return 'true';
      },
      LMSFinish: (value: string) => {
        calls.push(['finish', value]);
        return 'true';
      },
    };
    const handlers: Record<string, () => void> = {};
    const windowMock: any = {
      API: api,
      parent: null,
      addEventListener: (name: string, cb: () => void) => {
        handlers[name] = cb;
      },
    };
    windowMock.parent = windowMock;
    vm.runInNewContext(scormRuntime, { window: windowMock });
    windowMock.scormBridge.markCompleted();
    windowMock.scormBridge.finish();
    handlers.beforeunload();
    expect(calls).toEqual([
      ['init', ''],
      ['get', 'cmi.core.lesson_status'],
      ['set', 'cmi.core.lesson_status', 'incomplete'],
      ['commit', ''],
      ['set', 'cmi.core.lesson_status', 'completed'],
      ['commit', ''],
      ['commit', ''],
      ['finish', ''],
    ]);
    expect(calls.filter(([name]) => name === 'set')).toContainEqual([
      'set',
      'cmi.core.lesson_status',
      'completed',
    ]);
    expect(calls.filter(([name]) => name === 'finish')).toHaveLength(1);
  });
});
