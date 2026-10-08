import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reactRenderer } from '../src';
import type { RendererDevServer } from '../src';
import { samplePackage } from './fixtures';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';

interface HmrFrame {
  type?: string;
  event?: string;
  data?: unknown;
}

/** Minimal Vite HMR client used to observe custom preview events. */
class HmrSocket {
  private readonly socket: WebSocket;
  private readonly received: HmrFrame[] = [];
  private readonly pending: Array<{
    match: (frame: HmrFrame) => boolean;
    resolve: (frame: HmrFrame) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      let frame: HmrFrame;
      try {
        frame = JSON.parse(String(event.data)) as HmrFrame;
      } catch {
        return;
      }
      this.received.push(frame);
      for (let index = this.pending.length - 1; index >= 0; index -= 1) {
        const waiter = this.pending[index];
        if (waiter.match(frame)) {
          clearTimeout(waiter.timer);
          this.pending.splice(index, 1);
          waiter.resolve(frame);
        }
      }
    });
  }

  waitFor(
    match: (frame: HmrFrame) => boolean,
    timeoutMs = 15_000,
  ): Promise<HmrFrame> {
    const existing = this.received.find(match);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for HMR frame')),
        timeoutMs,
      );
      this.pending.push({ match, resolve, timer });
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function connectHmr(baseUrl: string): Promise<HmrSocket> {
  const clientSource = await fetch(`${baseUrl}@vite/client`).then((response) =>
    response.text(),
  );
  const token = clientSource.match(/const wsToken = "([^"]+)"/)?.[1] ?? '';
  const wsUrl = `${baseUrl.replace(/^http/, 'ws')}?token=${encodeURIComponent(
    token,
  )}`;

  const socket = new WebSocket(wsUrl, 'vite-hmr');
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener(
      'error',
      () => reject(new Error('HMR WebSocket failed to open')),
      { once: true },
    );
  });
  return new HmrSocket(socket);
}

let workDir: string;
let contentRoot: string;
let server: RendererDevServer;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'renderer-react-dev-'));
  contentRoot = path.join(workDir, 'content');
  await mkdir(path.join(contentRoot, 'assets'), { recursive: true });
  await writeFile(path.join(contentRoot, 'assets', 'pixel.svg'), SVG);

  const dev = reactRenderer.dev;
  if (!dev) {
    throw new Error('reactRenderer.dev is not implemented');
  }

  server = await dev(samplePackage, {
    contentRoot,
    port: 0,
    host: 'localhost',
    scripts: [
      { id: 'scorm-dev-mock', source: 'window.__SCORM_DEVTOOLS__ = true;' },
      {
        id: 'scorm-runtime',
        source: 'window.scormBridge = { markCompleted: function () {} };',
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe('reactRenderer.dev', () => {
  it('exposes an http url', () => {
    expect(server.url).toMatch(/^http:\/\/[^/]+\/$/);
  });

  it('serves the app shell with the package title', async () => {
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    expect(html).toContain('/@vite/client');
    expect(html).toContain('<title>Rendering Fundamentals</title>');
  });

  it('serves local assets from the provided content root', async () => {
    const response = await fetch(`${server.url}assets/pixel.svg`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SVG);
  });

  it('injects the provided dev scripts in order, before the app module', async () => {
    const html = await fetch(server.url).then((response) => response.text());

    const mockIndex = html.indexOf('__SCORM_DEVTOOLS__');
    const runtimeIndex = html.indexOf('markCompleted');
    const appIndex = html.indexOf('main.tsx');

    expect(mockIndex).toBeGreaterThan(-1);
    expect(runtimeIndex).toBeGreaterThan(mockIndex);
    expect(appIndex).toBeGreaterThan(runtimeIndex);
  });

  it('serves the virtual package data module', async () => {
    const response = await fetch(
      `${server.url}@id/__x00__virtual:package-data`,
    );
    expect(response.status).toBe(200);
    const code = await response.text();
    expect(code).toContain('Rendering Fundamentals');
    expect(code).toContain('Introduction');
  });

  it('replaces the virtual package data on update', async () => {
    const updated = {
      ...samplePackage,
      metadata: { title: 'Updated title' },
    };

    await server.update(updated);

    const module = await fetch(
      `${server.url}@id/__x00__virtual:package-data`,
    ).then((response) => response.text());
    expect(module).toContain('Updated title');

    const html = await fetch(server.url).then((response) => response.text());
    expect(html).toContain('<title>Updated title</title>');
  });

  it('broadcasts preview errors and clears them on the next update', async () => {
    const client = await connectHmr(server.url);
    try {
      // Wait until the server has registered this client.
      await client.waitFor((frame) => frame.type === 'connected');

      const errorFrame = client.waitFor(
        (frame) =>
          frame.type === 'custom' && frame.event === 'scorm:preview-error',
      );
      server.reportError('Broken content at lessons/intro.mdx:3');
      const error = await errorFrame;
      expect(error.data).toEqual({
        message: 'Broken content at lessons/intro.mdx:3',
      });

      const clearFrame = client.waitFor(
        (frame) =>
          frame.type === 'custom' && frame.event === 'scorm:preview-clear',
      );
      await server.update({
        ...samplePackage,
        metadata: { title: 'Recovered' },
      });
      await clearFrame;
    } finally {
      client.close();
    }
  });
});
