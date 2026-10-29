import type { ComponentType, ReactNode } from 'react'
import type { ContentNode, PageNode } from '../../types'
import type { ReadingAnchor } from '../../lib/reading-anchors'

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
export type ContentNodeRenderContext = Omit<ContentRendererProps, 'nodes'>

export type ContentNodeType = ContentNode['type']

/** The exact node interface behind a block discriminant, e.g. `ImageNode`. */
export type ContentNodeOf<T extends ContentNodeType> = Extract<ContentNode, { type: T }>

/**
 * Renders a nested list of blocks as part of the surrounding renderer. Views
 * that contain blocks call this instead of importing the renderer itself, so
 * the registry stays a one-way dependency.
 */
export type ContentNodeListRenderer = (
  nodes: readonly ContentNode[],
  path: readonly number[]
) => ReactNode

/**
 * Renders one block at an exact authored path. Views that hold a single block
 * call this instead of wrapping it in a list, so the path is not shifted by a
 * singleton index.
 */
export type ContentNodeRenderer = (node: ContentNode, path: readonly number[]) => ReactNode

/**
 * Props shared by every block view: the exact node interface behind its
 * discriminant plus the threaded render context and nested renderers.
 */
export interface ContentNodeViewProps<T extends ContentNodeType> {
  node: ContentNodeOf<T>
  context: ContentNodeRenderContext
  anchor: ReadingAnchor | undefined
  path: readonly number[]
  renderNodes: ContentNodeListRenderer
  renderNode: ContentNodeRenderer
}

/**
 * One view per block node type. Mapping over the discriminant makes the
 * registry exhaustive: adding a member to `ContentNode` without providing a
 * view is a compile-time error.
 */
export type ContentNodeRenderers = {
  [T in ContentNodeType]: ComponentType<ContentNodeViewProps<T>>
}
