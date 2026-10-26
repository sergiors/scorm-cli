import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
// `tsconfig.preview.json` maps this package import to the renderer's
// TypeScript source. The executable keeps importing the built export through
// `./renderer`, so this source-only resolution is never part of the package.
import { reactRenderer } from '@scorm-cli/renderer-react'
import { runPreviewCommand } from './preview-command'
import { resolvePreviewContentPath } from './preview-path'

/**
 * Development-only entry point for `pnpm preview`.
 *
 * It deliberately imports the renderer from TypeScript source rather than the
 * package export (`dist/index.js`), so Vite serves and watches the workspace app
 * and React Fast Refresh works without a `tsup` build. This file is not a `tsup`
 * entry, so the packaged CLI and `scorm build` never resolve workspace source.
 */

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

const cli = cac('scorm-cli')

cli
  .command('preview <content>', 'Preview authored content from source with live HMR')
  .option('-p, --port <port>', 'Port for the local preview server')
  .example('pnpm preview examples/typescript-content')
  .action((content: string, options: { port?: string | number }) =>
    runPreviewCommand(
      resolvePreviewContentPath(content, repositoryRoot),
      options,
      async () => reactRenderer
    )
  )

cli.help()
cli.parse()
