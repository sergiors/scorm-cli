import type {
  ContentPackage,
  Renderer,
  RendererDevOptions,
} from '@scorm-cli/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedPackage } from './content';
import { startDevPackage } from './dev';

const content: ContentPackage = {
  metadata: { title: 'Demo' },
  children: [],
};

function loaded(title: string): LoadedPackage {
  return {
    content: { ...content, metadata: { title } },
    contentRoot: '/content',
    entrypoint: '/content/index.mdx',
  };
}

afterEach(() => vi.useRealTimers());

describe('CLI dev orchestration', () => {
  it('updates valid content, reports parse errors, recovers, and closes cleanly', async () => {
    vi.useFakeTimers();
    let loadMode: 'valid' | 'invalid' = 'valid';
    let onChange = () => {};
    let watchClosed = 0;
    let serverClosed = 0;
    const updates: ContentPackage[] = [];
    const errors: string[] = [];
    const dev = vi.fn(
      async (_initial: ContentPackage, options: RendererDevOptions) => {
        expect(options).toEqual({ contentRoot: '/content', port: 4173 });
        return {
          url: 'http://localhost:4173',
          update: async (next: ContentPackage) => {
            updates.push(next);
          },
          reportError: (message: string) => errors.push(message),
          close: async () => {
            serverClosed++;
          },
        };
      },
    );
    const renderer: Renderer = { build: vi.fn(), dev };
    const session = await startDevPackage(
      '/content',
      { port: 4173 },
      {
        loadPackage: async () => {
          if (loadMode === 'invalid') throw new Error('invalid MDX');
          return loaded('Updated');
        },
        loadRenderer: async () => renderer,
        watch: async (_root, callback) => {
          onChange = callback;
          return {
            close: async () => {
              watchClosed++;
            },
          };
        },
        debounceMs: 10,
      },
    );

    expect(dev).toHaveBeenCalledTimes(1);
    expect(session).toMatchObject({
      url: 'http://localhost:4173',
      entrypoint: '/content/index.mdx',
    });

    onChange();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(updates.map((next) => next.metadata.title)).toEqual(['Updated']);

    loadMode = 'invalid';
    onChange();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(errors).toEqual(['invalid MDX']);

    loadMode = 'valid';
    onChange();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(updates).toHaveLength(2);

    await session.close();
    expect(watchClosed).toBe(1);
    expect(serverClosed).toBe(1);
    await session.close();
    expect(serverClosed).toBe(1);
  });

  it('fails clearly when the renderer has no dev implementation', async () => {
    await expect(
      startDevPackage(
        '/content',
        {},
        {
          loadPackage: async () => loaded('Demo'),
          loadRenderer: async () => ({ build: vi.fn() }),
          watch: async () => ({ close: async () => {} }),
          debounceMs: 1,
        },
      ),
    ).rejects.toThrow('does not support dev mode');
  });
});
