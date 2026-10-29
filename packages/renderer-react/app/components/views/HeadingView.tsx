import { InlineContent } from '../InlineContent'
import { readingAnchorAttributes } from '../../lib/reading-anchors'
import type { ContentNodeViewProps } from './types'

const HEADING_TAGS = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6'
} as const

/**
 * Maps an authored Markdown heading depth straight to its HTML level: depth 1
 * is `<h1>`, depth 2 is `<h2>`, and so on. Malformed depths are clamped into
 * the valid 1-6 range so a bad AST can never emit an invalid tag.
 */
function clampHeading(depth: number): keyof typeof HEADING_TAGS {
  const level = Math.min(6, Math.max(1, Math.trunc(depth)))
  return level as keyof typeof HEADING_TAGS
}

export function HeadingView({ node, anchor }: ContentNodeViewProps<'heading'>) {
  const Tag = HEADING_TAGS[clampHeading(node.depth)]
  return (
    <Tag {...readingAnchorAttributes(anchor)}>
      <InlineContent nodes={node.children} />
    </Tag>
  )
}
