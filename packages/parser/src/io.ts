import fs from 'node:fs/promises'
import path from 'node:path'
import { isRemoteReference } from '@scorm-cli/core'
import type { AstNode } from './ast'
import { isOutsideRelativePath, normalizedRelative, sourceLocation } from './shared'

export async function assetReference(
  value: string,
  sourceFile: string,
  root: string,
  file: string,
  node: AstNode
): Promise<string> {
  if (isRemoteReference(value)) return value
  const pathPart = value.split(/[?#]/, 1)[0] ?? ''
  const suffix = value.slice(pathPart.length)
  // Fragment-only and query-only links refer to the current document, not a
  // package asset. They must remain untouched and are not copied.
  if (!pathPart) return value
  let decoded: string
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    throw new Error(
      `${sourceLocation(file, node)}: asset reference "${value}" has invalid URL encoding`
    )
  }
  const absolute = path.resolve(path.dirname(sourceFile), decoded)
  const relative = normalizedRelative(root, absolute, file, node, 'asset reference')
  let stat
  try {
    stat = await fs.stat(absolute)
  } catch {
    throw new Error(`${sourceLocation(file, node)}: asset "${value}" does not exist`)
  }

  if (!stat.isFile()) {
    throw new Error(`${sourceLocation(file, node)}: asset "${value}" is not a file`)
  }

  const realRoot = await fs.realpath(root)
  const realAsset = await fs.realpath(absolute)
  if (isOutsideRelativePath(path.relative(realRoot, realAsset))) {
    throw new Error(
      `${sourceLocation(file, node)}: asset "${value}" resolves outside the content package directory`
    )
  }

  return `${relative}${suffix}`
}

export function sourceNodeId(
  kind: 'question' | 'questionnaire' | 'video',
  node: AstNode,
  file: string,
  root: string,
  sourceLineOffset = 0
): string {
  const relativeFile = normalizedRelative(
    root,
    path.resolve(file),
    file,
    node,
    `${kind === 'question' ? 'Question' : kind === 'questionnaire' ? 'Questionnaire' : 'Video'} source`
  )
  const line = sourceLineOffset + (node.position?.start?.line ?? 1)
  const column = node.position?.start?.column ?? 1
  return `${kind}:${relativeFile}:${line}:${column}`
}

/** Number of frontmatter lines excluded from the MDX parser's node positions. */
export function sourceLineOffset(raw: string, body: string): number {
  const bodyStart = raw.lastIndexOf(body)
  return raw.slice(0, Math.max(0, bodyStart)).split('\n').length - 1
}
