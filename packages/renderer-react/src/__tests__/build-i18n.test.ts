import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentPackage } from '@scorm-cli/core';
import { renderReactPackage } from '..';

function packageWith(lang: string | undefined): ContentPackage {
  return {
    metadata:
      lang === undefined ? { title: 'Package' } : { title: 'Package', lang },
    presentation: { type: 'scroll', pages: [] },
  };
}

async function readBundle(outputDirectory: string): Promise<string> {
  const assets = await readdir(path.join(outputDirectory, 'assets'));
  return (
    await Promise.all(
      assets
        .filter((name) => name.endsWith('.js'))
        .map((name) =>
          readFile(path.join(outputDirectory, 'assets', name), 'utf-8'),
        ),
    )
  ).join('\n');
}

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'renderer-react-i18n-'));
}, 30_000);

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe('renderReactPackage language handling', () => {
  it('sets the document language and title from the declared tag', async () => {
    const outputDirectory = path.join(workDir, 'pt');
    await renderReactPackage(packageWith('pt-BR'), { outputDirectory });

    const indexHtml = await readFile(
      path.join(outputDirectory, 'index.html'),
      'utf-8',
    );
    expect(indexHtml).toContain('<html lang="pt-BR">');
    expect(indexHtml).toContain('<title>Package</title>');

    // The generated bundle carries the Portuguese player dictionary.
    const bundleJs = await readBundle(outputDirectory);
    expect(bundleJs).toContain('Página anterior');
    expect(bundleJs).toContain('Este pacote não contém nenhum conteúdo.');
  }, 120_000);

  it('warns once and keeps an unsupported declared language in the document', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const outputDirectory = path.join(workDir, 'fr');
      await renderReactPackage(packageWith('fr'), { outputDirectory });

      const indexHtml = await readFile(
        path.join(outputDirectory, 'index.html'),
        'utf-8',
      );
      expect(indexHtml).toContain('<html lang="fr">');

      const unsupportedWarnings = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => /Unsupported content language "fr"/.test(message));
      expect(unsupportedWarnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  }, 120_000);
});
