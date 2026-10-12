import { isJsx, type AstNode } from './ast'

/**
 * Canonical component name for every parsed JSX node, resolved from
 * `scorm-cli/authoring` imports.
 *
 * MDX normalization stores the result directly on each JSX node. The fallback
 * to the raw name supports small parser helpers that receive constructed nodes
 * in focused unit tests.
 */
export function componentName(node: AstNode): string {
  if (isJsx(node)) {
    return node.canonicalName ?? node.name ?? ''
  }
  return ''
}
