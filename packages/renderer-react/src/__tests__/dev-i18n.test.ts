import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentPackage } from '@scorm-cli/core';
import { reactRenderer } from '..';
import type { RendererDevServer } from '..';

function packageWith(lang: string, title: string): ContentPackage {
  return {
    metadata: { title, lang },
    presentation: { type: 'scroll', pages: [] },
  };
}

let workDir: string;
let contentRoot: string;
let server: RendererDevServer;
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'renderer-react-dev-i18n-'));
  contentRoot = path.join(workDir, 'content');
  await mkdir(contentRoot, { recursive: true });

  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const dev = reactRenderer.dev;
  if (!dev) {
    throw new Error('reactRenderer.dev is not implemented');
  }
  server = await dev(packageWith('pt-BR', 'Curso'), {
    contentRoot,
    port: 0,
    host: 'localhost',
  });
}, 120_000);

afterAll(async () => {
  await server?.close();
  warn?.mockRestore();
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe('reactRenderer.dev language handling', () => {
  it('sets the document language from the package metadata', async () => {
    const html = await fetch(server.url).then((response) => response.text());
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('<title>Curso</title>');
  });

  it('warns at most once for an unsupported language and keeps it declared', async () => {
    await server.update(packageWith('fr', 'Cours'));

    const first = await fetch(server.url).then((response) => response.text());
    expect(first).toContain('<html lang="fr">');

    // A second request must not warn again (deduped per language).
    const second = await fetch(server.url).then((response) => response.text());
    expect(second).toContain('<html lang="fr">');

    const unsupportedWarnings = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => /Unsupported content language "fr"/.test(message));
    expect(unsupportedWarnings).toHaveLength(1);
  });
});
