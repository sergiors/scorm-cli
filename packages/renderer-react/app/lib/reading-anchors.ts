import type { ContentNode, InlineNode } from '../types'

/** The attribute a rendered anchor block exposes to the scroll tracker. */
export const READING_ANCHOR_ATTRIBUTE = 'data-reading-anchor'

/** The page/item that owns an anchor element. */
export const READING_ANCHOR_PAGE_ATTRIBUTE = 'data-reading-anchor-page'

/** The mounted page/item wrapper an anchor belongs to. */
export const READING_PAGE_ATTRIBUTE = 'data-reading-page'

/** One anchorable block in a page, ready to spread onto its DOM element. */
export interface ReadingAnchor {
  id: string
  pageId: string
}

/** The canonical, presentation-free form of a block that can own an anchor. */
function normalizedInline(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return `t:${node.value.replace(/\r\n?/g, '\n')}`
        case 'emphasis':
          return `em:${normalizedInline(node.children)}`
        case 'strong':
          return `strong:${normalizedInline(node.children)}`
        case 'inlineCode':
          return `code:${node.value.replace(/\r\n?/g, '\n')}`
        case 'link':
          return `link:${node.href}:${normalizedInline(node.children)}`
        case 'image':
          return `image:${node.src}:${node.alt}:${node.caption ?? ''}`
        case 'break':
          return 'break'
      }
    })
    .join('|')
}

/**
 * The static authored identity of an anchorable block. This deliberately
 * includes the block type and every persisted field but never learner state, a
 * render index, a pixel offset, or an interactive control.
 */
function normalizedBlock(node: ContentNode): string | null {
  switch (node.type) {
    case 'heading':
      return `heading:${node.depth}:${normalizedInline(node.children)}`
    case 'paragraph':
      return `paragraph:${normalizedInline(node.children)}`
    case 'image':
      return `image:${node.src}:${node.alt}:${node.caption ?? ''}`
    case 'video':
      return [
        'video',
        node.provider,
        node.src,
        node.title ?? '',
        node.poster ?? '',
        node.captions ?? ''
      ].join(':')
    case 'code':
      return `code:${node.language ?? ''}:${node.value.replace(/\r\n?/g, '\n')}`
    case 'questionnaire':
      return [
        'questionnaire',
        node.contributesToScore ? '1' : '0',
        String(node.maxAttempts),
        node.expanded ? 'expanded' : 'collapsed',
        ...node.questions.map((question) =>
          [
            question.questionType,
            question.prompt.replace(/\r\n?/g, '\n'),
            ...question.options.map((option) =>
              [option.value, option.correct ? '1' : '0', option.content].join(':')
            )
          ].join('|')
        )
      ].join(':')
    case 'list':
    case 'quote':
    case 'accordion':
    case 'table':
    case 'thematicBreak':
    case 'path':
      return null
  }
}

/** A compact, stable hash. The output is exactly eight base-36 characters. */
function hashAnchor(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code + index
    second = Math.imul(second, 0x5bd1e995)
  }
  const head = (first >>> 0).toString(36).padStart(7, '0').slice(-7)
  const tail = (second >>> 0).toString(36).slice(-1)
  return `${head}${tail}`
}

/**
 * A compact, deterministic ID for one authored block. The page/item ID is part
 * of the hash, so persisted anchor values remain compact and page-specific.
 */
export function readingAnchorId(pageId: string, node: ContentNode, occurrence = 0): string {
  const canonical = normalizedBlock(node)
  if (canonical === null) {
    throw new Error(`Content node ${node.type} cannot own a reading anchor`)
  }
  return hashAnchor(`${pageId}\u0000${canonical}\u0000${occurrence}`)
}

function pathKey(path: readonly number[]): string {
  return path.join('.')
}

/**
 * Builds every anchor for a page in authored order. Paths mirror the render
 * traversal, so nested blocks inside a quote or an accordion section are
 * anchorable while their containers are not. Each accordion item's content
 * extends the path with the item index, exactly as the renderer does, so item
 * order keeps anchors unique and deterministic. Repeating a canonical block
 * increments its occurrence counter; a hash collision is resolved by a
 * deterministic salt in the same authored order, never by mount order.
 */
export function readingAnchorsForPage(
  pageId: string,
  nodes: readonly ContentNode[],
  /** @internal Hash override for deterministic collision tests. */
  hash: (value: string) => string = hashAnchor
): Map<string, ReadingAnchor> {
  const anchors = new Map<string, ReadingAnchor>()
  const occurrences = new Map<string, number>()
  const used = new Set<string>()

  const allocate = (node: ContentNode): string => {
    const canonical = normalizedBlock(node)
    if (canonical === null) {
      throw new Error(`Content node ${node.type} cannot own a reading anchor`)
    }
    const occurrence = occurrences.get(canonical) ?? 0
    occurrences.set(canonical, occurrence + 1)
    let salt = 0
    for (;;) {
      const seed =
        salt === 0
          ? `${pageId}\u0000${canonical}\u0000${occurrence}`
          : `${pageId}\u0000${canonical}\u0000${occurrence}\u0000${salt}`
      const id = hash(seed)
      if (!used.has(id)) {
        used.add(id)
        return id
      }
      salt += 1
    }
  }

  const visit = (list: readonly ContentNode[], prefix: readonly number[]) => {
    list.forEach((node, index) => {
      const path = [...prefix, index]
      if (normalizedBlock(node) !== null) {
        anchors.set(pathKey(path), { id: allocate(node), pageId })
      }
      if (node.type === 'quote') {
        visit(node.children, path)
      }
      if (node.type === 'accordion') {
        node.items.forEach((item, itemIndex) => {
          visit(item.content, [...path, itemIndex])
        })
      }
    })
  }

  visit(nodes, [])
  return anchors
}

/** The attributes an anchorable block spreads onto its DOM element. */
export function readingAnchorAttributes(anchor: ReadingAnchor | undefined): {
  id?: string
  'data-reading-anchor'?: string
  'data-reading-anchor-page'?: string
} {
  if (anchor === undefined) {
    return {}
  }
  return {
    id: domReadingAnchorId(anchor.pageId, anchor.id),
    [READING_ANCHOR_ATTRIBUTE]: anchor.id,
    [READING_ANCHOR_PAGE_ATTRIBUTE]: anchor.pageId
  }
}

/**
 * Keep rendered IDs short while namespacing identical anchor hashes on
 * concurrently mounted pages. Persisted anchor values are unchanged.
 */
function domReadingAnchorId(pageId: string, anchorId: string): string {
  return `reading-${hashAnchor(pageId)}-${anchorId}`
}

/** The anchor at an authored render path, if that block is anchorable. */
export function readingAnchorAt(
  anchors: ReadonlyMap<string, ReadingAnchor> | undefined,
  path: readonly number[]
): ReadingAnchor | undefined {
  return anchors?.get(pathKey(path))
}
