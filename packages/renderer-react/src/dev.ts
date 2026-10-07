import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type {
  ContentPackage,
  RendererDevOptions,
  RendererDevServer,
} from '@scorm-cli/core';
import { createServer, searchForWorkspaceRoot, type ViteDevServer } from 'vite';
import {
  PREVIEW_CLEAR_EVENT,
  PREVIEW_ERROR_EVENT,
} from '../app/lib/preview-events';
import {
  createPackageDataPlugin,
  resolveAppRoot,
  RESOLVED_PACKAGE_DATA_ID,
} from './vite-app';

const DEFAULT_PORT = 5173;
const DEFAULT_HOST = 'localhost';

/**
 * Starts a real Vite dev server for the authored content package and returns a
 * handle the CLI can drive.
 *
 * The preview runs the same app, components and virtual package-data plugin as
 * the production build, but serves local assets straight from `contentRoot`
 * instead of copying them, and never produces a SCORM ZIP. Updates replace the
 * in-memory package and trigger a full reload, while authoring failures are
 * broadcast as a custom HMR event the app renders as an overlay.
 */
export async function renderReactDevServer(
  contentPackage: ContentPackage,
  options: RendererDevOptions,
): Promise<RendererDevServer> {
  const contentRoot = path.resolve(options.contentRoot);
  const host = options.host ?? DEFAULT_HOST;
  // Vite treats port 0 as "unset" and falls back to 5173, so resolve an
  // ephemeral port ourselves to honour the conventional meaning of 0.
  const port =
    options.port === 0
      ? await findFreePort(host)
      : (options.port ?? DEFAULT_PORT);
  const appRoot = resolveAppRoot(import.meta.url);

  const handle = { current: contentPackage };

  const server = await createServer({
    configFile: false,
    root: appRoot,
    base: '/',
    logLevel: 'warn',
    // Keep Vite's dep cache inside the package's node_modules instead of
    // creating a stray `app/node_modules` directory that would ship.
    cacheDir: path.resolve(appRoot, '..', 'node_modules', '.vite'),
    plugins: [react(), tailwindcss(), createPackageDataPlugin(handle)],
    // Local references in the parsed AST are relative to the package root, so
    // serving that directory as static assets makes them resolve untouched.
    publicDir: existsSync(contentRoot) ? contentRoot : false,
    server: {
      host,
      port,
      // Prefer the requested port but fall back to a free one so `scorm dev`
      // never fails on a busy port.
      strictPort: false,
      fs: {
        allow: [searchForWorkspaceRoot(appRoot), contentRoot],
      },
    },
  });

  await server.listen();

  // Finish the initial dependency scan before returning. Closing the server
  // mid-scan makes Vite log an aborted esbuild scanner error; awaiting the scan
  // also means the preview is fully ready when the URL is printed.
  const optimizer = server.environments.client.depsOptimizer;
  if (optimizer) {
    await optimizer.init();
    await optimizer.scanProcessing;
  }

  const url = resolveServerUrl(server, host, port);

  return {
    url,
    async update(content) {
      handle.current = content;
      invalidatePackageData(server);
      server.ws.send({ type: 'custom', event: PREVIEW_CLEAR_EVENT });
      server.ws.send({ type: 'full-reload' });
    },
    reportError(message) {
      server.ws.send({
        type: 'custom',
        event: PREVIEW_ERROR_EVENT,
        data: { message },
      });
    },
    async close() {
      await server.close();
    },
  };
}

/**
 * Drops the cached transform for the virtual package-data module so the next
 * request (after the reload) re-runs `load` with the replaced package.
 */
function invalidatePackageData(server: ViteDevServer): void {
  const module = server.moduleGraph.getModuleById(RESOLVED_PACKAGE_DATA_ID);
  if (module) {
    server.moduleGraph.invalidateModule(module);
  }
}

function resolveServerUrl(
  server: ViteDevServer,
  host: string,
  port: number,
): string {
  const resolved = server.resolvedUrls;
  const first = resolved?.local[0] ?? resolved?.network[0];
  if (first) {
    return first;
  }
  return `http://${host}:${port}/`;
}

/** Asks the OS for an unused port on `host` (used when port 0 is requested). */
function findFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}
