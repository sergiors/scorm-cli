import type { Renderer } from '@scorm-cli/core'
import { reactRenderer } from '@scorm-cli/renderer-react'

/**
 * The renderer is imported statically (not through a variable dynamic import)
 * so the bundler can inline the private `@scorm-cli/renderer-react` package into
 * the shipped executable. Build and dev share this one contract.
 */
export async function loadRenderer(): Promise<Renderer> {
  if (!reactRenderer || typeof reactRenderer.build !== 'function')
    throw new Error('@scorm-cli/renderer-react does not export a valid reactRenderer')
  return reactRenderer
}
