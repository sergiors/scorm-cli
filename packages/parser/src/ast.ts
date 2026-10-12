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

/** Source position used for diagnostics. */
export interface AstPosition {
  start?: { line?: number; column?: number };
}

/**
 * Fields every parsed node carries for traversal and diagnostics. They are the
 * only properties shared by all variants, including unmodelled nodes.
 */
interface AstNodeBase {
  type: string;
  position?: AstPosition;
  /** Raw JSX element name; canonical resolution lives in `component-name`. */
  name?: string | null;
  /** Child nodes of block, inline and JSX container nodes. */
  children?: AstNode[];
  /** Raw JSX attributes; decoded and validated by `attrs`. */
  attributes?: AstAttribute[];
}

/** A JSX attribute with a name and an optional literal or expression value. */
export interface AstJsxAttribute {
  type: 'mdxJsxAttribute';
  name?: string;
  value?: unknown;
  position?: unknown;
}

/** A JSX spread or expression attribute (`{...props}`). */
export interface AstJsxExpressionAttribute {
  type: 'mdxJsxExpressionAttribute';
  value?: unknown;
}

export type AstAttribute = AstJsxAttribute | AstJsxExpressionAttribute;

/** One statement in the embedded ESTree program of an MDX ESM block. */
export interface AstEstreeStatement {
  type?: string;
  source?: { value?: unknown };
  specifiers?: Array<{
    type?: string;
    local?: { name?: unknown };
    imported?: { name?: unknown } | null;
  }>;
}

/** The ESTree data attached to an MDX ESM node. */
export interface AstEstreeData {
  estree?: { body?: AstEstreeStatement[] };
}

export interface TextAstNode extends AstNodeBase {
  type: 'text';
  value?: string | null;
}

export interface EmphasisAstNode extends AstNodeBase {
  type: 'emphasis';
}

export interface StrongAstNode extends AstNodeBase {
  type: 'strong';
}

export interface InlineCodeAstNode extends AstNodeBase {
  type: 'inlineCode';
  value?: string | null;
}

export interface LinkAstNode extends AstNodeBase {
  type: 'link';
  url?: string;
}

export interface ImageAstNode extends AstNodeBase {
  type: 'image';
  url?: string;
  alt?: string | null;
}

export interface BreakAstNode extends AstNodeBase {
  type: 'break';
}

export interface LinkReferenceAstNode extends AstNodeBase {
  type: 'linkReference';
  identifier?: string;
}

export interface ImageReferenceAstNode extends AstNodeBase {
  type: 'imageReference';
  identifier?: string;
  alt?: string | null;
}

export interface ParagraphAstNode extends AstNodeBase {
  type: 'paragraph';
}

export interface HeadingAstNode extends AstNodeBase {
  type: 'heading';
  depth?: number | null;
}

export interface ListAstNode extends AstNodeBase {
  type: 'list';
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
}

export interface ListItemAstNode extends AstNodeBase {
  type: 'listItem';
}

export interface CodeAstNode extends AstNodeBase {
  type: 'code';
  value?: string | null;
  lang?: string | null;
}

export interface BlockquoteAstNode extends AstNodeBase {
  type: 'blockquote';
}

export interface ThematicBreakAstNode extends AstNodeBase {
  type: 'thematicBreak';
}

export interface HtmlAstNode extends AstNodeBase {
  type: 'html';
  value?: unknown;
}

export interface DefinitionAstNode extends AstNodeBase {
  type: 'definition';
  identifier?: string;
  url?: string;
}

export interface MdxjsEsmAstNode extends AstNodeBase {
  type: 'mdxjsEsm';
  value?: unknown;
  data?: AstEstreeData;
}

export interface MdxJsxFlowElementAstNode extends AstNodeBase {
  type: 'mdxJsxFlowElement';
}

export interface MdxJsxTextElementAstNode extends AstNodeBase {
  type: 'mdxJsxTextElement';
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
  | CodeAstNode
  | BlockquoteAstNode
  | ThematicBreakAstNode
  | HtmlAstNode
  | DefinitionAstNode
  | MdxjsEsmAstNode
  | MdxJsxFlowElementAstNode
  | MdxJsxTextElementAstNode
  | UnknownAstNode;

/** Whether a node is an MDX JSX element, in either flow or text position. */
export function isJsx(node: AstNode): boolean {
  return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
}

/** Whether a node is an MDX ESM block (imports or other JavaScript). */
export function isMdxjsEsm(node: AstNode): node is MdxjsEsmAstNode {
  return node.type === 'mdxjsEsm';
}

/** Whether a node is a Markdown text run. */
export function isText(node: AstNode): node is TextAstNode {
  return node.type === 'text';
}

/** Whether a node is a Markdown link reference, before it is resolved. */
export function isLinkReference(node: AstNode): node is LinkReferenceAstNode {
  return node.type === 'linkReference';
}

/** Whether a node is a Markdown reference-style link or image. */
export function isReference(node: AstNode): node is LinkReferenceAstNode | ImageReferenceAstNode {
  return node.type === 'linkReference' || node.type === 'imageReference';
}

/** Whether a node is a Markdown link definition (`[label]: url`). */
export function isDefinition(node: AstNode): node is DefinitionAstNode {
  return node.type === 'definition';
}

/** Whether a node is whitespace-only text (used to ignore MDX formatting). */
export function whitespace(node: AstNode): boolean {
  return isText(node) && !String(node.value ?? '').trim();
}

/** The direct children with whitespace-only text removed. */
export function meaningfulChildren(nodes: AstNode[]): AstNode[] {
  return nodes.filter((node) => !whitespace(node));
}

/**
 * The source context a content conversion runs in: the file the nodes came
 * from, the content package root, and (for pages) the declared root Scroll page
 * sources that `<Path>` references resolve against.
 */
export interface ContentSource {
  sourceFile: string;
  root: string;
  rootPageSources?: Set<string>;
}
