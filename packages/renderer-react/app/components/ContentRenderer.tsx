import { Fragment, useMemo } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { ContentNode } from '../types'
import { readingAnchorAt, readingAnchorsForPage } from '../lib/reading-anchors'
import type { ReadingAnchor } from '../lib/reading-anchors'
import { AccordionView } from './views/AccordionView'
import { CalloutView } from './views/CalloutView'
import { CodeView } from './views/CodeView'
import { HeadingView } from './views/HeadingView'
import { ImageView } from './views/ImageView'
import { ListView } from './views/ListView'
import { ParagraphView } from './views/ParagraphView'
import { PathView } from './views/PathView'
import { QuestionnaireView } from './views/QuestionnaireView'
import { QuoteView } from './views/QuoteView'
import { TableView } from './views/TableView'
import { ThematicBreakView } from './views/ThematicBreakView'
import { VideoView } from './views/VideoView'
import type {
  ContentNodeListRenderer,
  ContentNodeRenderContext,
  ContentNodeRenderer,
  ContentNodeRenderers,
  ContentRendererProps
} from './views/types'

export type { ContentRendererProps } from './views/types'

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
  image: ImageView,
  video: VideoView,
  questionnaire: QuestionnaireView,
  accordion: AccordionView,
  path: PathView
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

  const renderNode: ContentNodeRenderer = (node, nodePath) =>
    renderContentNode(
      node,
      renderContext,
      nodePath,
      readingAnchorAt(anchors, nodePath),
      renderNodes,
      renderNode
    )

  const renderNodes: ContentNodeListRenderer = (childNodes, childPath) => (
    <>
      {childNodes.map((child, index) => {
        const nodePath = [...childPath, index]
        return <Fragment key={`${child.type}-${index}`}>{renderNode(child, nodePath)}</Fragment>
      })}
    </>
  )

  return <>{renderNodes(nodes, path)}</>
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
  anchor: ReadingAnchor | undefined,
  renderNodes: ContentNodeListRenderer,
  renderNode: ContentNodeRenderer
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
    renderNodes: ContentNodeListRenderer
    renderNode: ContentNodeRenderer
  }>
  return (
    <View
      node={node}
      context={context}
      anchor={anchor}
      path={path}
      renderNodes={renderNodes}
      renderNode={renderNode}
    />
  )
}
