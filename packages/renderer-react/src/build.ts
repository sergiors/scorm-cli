import fs from 'node:fs/promises'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { ContentPackage } from '@scorm-cli/core'
import { build as viteBuild } from 'vite'
import type { RenderAsset, RenderOptions, RenderResult } from './types'
import { createPackageDataPlugin, ENTRYPOINT, resolveAppRoot, resolveCoreEntry } from './vite-app'

function resolveAssetTargets(
  assets: RenderAsset[] | undefined,
  outputDirectory: string
): Array<{ source: string; destination: string }> {
  if (!assets || assets.length === 0) {
    return []
  }

  const root = path.resolve(outputDirectory)

  return assets.map((asset) => {
    const destination = path.resolve(root, asset.targetPath)
    if (destination !== root && !destination.startsWith(root + path.sep)) {
      throw new Error(`Asset target path escapes the output directory: ${asset.targetPath}`)
    }
    return { source: asset.sourcePath, destination }
  })
}

async function copyAssets(targets: Array<{ source: string; destination: string }>): Promise<void> {
  for (const target of targets) {
    await fs.mkdir(path.dirname(target.destination), { recursive: true })
    await fs.copyFile(target.source, target.destination)
  }
}

/**
 * Builds a standalone static React view for `contentPackage` into
 * `options.outputDirectory`, returning the generated entrypoint.
 *
 * The content package must already be parsed; this renderer never reads or
 * parses MDX.
 */
export async function renderReactPackage(
  contentPackage: ContentPackage,
  options: RenderOptions
): Promise<RenderResult> {
  if (!options?.outputDirectory) {
    throw new Error('renderReactPackage requires an outputDirectory option.')
  }

  const outputDirectory = path.resolve(options.outputDirectory)
  const appRoot = resolveAppRoot(import.meta.url)
  const indexHtml = path.join(appRoot, ENTRYPOINT)
  const coreEntry = resolveCoreEntry(appRoot)

  await fs.mkdir(outputDirectory, { recursive: true })

  const assetTargets = resolveAssetTargets(options.assets, outputDirectory)

  // Generated shadcn components import through the `@/` alias; resolve it to the
  // app directory. When the renderer runs from its own workspace the app's
  // `@scorm-cli/core` import resolves to the workspace package normally; when it
  // runs from the bundled CLI it is aliased to the browser core copy the CLI
  // build emits next to its executable.
  const alias: Record<string, string> = { '@': appRoot }
  if (coreEntry) {
    alias['@scorm-cli/core'] = coreEntry
  }

  await viteBuild({
    configFile: false,
    root: appRoot,
    base: './',
    logLevel: 'warn',
    resolve: { alias },
    plugins: [react(), tailwindcss(), createPackageDataPlugin({ current: contentPackage })],
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: {
        input: indexHtml,
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]'
        }
      }
    }
  })

  await copyAssets(assetTargets)

  return { directory: outputDirectory, entrypoint: ENTRYPOINT }
}
