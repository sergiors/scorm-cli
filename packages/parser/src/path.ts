import path from 'node:path'
import type { PathNode } from '@scorm-cli/core'
import type { AstNode, ContentSource } from './ast'
import { isJsx, meaningfulChildren, rawComponentName, whitespace } from './ast'
import { componentName } from './component-name'
import {
  assertAttributes,
  attrs,
  normalizedRelative,
  requiredString,
  sourceLocation
} from './shared'

/**
 * Converts a `<Path>` authoring component into ordered references to existing
 * root Scroll page IDs. A Path may contain only self-closing `<Page ref="..." />`
 * children, and each ref must match a page declared directly in the root
 * `<Scroll>` presentation.
 */
export async function parsePath(node: AstNode, source: ContentSource): Promise<PathNode> {
  const { sourceFile: file, root, rootPageSources } = source
  const values = attrs(node, file)
  assertAttributes(values, [], file, node)

  const children = (node.children ?? [])
    .flatMap((child) => {
      if (
        child.type === 'paragraph' &&
        (child.children ?? []).every(
          (nested) => whitespace(nested) || (isJsx(nested) && componentName(nested) === 'Page')
        )
      ) {
        return child.children ?? []
      }

      return [child]
    })
    .filter((child) => !whitespace(child))

  if (children.length === 0) {
    throw new Error(
      `${sourceLocation(file, node)}: Path requires at least one direct <Page ref="..." /> child`
    )
  }

  const pageIds: string[] = []
  const seen = new Set<string>()

  for (const child of children) {
    if (child.type !== 'mdxJsxFlowElement' || componentName(child) !== 'Page') {
      const name = rawComponentName(child)
      const found = name ? `<${name}>` : child.type
      throw new Error(
        `${sourceLocation(file, child)}: Path may contain only direct <Page ref="..." /> children; found ${found}`
      )
    }

    if (meaningfulChildren(child.children ?? []).length > 0) {
      throw new Error(
        `${sourceLocation(file, child)}: <Page> inside <Path> must be self-closing and cannot contain children`
      )
    }

    const pageValues = attrs(child, file)
    assertAttributes(pageValues, ['ref'], file, child)
    const ref = requiredString(pageValues.ref, 'ref', file, child)
    if (!rootPageSources) {
      throw new Error(
        `${sourceLocation(file, child)}: Path references are only valid for pages declared directly in a root <Scroll> presentation`
      )
    }

    const source = normalizedRelative(root, path.resolve(root, ref), file, child, 'Path Page ref')
    if (!rootPageSources.has(source)) {
      throw new Error(
        `${sourceLocation(file, child)}: Path Page ref "${ref}" does not match a root <Page src="..." /> in the root <Scroll> presentation`
      )
    }

    if (seen.has(source)) {
      throw new Error(`${sourceLocation(file, child)}: duplicate Path Page ref "${ref}"`)
    }
    seen.add(source)
    pageIds.push(`page:${source}`)
  }

  return { type: 'path', pageIds }
}
