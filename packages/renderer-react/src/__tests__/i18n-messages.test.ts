import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en, messages, ptBR } from '../../app/lib/messages';

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../app',
);

describe('player message catalogs', () => {
  it('gives pt-BR exactly the canonical English key set', () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
  });

  it('ships a non-empty string for every key of every supported locale', () => {
    const canonical = Object.keys(en).sort();
    for (const locale of Object.keys(messages) as Array<
      keyof typeof messages
    >) {
      expect(Object.keys(messages[locale]).sort()).toEqual(canonical);
      for (const value of Object.values(messages[locale])) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses structured, namespaced ids', () => {
    for (const id of Object.keys(en)) {
      expect(id).toMatch(/^[a-z][a-zA-Z]*(?:[.-][a-zA-Z]+)+$/);
    }
  });

  it('keeps ICU placeholders aligned across locales', () => {
    const placeholders = (value: string) =>
      Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();

    for (const id of Object.keys(en)) {
      expect(placeholders(ptBR[id as keyof typeof ptBR])).toEqual(
        placeholders(en[id as keyof typeof en]),
      );
    }
  });
});

describe('custom i18n module removal', () => {
  it('no longer ships the bespoke context/hook module', () => {
    expect(existsSync(path.join(appRoot, 'lib/use-i18n.tsx'))).toBe(false);
    expect(existsSync(path.join(appRoot, 'lib/use-i18n.ts'))).toBe(false);
  });

  it('no longer ships the shared language-resolution module', () => {
    expect(existsSync(path.join(appRoot, 'lib/i18n.ts'))).toBe(false);
  });
});
