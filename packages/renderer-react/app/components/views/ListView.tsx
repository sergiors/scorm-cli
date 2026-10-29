import { Fragment } from 'react'
import { InlineContent } from '../InlineContent'
import type { ContentNodeOf, ContentNodeRenderer, ContentNodeViewProps } from './types'

/**
 * A single `<li>`. The AST records the inline-vs-block distinction directly:
 * `inlineContent` runs render through {@link InlineContent} without a block
 * wrapper, while every other node recurses through the single-node renderer at
 * its exact path, preserving item order, nested blocks, context and keys.
 */
function ListItemView({
  item,
  path,
  renderNode
}: {
  item: ContentNodeOf<'list'>['items'][number]
  path: readonly number[]
  renderNode: ContentNodeRenderer
}) {
  return (
    <li>
      {item.children.map((child, index) =>
        child.type === 'inlineContent' ? (
          <InlineContent key={`inlineContent-${index}`} nodes={child.children} />
        ) : (
          <Fragment key={`${child.type}-${index}`}>{renderNode(child, [...path, index])}</Fragment>
        )
      )}
    </li>
  )
}

export function ListView({ node, path, renderNode }: ContentNodeViewProps<'list'>) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag
      start={node.ordered ? node.start : undefined}
      className={node.ordered ? 'list-decimal' : 'list-disc'}
    >
      {node.items.map((item, index) => (
        <ListItemView key={index} item={item} path={[...path, index]} renderNode={renderNode} />
      ))}
    </ListTag>
  )
}
