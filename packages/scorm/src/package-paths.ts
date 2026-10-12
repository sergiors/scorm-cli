import path from 'node:path'
import type { RenderResult } from '@scorm-cli/core'

/** Resolves and validates the renderer entrypoint before packaging performs any I/O. */
export function resolveRendererEntrypoint(renderResult: RenderResult): string {
  const sourceDirectory = path.resolve(renderResult.directory)
  const sourceEntrypoint = path.resolve(sourceDirectory, renderResult.entrypoint)
  const relativeEntrypoint = path.relative(sourceDirectory, sourceEntrypoint)

  if (
    relativeEntrypoint === '..' ||
    relativeEntrypoint.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeEntrypoint)
  ) {
    throw new Error('renderer entrypoint must be inside its output directory')
  }
  if (path.basename(relativeEntrypoint) !== 'index.html') {
    throw new Error('renderer entrypoint must be named index.html')
  }
  if (path.dirname(relativeEntrypoint) !== '.') {
    throw new Error('renderer entrypoint must be at the root of its output directory')
  }

  return relativeEntrypoint
}
