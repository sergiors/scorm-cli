/**
 * The parser's normalized node boundary.
 *
 * `remark-parse` + `remark-mdx` produce an mdast/MDX tree, but the parser
 * consumes it through this small discriminated view of the variants it actually
 * supports instead of importing the third-party AST types. Every known variant
 * carries a literal `type`, so a `type` check narrows to the exact fields the
 * variant owns. {@link UnknownAstNode} keeps unmodelled nodes representable so
 * the conversion pipeline can report them with a source-aware error rather than
 * silently dropping them.
 */

export interface AstPosition {
  start?: { line?: number; column?: number; offset?: number }
  end?: { line?: number; column?: number; offset?: number }
}

/**
 * Fields every parsed node carries for traversal and diagnostics. They are the
 * only properties shared by all variants, including unmodelled nodes.
 */
interface AstNodeBase {
  type: string
  position?: AstPosition
  children?: AstNode[]
  /** Source ranges of comment-only MDX expressions removed from this node's children. */
  commentSpans?: AstPosition[]
}

export interface AstJsxAttribute {
  type: 'mdxJsxAttribute'
  name?: string
  value?: unknown
  position?: unknown
}

export interface AstJsxExpressionAttribute {
  type: 'mdxJsxExpressionAttribute'
  value?: unknown
}

export type AstAttribute = AstJsxAttribute | AstJsxExpressionAttribute

export interface AstEstreeStatement {
  type?: string
  source?: { value?: string }
  specifiers?: Array<{
    type?: string
    local?: { name?: string }
    imported?: { name?: string } | null
  }>
}

export interface AstEstreeData {
  estree?: { body?: AstEstreeStatement[]; comments?: Array<{ type?: string }> }
}

export interface MdxExpressionAstNode extends AstNodeBase {
  type: 'mdxFlowExpression' | 'mdxTextExpression'
  value?: unknown
  data?: AstEstreeData
}

export interface TextAstNode extends AstNodeBase {
  type: 'text'
  value?: string | null
}

export interface EmphasisAstNode extends AstNodeBase {
  type: 'emphasis'
}

export interface StrongAstNode extends AstNodeBase {
  type: 'strong'
}

export interface InlineCodeAstNode extends AstNodeBase {
  type: 'inlineCode'
  value?: string | null
}

export interface LinkAstNode extends AstNodeBase {
  type: 'link'
  url?: string
}

export interface ImageAstNode extends AstNodeBase {
  type: 'image'
  url?: string
  alt?: string | null
}

export interface BreakAstNode extends AstNodeBase {
  type: 'break'
}

export interface LinkReferenceAstNode extends AstNodeBase {
  type: 'linkReference'
  identifier?: string
}

export interface ImageReferenceAstNode extends AstNodeBase {
  type: 'imageReference'
  identifier?: string
  alt?: string | null
}

export interface ParagraphAstNode extends AstNodeBase {
  type: 'paragraph'
}

export interface HeadingAstNode extends AstNodeBase {
  type: 'heading'
  depth?: number | null
}

export interface ListAstNode extends AstNodeBase {
  type: 'list'
  ordered?: boolean | null
  start?: number | null
  spread?: boolean | null
}

export interface ListItemAstNode extends AstNodeBase {
  type: 'listItem'
}

export interface TableAstNode extends AstNodeBase {
  type: 'table'
  /** Per-column alignment from the delimiter row; `null` means unaligned. */
  align?: Array<'left' | 'center' | 'right' | null> | null
}

export interface TableRowAstNode extends AstNodeBase {
  type: 'tableRow'
}

export interface TableCellAstNode extends AstNodeBase {
  type: 'tableCell'
}

export interface CodeAstNode extends AstNodeBase {
  type: 'code'
  value?: string | null
  lang?: string | null
}

export interface BlockquoteAstNode extends AstNodeBase {
  type: 'blockquote'
}

export interface ThematicBreakAstNode extends AstNodeBase {
  type: 'thematicBreak'
}

export interface HtmlAstNode extends AstNodeBase {
  type: 'html'
  value?: unknown
}

export interface DefinitionAstNode extends AstNodeBase {
  type: 'definition'
  identifier?: string
  url?: string
}

export interface MdxjsEsmAstNode extends AstNodeBase {
  type: 'mdxjsEsm'
  value?: unknown
  data?: AstEstreeData
}

export interface MdxJsxFlowElementAstNode extends AstNodeBase {
  type: 'mdxJsxFlowElement'
  /** Raw JSX element name. */
  name?: string | null
  /** Raw JSX attributes; decoded and validated by `attrs`. */
  attributes?: AstAttribute[]
  /** Canonical authoring identity, assigned by the MDX normalization pass. */
  canonicalName?: string
}

export interface MdxJsxTextElementAstNode extends AstNodeBase {
  type: 'mdxJsxTextElement'
  /** Raw JSX element name. */
  name?: string | null
  /** Raw JSX attributes; decoded and validated by `attrs`. */
  attributes?: AstAttribute[]
  /** Canonical authoring identity, assigned by the MDX normalization pass. */
  canonicalName?: string
}

/** A node the parser does not model; kept so it can be reported, not dropped. */
export interface UnknownAstNode extends AstNodeBase {}

export type AstNode =
  | TextAstNode
  | EmphasisAstNode
  | StrongAstNode
  | InlineCodeAstNode
  | LinkAstNode
  | ImageAstNode
  | BreakAstNode
  | LinkReferenceAstNode
  | ImageReferenceAstNode
  | ParagraphAstNode
  | HeadingAstNode
  | ListAstNode
  | ListItemAstNode
  | TableAstNode
  | TableRowAstNode
  | TableCellAstNode
  | CodeAstNode
  | BlockquoteAstNode
  | ThematicBreakAstNode
  | HtmlAstNode
  | DefinitionAstNode
  | MdxjsEsmAstNode
  | MdxExpressionAstNode
  | MdxJsxFlowElementAstNode
  | MdxJsxTextElementAstNode
  | UnknownAstNode

export function isJsx(node: AstNode): node is MdxJsxFlowElementAstNode | MdxJsxTextElementAstNode {
  return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement'
}

export function rawComponentName(node: AstNode): string {
  return isJsx(node) ? (node.name ?? '') : ''
}

export function isMdxjsEsm(node: AstNode): node is MdxjsEsmAstNode {
  return node.type === 'mdxjsEsm'
}

/** Whether remark-mdx parsed an expression containing only JSX block comments. */
export function isJsxCommentExpression(node: AstNode): node is MdxExpressionAstNode {
  if (node.type !== 'mdxFlowExpression' && node.type !== 'mdxTextExpression') return false
  const estree = (node as MdxExpressionAstNode).data?.estree
  return (
    Array.isArray(estree?.body) &&
    estree.body.length === 0 &&
    Array.isArray(estree.comments) &&
    estree.comments.length > 0 &&
    estree.comments.every((comment) => comment.type === 'Block')
  )
}

export function isText(node: AstNode): node is TextAstNode {
  return node.type === 'text'
}

export function isLinkReference(node: AstNode): node is LinkReferenceAstNode {
  return node.type === 'linkReference'
}

export function isReference(node: AstNode): node is LinkReferenceAstNode | ImageReferenceAstNode {
  return node.type === 'linkReference' || node.type === 'imageReference'
}

export function isDefinition(node: AstNode): node is DefinitionAstNode {
  return node.type === 'definition'
}

/** Whether a node is whitespace-only text (used to ignore MDX formatting). */
export function whitespace(node: AstNode): boolean {
  return isText(node) && !String(node.value ?? '').trim()
}

export function meaningfulChildren(nodes: AstNode[]): AstNode[] {
  return nodes.filter((node) => !whitespace(node))
}

/**
 * The source context a content conversion runs in: the file the nodes came
 * from, the content package root, and (for pages) the declared root Scroll page
 * sources that `<Path>` references resolve against.
 */
export interface ContentSource {
  sourceFile: string
  root: string
  sourceText: string
  sourceLineOffset?: number
  rootPageSources?: Set<string>
}
