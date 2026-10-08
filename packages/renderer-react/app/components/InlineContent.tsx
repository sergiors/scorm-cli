import { Fragment } from 'react';
import type { ComponentType, ReactNode } from 'react';
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

type InlineNodeType = InlineNode['type'];

/** The exact node interface behind an inline discriminant, e.g. `LinkNode`. */
type InlineNodeOf<T extends InlineNodeType> = Extract<InlineNode, { type: T }>;

/**
 * Props shared by every inline view: the exact node interface behind its
 * discriminant.
 */
interface InlineNodeViewProps<T extends InlineNodeType> {
  node: InlineNodeOf<T>;
}

/**
 * One view per inline node type. Mapping over the discriminant makes the
 * registry exhaustive: adding a member to `InlineNode` without providing a view
 * is a compile-time error.
 */
type InlineNodeRenderers = {
  [T in InlineNodeType]: ComponentType<InlineNodeViewProps<T>>;
};

function TextView({ node }: InlineNodeViewProps<'text'>) {
  return <>{node.value}</>;
}

function EmphasisView({ node }: InlineNodeViewProps<'emphasis'>) {
  return (
    <em className='italic'>
      <InlineContent nodes={node.children} />
    </em>
  );
}

function StrongView({ node }: InlineNodeViewProps<'strong'>) {
  return (
    <strong className='font-semibold text-foreground'>
      <InlineContent nodes={node.children} />
    </strong>
  );
}

function InlineCodeView({ node }: InlineNodeViewProps<'inlineCode'>) {
  return <code className='font-mono not-prose'>{node.value}</code>;
}

function LinkView({ node }: InlineNodeViewProps<'link'>) {
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

function InlineImageView({ node }: InlineNodeViewProps<'image'>) {
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

function BreakView() {
  return <br />;
}

/**
 * Maps every inline discriminant to its named view. The registry owns only the
 * dispatch, never the rendering logic itself.
 */
const inlineNodeRenderers = {
  text: TextView,
  emphasis: EmphasisView,
  strong: StrongView,
  inlineCode: InlineCodeView,
  link: LinkView,
  image: InlineImageView,
  break: BreakView,
} satisfies InlineNodeRenderers;

export function InlineContent({ nodes }: InlineContentProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={`${node.type}-${index}`}>
          {renderInlineNode(node)}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Dispatches an inline node to its view. The registry is exhaustive (see
 * {@link InlineNodeRenderers}), so the indexed lookup is total; the cast only
 * expresses the correlation TypeScript cannot follow through a union-indexed
 * lookup — the node's discriminant guarantees the resolved view matches it.
 */
function renderInlineNode(node: InlineNode): ReactNode {
  if (!Object.hasOwn(inlineNodeRenderers, node.type)) {
    // Runtime guard for malformed content: never silently drop a node.
    throw new Error(
      `Unsupported inline node type: ${String(node.type ?? 'unknown')}`,
    );
  }
  const View = inlineNodeRenderers[node.type] as ComponentType<{
    node: InlineNode;
  }>;
  return <View node={node} />;
}
