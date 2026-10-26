import { Fragment, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { ContentNode, PageNode } from '../types'
import { InlineContent } from './InlineContent'
import { MediaFrame } from './MediaFrame'
import { PathView } from './PathView'
import { QuestionnaireView } from './QuestionnaireView'
import { Video } from './Video'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine
} from './ui/code-block'
import { useHighlightedCode } from '@/hooks/use-highlighted-code'

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

export interface ContentRendererProps {
  nodes: ContentNode[]
  /**
   * The root presentation's pages, so a Path node can resolve its referenced
   * ids to display metadata. Threaded unchanged through nested blocks; only a
   * Scroll or Slides presentation supplies it.
   */
  pathPages?: readonly PageNode[]
  /**
   * Opens a referenced root page through the presentation's existing page
   * switching, without mounting a second copy of the page. Absent when the
   * surrounding presentation cannot switch pages, in which case Path entries
   * render inert.
   */
  onNavigatePathPage?: (pageId: string) => void
}

/**
 * Everything a block view needs beyond its own node. It is exactly the public
 * props minus `nodes`, so the same object can be spread straight back into a
 * recursive {@link ContentRenderer}.
 */
type ContentNodeRenderContext = Omit<ContentRendererProps, 'nodes'>

type ContentNodeType = ContentNode['type']

/** The exact node interface behind a block discriminant, e.g. `ImageNode`. */
type ContentNodeOf<T extends ContentNodeType> = Extract<ContentNode, { type: T }>

/**
 * Props shared by every block view: the exact node interface behind its
 * discriminant plus the threaded render context.
 */
interface ContentNodeViewProps<T extends ContentNodeType> {
  node: ContentNodeOf<T>
  context: ContentNodeRenderContext
}

/**
 * One view per block node type. Mapping over the discriminant makes the
 * registry exhaustive: adding a member to `ContentNode` without providing a
 * view is a compile-time error.
 */
type ContentNodeRenderers = {
  [T in ContentNodeType]: ComponentType<ContentNodeViewProps<T>>
}

function HeadingView({ node }: ContentNodeViewProps<'heading'>) {
  const Tag = HEADING_TAGS[clampHeading(node.depth)]
  return (
    <Tag>
      <InlineContent nodes={node.children} />
    </Tag>
  )
}

function ParagraphView({ node }: ContentNodeViewProps<'paragraph'>) {
  return (
    <p>
      <InlineContent nodes={node.children} />
    </p>
  )
}

function ThematicBreakView() {
  return <hr />
}

/**
 * A single `<li>`. The AST records the inline-vs-block distinction directly:
 * `inlineContent` runs render through {@link InlineContent} without a block
 * wrapper, while every other node recurses through the normal block dispatch,
 * preserving item order, nested blocks, context and keys.
 */
function ListItemView({
  item,
  context
}: {
  item: ContentNodeOf<'list'>['items'][number]
  context: ContentNodeRenderContext
}) {
  return (
    <li>
      {item.children.map((child, index) =>
        child.type === 'inlineContent' ? (
          <InlineContent key={`inlineContent-${index}`} nodes={child.children} />
        ) : (
          <Fragment key={`${child.type}-${index}`}>{renderContentNode(child, context)}</Fragment>
        )
      )}
    </li>
  )
}

function ListView({ node, context }: ContentNodeViewProps<'list'>) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag
      start={node.ordered ? node.start : undefined}
      className={node.ordered ? 'list-decimal' : 'list-disc'}
    >
      {node.items.map((item, index) => (
        <ListItemView key={index} item={item} context={context} />
      ))}
    </ListTag>
  )
}

function CodeView({ node }: ContentNodeViewProps<'code'>) {
  const lines = useHighlightedCode(node.value, node?.language ?? '')

  return (
    <CodeBlock className="not-prose">
      <CodeBlockHeader>
        <CodeBlockActions>
          <CodeBlockCopyButton value={node.value} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent lineNumbers>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function QuoteView({ node, context }: ContentNodeViewProps<'quote'>) {
  return (
    <blockquote className="border-l-4 border-primary/50 bg-secondary/50 py-2 px-6">
      <ContentRenderer nodes={node.children} {...context} />
    </blockquote>
  )
}

/**
 * A block image in the shared {@link MediaFrame}: the AST carries no intrinsic
 * dimensions, so the frame reserves a stable 16:9 box and `object-contain` keeps
 * arbitrary or portrait images uncropped (letterboxed) inside it. The image
 * itself keeps native `loading="lazy"` for deferral, and a static placeholder
 * fills the frame until `onLoad` fires.
 *
 * A failed source settles the frame too: the placeholder yields so the browser's
 * own broken-image indicator and the authored `alt` text are visible, rather than
 * a placeholder that waits on an image that will never arrive.
 *
 * The frame is wrapped in a `figure` and marked `not-prose` for the same reason
 * the video frame is: `prose` gives a `figure` its block spacing while resetting
 * the margins of its direct children, so the framed image sits in the flow
 * without the prose image margins leaking into the reserved box.
 */
function BlockImageView({ node }: ContentNodeViewProps<'image'>) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <figure className={node.caption ? 'space-y-2.5' : undefined}>
      <MediaFrame ready={loaded || failed} className="rounded-2xl not-prose">
        <img
          src={node.src}
          alt={node.alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      </MediaFrame>
      {node.caption ? (
        <figcaption className="text-sm text-muted-foreground">{node.caption}</figcaption>
      ) : null}
    </figure>
  )
}

function VideoView({ node }: ContentNodeViewProps<'video'>) {
  return <Video node={node} />
}

/** Delegates a questionnaire block to the context-aware {@link QuestionnaireView}. */
function QuestionnaireBlockView({ node }: ContentNodeViewProps<'questionnaire'>) {
  return (
    <div className="space-y-4">
      <QuestionnaireView node={node} />
    </div>
  )
}

/**
 * Delegates a Path block to {@link PathView}, translating the threaded context
 * into its props. Navigation stays owned by the presentation, so this only
 * forwards the callback it was given.
 */
function PathBlockView({ node, context }: ContentNodeViewProps<'path'>) {
  return (
    <PathView
      node={node}
      pathPages={context.pathPages}
      onNavigatePathPage={context.onNavigatePathPage}
    />
  )
}

/**
 * Maps every block discriminant to its named view. The registry owns only the
 * dispatch, never the rendering logic itself.
 */
const contentNodeRenderers = {
  heading: HeadingView,
  paragraph: ParagraphView,
  thematicBreak: ThematicBreakView,
  list: ListView,
  code: CodeView,
  quote: QuoteView,
  image: BlockImageView,
  video: VideoView,
  questionnaire: QuestionnaireBlockView,
  path: PathBlockView
} satisfies ContentNodeRenderers

export function ContentRenderer({ nodes, ...context }: ContentRendererProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <Fragment key={`${node.type}-${index}`}>{renderContentNode(node, context)}</Fragment>
      ))}
    </>
  )
}

/**
 * Dispatches a block node to its view. The registry is exhaustive (see
 * {@link ContentNodeRenderers}), so the indexed lookup is total; the cast only
 * expresses the correlation TypeScript cannot follow through a union-indexed
 * lookup — the node's discriminant guarantees the resolved view matches it.
 */
function renderContentNode(node: ContentNode, context: ContentNodeRenderContext): ReactNode {
  if (!Object.hasOwn(contentNodeRenderers, node.type)) {
    // Runtime guard for malformed content: never silently drop a node.
    throw new Error(`Unsupported content node type: ${String(node.type ?? 'unknown')}`)
  }

  const View = contentNodeRenderers[node.type] as ComponentType<{
    node: ContentNode
    context: ContentNodeRenderContext
  }>
  return <View node={node} context={context} />
}
