import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { defineConfig } from 'tsup'

const scormRoot = fileURLToPath(new URL('.', import.meta.url))
const codecAsset = path.join(scormRoot, 'dist', 'browser-codec.js')

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  // Generate the synchronous runtime asset from the canonical codec source
  // graph. It is a normal build output, not a committed/generated source file.
  onSuccess: async () => {
    const result = buildSync({
      entryPoints: [path.join(scormRoot, 'src', 'browser-codec-entry.ts')],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      globalName: '__scormCodec',
      target: 'es2017',
      minify: true,
      legalComments: 'none',
      logLevel: 'silent',
      write: false
    })
    await mkdir(path.dirname(codecAsset), { recursive: true })
    await writeFile(codecAsset, result.outputFiles[0]!.text)
  }
})
