import type { ContentNodeViewProps } from './types'

export function QuoteView({ node, path, renderNodes }: ContentNodeViewProps<'quote'>) {
  return (
    <blockquote className="border-l-4 border-primary/50 bg-secondary/50 py-2 px-6">
      {renderNodes(node.children, path)}
    </blockquote>
  )
}
