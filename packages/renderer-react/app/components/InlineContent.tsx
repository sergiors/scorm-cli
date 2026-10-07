import { ExternalLink } from 'lucide-react';
import type { InlineNode } from '../types';
import { cn } from '../lib/utils';

/**
 * Renders a run of inline nodes inside a single flow context (a paragraph, a
 * heading, a link label, ...).
 *
 * Inline nodes never render block layout. In particular, a Markdown inline
 * image is emitted as a plain `<img>` (optionally wrapped in a `<span>` when it
 * carries a caption) so it stays valid inside phrasing content instead of
 * introducing a `<figure>`/`<figcaption>` block.
 */
export interface InlineContentProps {
  nodes: InlineNode[];
}

export function InlineContent({ nodes }: InlineContentProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNodeView key={`${node.type}-${index}`} node={node} />
      ))}
    </>
  );
}

function InlineNodeView({ node }: { node: InlineNode }) {
  switch (node.type) {
    case 'text':
      return <>{node.value}</>;
    case 'emphasis':
      return (
        <em className='italic'>
          <InlineContent nodes={node.children} />
        </em>
      );
    case 'strong':
      return (
        <strong className='font-semibold text-foreground'>
          <InlineContent nodes={node.children} />
        </strong>
      );
    case 'inlineCode':
      return (
        <code className='rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.85em] text-foreground'>
          {node.value}
        </code>
      );
    case 'link': {
      const isExternal = /^https?:\/\//i.test(node.href);
      return (
        <a
          href={node.href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer noopener' : undefined}
          className='font-medium text-primary underline underline-offset-4 hover:text-primary/80'
        >
          <InlineContent nodes={node.children} />
          {isExternal ? (
            <ExternalLink
              aria-hidden='true'
              className='ml-0.5 inline size-3.5 align-[-0.15em]'
            />
          ) : null}
        </a>
      );
    }
    case 'image': {
      const image = (
        <img
          src={node.src}
          alt={node.alt}
          loading='lazy'
          className={cn(
            'h-auto max-w-full rounded',
            node.caption ? undefined : 'inline align-middle',
          )}
        />
      );
      if (!node.caption) {
        return image;
      }
      return (
        <span className='inline-flex flex-col items-start align-middle'>
          {image}
          <span className='text-xs text-muted-foreground'>{node.caption}</span>
        </span>
      );
    }
    case 'break':
      return <br />;
    default: {
      // Runtime guard for malformed content: never silently drop a node.
      const unknown = node as { type?: unknown };
      throw new Error(
        `Unsupported inline node type: ${String(unknown.type ?? 'unknown')}`,
      );
    }
  }
}
