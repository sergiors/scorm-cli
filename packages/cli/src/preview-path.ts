import { existsSync } from 'node:fs'
import path from 'node:path'

/** Resolve preview content from the repository root, with a cwd fallback. */
export function resolvePreviewContentPath(
  content: string,
  repositoryRoot: string,
  cwd = process.cwd()
): string {
  if (path.isAbsolute(content)) {
    return content
  }

  const fromRepository = path.resolve(repositoryRoot, content)
  if (existsSync(fromRepository)) {
    return fromRepository
  }

  const fromCwd = path.resolve(cwd, content)
  return existsSync(fromCwd) ? fromCwd : fromRepository
}
