import type { Renderer } from '@scorm-cli/core'
import { startDevPackage } from './dev'
import { errorMessage } from './errors'

export interface PreviewCommandOptions {
  port?: string | number
}

/** Loads the renderer the preview should drive (built or workspace source). */
export type PreviewRendererLoader = () => Promise<Renderer>

/**
 * Runs the `preview` command against an explicitly chosen renderer loader.
 *
 * The executable passes its bundled loader, while the source preview entry
 * passes the workspace renderer source. Both then share the same validation,
 * lifecycle, signal handling and output.
 */
export async function runPreviewCommand(
  content: string,
  options: PreviewCommandOptions,
  loadRenderer: PreviewRendererLoader
): Promise<void> {
  try {
    const port = options.port === undefined ? undefined : Number(options.port)
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
      throw new Error('--port must be an integer between 0 and 65535')
    }
    const session = await startDevPackage(content, { port }, { loadRenderer })
    console.log(`Entry: ${session.entrypoint}`)
    console.log(`Preview server: ${session.url}`)

    const stop = (signal: NodeJS.Signals) => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      void session
        .close()
        .catch((error) => {
          console.error(`Error closing preview server: ${errorMessage(error)}`)
        })
        .finally(() => {
          process.exitCode = signal === 'SIGINT' ? 130 : 143
        })
    }
    const onSigint = () => stop('SIGINT')
    const onSigterm = () => stop('SIGTERM')
    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`)
    process.exitCode = 1
  }
}
