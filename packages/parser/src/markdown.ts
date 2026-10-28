import type {
  ContentNode,
  InlineContentNode,
  InlineNode,
  ListItemNode,
  TableCellNode,
  TableRowNode
} from '@scorm-cli/core'
import type {
  AstNode,
  BlockquoteAstNode,
  CodeAstNode,
  EmphasisAstNode,
  HeadingAstNode,
  ImageAstNode,
  InlineCodeAstNode,
  LinkAstNode,
  ListAstNode,
  ParagraphAstNode,
  StrongAstNode,
  TableAstNode,
  TextAstNode
} from './ast'
import { assetReference } from './io'
import { sourceLocation } from './shared'

/**
 * Standard Markdown node dispatch.
 *
 * This module owns the Markdown vocabulary and converts standard Markdown to
 * canonical content. Authoring components are deliberately absent here: the
 * content dispatcher decides whether a node is standard Markdown (handled here)
 * or a JSX component (handled by the component registry).
 *
 * The handler records below are the only list of supported node types. The
 * exported unions are derived from their keys, and membership is checked with an
 * own-property guard, so a handler cannot be added or removed without the
 * vocabulary following.
 */

/**
 * Collaborators the Markdown converters need: the source context for asset
 * resolution plus the content dispatcher callbacks for nested inline runs,
 * block children, and paragraph bodies (where inline runs interleave with
 * hoisted block components).
 */
export interface MarkdownConversion {
  sourceFile: string
  root: string
  convertInline(nodes: AstNode[]): Promise<InlineNode[]>
  convertChildren(nodes: AstNode[]): Promise<ContentNode[]>
  convertParagraph(nodes: AstNode[]): Promise<ContentNode[]>
}

type MarkdownInlineHandler = (
  node: AstNode,
  conversion: MarkdownConversion
) => Promise<InlineNode> | InlineNode

const markdownInlineHandlers = {
  text: (node: TextAstNode) => ({ type: 'text', value: String(node.value ?? '') }),
  emphasis: async (node: EmphasisAstNode, conversion: MarkdownConversion) => ({
    type: 'emphasis',
    children: await conversion.convertInline(node.children ?? [])
  }),
  strong: async (node: StrongAstNode, conversion: MarkdownConversion) => ({
    type: 'strong',
    children: await conversion.convertInline(node.children ?? [])
  }),
  inlineCode: (node: InlineCodeAstNode) => ({
    type: 'inlineCode',
    value: String(node.value ?? '')
  }),
  link: async (node: LinkAstNode, conversion: MarkdownConversion) => ({
    type: 'link',
    href: await assetReference(
      node.url ?? '',
      conversion.sourceFile,
      conversion.root,
      conversion.sourceFile,
      node
    ),
    children: await conversion.convertInline(node.children ?? [])
  }),
  image: async (node: ImageAstNode, conversion: MarkdownConversion) => ({
    type: 'image',
    src: await assetReference(
      node.url ?? '',
      conversion.sourceFile,
      conversion.root,
      conversion.sourceFile,
      node
    ),
    alt: String(node.alt ?? '')
  }),
  break: () => ({ type: 'break' })
}

/** Standard Markdown inline node types, derived from the handler keys. */
export type MarkdownInlineType = keyof typeof markdownInlineHandlers

export const markdownInlineTypes = Object.keys(markdownInlineHandlers) as MarkdownInlineType[]

type MarkdownBlockHandler = (
  node: AstNode,
  conversion: MarkdownConversion
) => Promise<ContentNode | ContentNode[]> | ContentNode | ContentNode[]

/**
 * Normalizes the parsed children of a single list item. Tight list items
 * (`spread === false`) render their inline runs without a block wrapper, so the
 * paragraphs the source parser reports are rewritten into {@link InlineContentNode}
 * runs. Every non-paragraph block (nested lists, quotes, code, media) is kept
 * as-is, preserving order and nesting; loose items keep their paragraphs.
 */
function normalizeListItemChildren(
  children: ContentNode[],
  tight: boolean
): Array<ContentNode | InlineContentNode> {
  if (!tight) {
    return children
  }

  return children.map((child) =>
    child.type === 'paragraph' ? { type: 'inlineContent', children: child.children } : child
  )
}

/**
 * Normalizes one table row. Cell contents reuse the inline converter, so links,
 * emphasis, inline code and images behave exactly as they do in a paragraph;
 * an empty cell stays an empty inline run. Alignment is positional: the
 * delimiter row's entry for the cell's column applies to that cell.
 */
async function convertTableRow(
  node: AstNode | undefined,
  alignments: TableAstNode['align'],
  conversion: MarkdownConversion
): Promise<TableRowNode> {
  return {
    cells: await Promise.all(
      (node?.children ?? []).map(async (cell, index): Promise<TableCellNode> => {
        const align = alignments?.[index]
        return {
          children: await conversion.convertInline(cell.children ?? []),
          ...(align === 'left' || align === 'center' || align === 'right' ? { align } : {})
        }
      })
    )
  }
}

const markdownBlockHandlers = {
  heading: async (node: HeadingAstNode, conversion: MarkdownConversion) => ({
    type: 'heading',
    depth: node.depth ?? 1,
    children: await conversion.convertInline(node.children ?? [])
  }),
  paragraph: (node: ParagraphAstNode, conversion: MarkdownConversion) =>
    conversion.convertParagraph(node.children ?? []),
  thematicBreak: () => ({ type: 'thematicBreak' }),
  list: async (node: ListAstNode, conversion: MarkdownConversion) => {
    // A tight list's items render inline, so their paragraphs become
    // `inlineContent` runs in the AST; loose items keep their paragraphs.
    const tight = node.spread === false
    return {
      type: 'list',
      ordered: Boolean(node.ordered),
      ...(node.ordered && node.start != null && node.start !== 1 ? { start: node.start } : {}),
      // Carry the source parser's exact tightness through unchanged; no
      // inference from structure or child count.
      ...(typeof node.spread === 'boolean' ? { spread: node.spread } : {}),
      items: await Promise.all(
        (node.children ?? []).map(async (item): Promise<ListItemNode> => ({
          children: normalizeListItemChildren(
            await conversion.convertChildren(item.children ?? []),
            tight
          )
        }))
      )
    }
  },
  code: (node: CodeAstNode) => ({
    type: 'code',
    value: String(node.value ?? ''),
    ...(node.lang ? { language: node.lang } : {})
  }),
  blockquote: async (node: BlockquoteAstNode, conversion: MarkdownConversion) => ({
    type: 'quote',
    children: await conversion.convertChildren(node.children ?? [])
  }),
  table: async (node: TableAstNode, conversion: MarkdownConversion) => {
    const [header, ...rows] = node.children ?? []
    return {
      type: 'table',
      header: await convertTableRow(header, node.align, conversion),
      rows: await Promise.all(rows.map((row) => convertTableRow(row, node.align, conversion)))
    }
  }
}

/**
 * Standard Markdown block node types, derived from the handler keys. A paragraph
 * is included: it is the boundary where Markdown inline flow meets authoring
 * blocks, so its handler delegates back to the content dispatcher's paragraph
 * converter, preserving inline/block interleaving.
 */
export type MarkdownBlockType = keyof typeof markdownBlockHandlers

export const markdownBlockTypes = Object.keys(markdownBlockHandlers) as MarkdownBlockType[]

export type MarkdownInlineNode = Extract<AstNode, { type: MarkdownInlineType }>

export type MarkdownBlockNode = Extract<AstNode, { type: MarkdownBlockType }>

export function isMarkdownInline(node: AstNode): node is MarkdownInlineNode {
  return Object.hasOwn(markdownInlineHandlers, node.type)
}

export function isMarkdownBlock(node: AstNode): node is MarkdownBlockNode {
  return Object.hasOwn(markdownBlockHandlers, node.type)
}

/**
 * Converts one standard Markdown inline node. The own-property guard proves a
 * handler exists for the discriminant; the assertion only expresses the
 * correlation TypeScript cannot follow through a union-indexed lookup, matching
 * the renderer registries.
 */
export async function parseMarkdownInline(
  node: AstNode,
  conversion: MarkdownConversion
): Promise<InlineNode> {
  if (!isMarkdownInline(node)) {
    throw new Error(
      `${sourceLocation(conversion.sourceFile, node)}: unsupported inline node "${node.type}"`
    )
  }
  const handler = markdownInlineHandlers[node.type] as MarkdownInlineHandler
  return handler(node, conversion)
}

/**
 * Converts one standard Markdown block node into one or more canonical content
 * nodes. A paragraph can expand to several nodes when it interleaves inline runs
 * with hoisted block components.
 */
export async function parseMarkdownBlock(
  node: AstNode,
  conversion: MarkdownConversion
): Promise<ContentNode[]> {
  if (!isMarkdownBlock(node)) {
    throw new Error(
      `${sourceLocation(conversion.sourceFile, node)}: unsupported content node "${node.type}"`
    )
  }
  const handler = markdownBlockHandlers[node.type] as MarkdownBlockHandler
  const converted = await handler(node, conversion)
  return Array.isArray(converted) ? converted : [converted]
}
