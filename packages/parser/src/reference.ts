import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type { ContentNode, PageNode, ItemNode } from '@scorm-cli/core'
import type { AstNode } from './ast'
import {
  assertFrontmatterKeys,
  isOutsideRelativePath,
  sourceLocation,
  normalizedRelative,
  optionalString,
  requiredString
} from './shared'
import { parseMdx } from './mdx'
import { parseContentNodes } from './content'
import { sourceLineOffset } from './io'

export function parseReference(
  kind: 'page',
  src: string,
  node: AstNode,
  declaredIn: string,
  root: string,
  ids: Set<string>,
  rootPageSources?: Set<string>
): Promise<PageNode>
export function parseReference(
  kind: 'item',
  src: string,
  node: AstNode,
  declaredIn: string,
  root: string,
  ids: Set<string>
): Promise<ItemNode>
export async function parseReference(
  kind: 'page' | 'item',
  src: string,
  node: AstNode,
  declaredIn: string,
  root: string,
  ids: Set<string>,
  rootPageSources?: Set<string>
): Promise<PageNode | ItemNode> {
  const sourcePath = path.resolve(path.dirname(declaredIn), src)
  const source = normalizedRelative(
    root,
    sourcePath,
    declaredIn,
    node,
    `${kind === 'page' ? 'Page' : 'Item'} src`
  )
  let raw: string
  try {
    raw = await fs.readFile(sourcePath, 'utf8')
  } catch {
    throw new Error(
      `${sourceLocation(declaredIn, node)}: ${kind === 'page' ? 'Page' : 'Item'} source "${src}" does not exist`
    )
  }
  const realRoot = await fs.realpath(root)
  const realSource = await fs.realpath(sourcePath)
  if (isOutsideRelativePath(path.relative(realRoot, realSource))) {
    throw new Error(
      `${sourceLocation(declaredIn, node)}: ${kind === 'page' ? 'Page' : 'Item'} source "${src}" resolves outside the content package directory`
    )
  }
  const parsed = matter(raw)
  const lineOffset = sourceLineOffset(raw, parsed.content)
  assertFrontmatterKeys(
    parsed.data,
    kind === 'page' ? ['title', 'description'] : ['title'],
    sourcePath
  )
  const title = requiredString(parsed.data.title, 'title', sourcePath, {
    type: 'frontmatter'
  })

  const id = `${kind}:${source}`
  if (ids.has(id)) {
    throw new Error(`${sourceLocation(sourcePath, node)}: duplicate package node id "${id}"`)
  }
  ids.add(id)

  const description =
    kind === 'page'
      ? optionalString(parsed.data.description, 'description', sourcePath, {
          type: 'frontmatter'
        })
      : undefined
  const metadata = { title, ...(description ? { description } : {}) }
  const tree = parseMdx(parsed.content, sourcePath)
  const content: ContentNode[] = []
  for (const child of tree.children) {
    if (child.type === 'mdxjsEsm') {
      throw new Error(`${sourceLocation(sourcePath, child)}: MDX JavaScript is not supported`)
    }

    content.push(
      ...(await parseContentNodes(
        child,
        sourcePath,
        root,
        kind === 'page' ? rootPageSources : undefined,
        lineOffset,
        tree.sourceText
      ))
    )
  }

  if (kind === 'page') {
    return {
      type: 'page',
      id,
      source,
      metadata,
      content
    }
  }

  return {
    type: 'item',
    id,
    source,
    metadata: { title },
    content
  }
}
