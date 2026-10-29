import { InlineContent } from '../InlineContent'
import { readingAnchorAttributes } from '../../lib/reading-anchors'
import type { ContentNodeViewProps } from './types'

export function ParagraphView({ node, anchor }: ContentNodeViewProps<'paragraph'>) {
  return (
    <p {...readingAnchorAttributes(anchor)}>
      <InlineContent nodes={node.children} />
    </p>
  )
}
