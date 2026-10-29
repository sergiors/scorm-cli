import { Fragment, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import {
  CodeIcon,
  Info,
  Lightbulb,
  OctagonAlert,
  StickyNote,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import type { CalloutVariant, ContentNode, PageNode } from '../types'
import {
  readingAnchorAt,
  readingAnchorAttributes,
  readingAnchorsForPage,
  type ReadingAnchor
} from '../lib/reading-anchors'
import { InlineContent } from './InlineContent'
import { MediaFrame } from './MediaFrame'
import { PathView } from './PathView'
import { QuestionnaireView } from './QuestionnaireView'
import { Video } from './Video'
import { cn } from '../lib/utils'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle
} from './ui/code-block'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Alert, AlertDescription, AlertTitle } from './ui/alert'
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
  /**
   * The owning page/item ID. Supplying it enables deterministic reading anchors
   * for eligible blocks; the Tiles presentation deliberately does not supply it.
   */
  readingAnchorPageId?: string
  /** @internal The page's anchor map, shared by nested renderers. */
  readingAnchors?: ReadonlyMap<string, ReadingAnchor>
  /** @internal The authored path of this renderer within the page. */
  readingAnchorPath?: readonly number[]
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
  anchor: ReadingAnchor | undefined
  path: readonly number[]
}

/**
 * One view per block node type. Mapping over the discriminant makes the
 * registry exhaustive: adding a member to `ContentNode` without providing a
 * view is a compile-time error.
 */
type ContentNodeRenderers = {
  [T in ContentNodeType]: ComponentType<ContentNodeViewProps<T>>
}

function HeadingView({ node, anchor }: ContentNodeViewProps<'heading'>) {
  const Tag = HEADING_TAGS[clampHeading(node.depth)]
  return (
    <Tag {...readingAnchorAttributes(anchor)}>
      <InlineContent nodes={node.children} />
    </Tag>
  )
}

function ParagraphView({ node, anchor }: ContentNodeViewProps<'paragraph'>) {
  return (
    <p {...readingAnchorAttributes(anchor)}>
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
  context,
  path
}: {
  item: ContentNodeOf<'list'>['items'][number]
  context: ContentNodeRenderContext
  path: readonly number[]
}) {
  return (
    <li>
      {item.children.map((child, index) =>
        child.type === 'inlineContent' ? (
          <InlineContent key={`inlineContent-${index}`} nodes={child.children} />
        ) : (
          <Fragment key={`${child.type}-${index}`}>
            {renderContentNode(child, context, [...path, index], undefined)}
          </Fragment>
        )
      )}
    </li>
  )
}

function ListView({ node, context, path }: ContentNodeViewProps<'list'>) {
  const ListTag = node.ordered ? 'ol' : 'ul'
  return (
    <ListTag
      start={node.ordered ? node.start : undefined}
      className={node.ordered ? 'list-decimal' : 'list-disc'}
    >
      {node.items.map((item, index) => (
        <ListItemView key={index} item={item} context={context} path={[...path, index]} />
      ))}
    </ListTag>
  )
}

const TABLE_CELL_ALIGNMENT = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right'
} as const

/** The prose table keeps semantic markup; only column alignment becomes a class. */
function tableCellAlignment(cell: ContentNodeOf<'table'>['header']['cells'][number]) {
  return cell.align ? TABLE_CELL_ALIGNMENT[cell.align] : undefined
}

/**
 * A Markdown table built from the shared shadcn table primitives. `Table` owns
 * the horizontal overflow wrapper, so a wide table scrolls inside its prose
 * column instead of widening the page; native table semantics and column
 * alignment are preserved, and every cell shares {@link InlineContent}.
 */
function TableView({ node }: ContentNodeViewProps<'table'>) {
  return (
    <Table className="not-prose pointer-events-none">
      <TableHeader>
        <TableRow>
          {node.header.cells.map((cell, index) => (
            <TableHead
              key={index}
              scope="col"
              className={cn('whitespace-normal', tableCellAlignment(cell))}
            >
              <InlineContent nodes={cell.children} />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {node.rows.map((row, rowIndex) => (
          <TableRow key={rowIndex}>
            {row.cells.map((cell, cellIndex) => (
              <TableCell
                key={cellIndex}
                className={cn('whitespace-normal', tableCellAlignment(cell))}
              >
                <InlineContent nodes={cell.children} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const LANGUAGE_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript (TSX)',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JavaScript (JSX)',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Bash',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown'
}

function CodeView({ node, anchor }: ContentNodeViewProps<'code'>) {
  const language = node.language?.toLowerCase() ?? ''
  const lines = useHighlightedCode(node.value, language)
  const title = LANGUAGE_LABELS[language] ?? (language || 'Plain text')

  return (
    <div {...readingAnchorAttributes(anchor)}>
      <CodeBlock className="not-prose">
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeIcon /> {title}
          </CodeBlockTitle>
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
    </div>
  )
}

function QuoteView({ node, context, path }: ContentNodeViewProps<'quote'>) {
  return (
    <blockquote className="border-l-4 border-primary/50 bg-secondary/50 py-2 px-6">
      <ContentRenderer nodes={node.children} {...context} readingAnchorPath={path} />
    </blockquote>
  )
}

const CALLOUT_VARIANTS = {
  note: {
    icon: StickyNote,
    surface: 'border-border bg-muted/40 text-muted-foreground'
  },
  info: {
    icon: Info,
    surface: 'border-sky-500/30 bg-sky-500/5 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400'
  },
  tip: {
    icon: Lightbulb,
    surface:
      'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
  },
  warning: {
    icon: TriangleAlert,
    surface:
      'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
  },
  danger: {
    icon: OctagonAlert,
    surface: 'border-destructive/30 bg-destructive/5 text-destructive dark:bg-destructive/10'
  }
} as const satisfies Record<CalloutVariant, { icon: LucideIcon; surface: string }>

function CalloutView({ node, context, path }: ContentNodeViewProps<'callout'>) {
  const { icon: Icon, surface } = CALLOUT_VARIANTS[node.variant]

  return (
    <Alert role="note" data-slot="callout" data-variant={node.variant} className={surface}>
      <Icon aria-hidden="true" />
      {node.title ? <AlertTitle className="mb-2.5">{node.title}</AlertTitle> : null}
      <AlertDescription className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 overflow-x-auto">
        <ContentRenderer nodes={node.children} {...context} readingAnchorPath={path} />
      </AlertDescription>
    </Alert>
  )
}

/**
 * A block accordion. Its open state is presentation-only, so the component is
 * deliberately uncontrolled: the authored `defaultOpen` flags become the
 * primitive's default values, and the learner's toggles never reach the player
 * state. Single-open and multiple-open modes are separate Root variants because
 * the wrapper accepts a different value shape for each; `collapsible` is
 * meaningful only for a single-open accordion and is translated to Base UI's
 * always-collapsible behavior.
 *
 * Section bodies recurse through {@link ContentRenderer} with the item index
 * appended to the reading-anchor path, matching the anchor traversal so nested
 * questionnaires, videos, paths and other blocks behave exactly as they do at
 * the page level.
 */
function AccordionView({ node, context, path }: ContentNodeViewProps<'accordion'>) {
  const values = node.items.map((_, index) => `item-${index}`)
  const openValues = values.filter((_, index) => node.items[index].defaultOpen)

  const items = node.items.map((item, index) => (
    <AccordionItem key={values[index]} value={values[index]} className="[&>h3]:my-0">
      <AccordionTrigger>
        <InlineContent nodes={item.title} />
      </AccordionTrigger>
      <AccordionContent className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ContentRenderer nodes={item.content} {...context} readingAnchorPath={[...path, index]} />
      </AccordionContent>
    </AccordionItem>
  ))

  if (node.multiple) {
    return (
      <Accordion type="multiple" defaultValue={openValues}>
        {items}
      </Accordion>
    )
  }

  return (
    <Accordion type="single" collapsible={node.collapsible} defaultValue={openValues[0]}>
      {items}
    </Accordion>
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
function BlockImageView({ node, anchor }: ContentNodeViewProps<'image'>) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <figure {...readingAnchorAttributes(anchor)} className="not-prose space-y-2.5">
      <MediaFrame ready={loaded || failed}>
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

function VideoView({ node, anchor }: ContentNodeViewProps<'video'>) {
  return (
    <div {...readingAnchorAttributes(anchor)}>
      <Video node={node} />
    </div>
  )
}

/** Delegates a questionnaire block to the context-aware {@link QuestionnaireView}. */
function QuestionnaireBlockView({ node, anchor }: ContentNodeViewProps<'questionnaire'>) {
  return (
    <div {...readingAnchorAttributes(anchor)} className="space-y-4 sm:space-y-6">
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
  table: TableView,
  code: CodeView,
  quote: QuoteView,
  callout: CalloutView,
  image: BlockImageView,
  video: VideoView,
  questionnaire: QuestionnaireBlockView,
  accordion: AccordionView,
  path: PathBlockView
} satisfies ContentNodeRenderers

export function ContentRenderer({
  nodes,
  readingAnchorPageId,
  readingAnchors,
  readingAnchorPath,
  ...context
}: ContentRendererProps) {
  const generatedAnchors = useMemo(
    () =>
      readingAnchors ??
      (readingAnchorPageId === undefined
        ? undefined
        : readingAnchorsForPage(readingAnchorPageId, nodes)),
    [nodes, readingAnchorPageId, readingAnchors]
  )
  const anchors = readingAnchors ?? generatedAnchors
  const path = readingAnchorPath ?? []
  const renderContext: ContentNodeRenderContext = {
    ...context,
    readingAnchorPageId,
    readingAnchors: anchors
  }

  return (
    <>
      {nodes.map((node, index) => {
        const nodePath = [...path, index]
        return (
          <Fragment key={`${node.type}-${index}`}>
            {renderContentNode(node, renderContext, nodePath, readingAnchorAt(anchors, nodePath))}
          </Fragment>
        )
      })}
    </>
  )
}

/**
 * Dispatches a block node to its view. The registry is exhaustive (see
 * {@link ContentNodeRenderers}), so the indexed lookup is total; the cast only
 * expresses the correlation TypeScript cannot follow through a union-indexed
 * lookup — the node's discriminant guarantees the resolved view matches it.
 */
function renderContentNode(
  node: ContentNode,
  context: ContentNodeRenderContext,
  path: readonly number[],
  anchor: ReadingAnchor | undefined
): ReactNode {
  if (!Object.hasOwn(contentNodeRenderers, node.type)) {
    // Runtime guard for malformed content: never silently drop a node.
    throw new Error(`Unsupported content node type: ${String(node.type ?? 'unknown')}`)
  }

  const View = contentNodeRenderers[node.type] as ComponentType<{
    node: ContentNode
    context: ContentNodeRenderContext
    anchor: ReadingAnchor | undefined
    path: readonly number[]
  }>
  return <View node={node} context={context} anchor={anchor} path={path} />
}
