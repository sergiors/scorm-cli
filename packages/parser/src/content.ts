import type { ContentNode, InlineNode } from '@scorm-cli/core'
import type { AstNode, ContentSource } from './ast'
import { isJsx, isText, rawComponentName, whitespace } from './ast'
import { componentName } from './component-name'
import {
  flowComponentHandlers,
  inlineComponentHandlers,
  isBlockOnlyComponent,
  isFlowComponent,
  isInlineComponent,
  type ComponentParseContext
} from './components'
import {
  isMarkdownBlock,
  isMarkdownInline,
  parseMarkdownBlock,
  parseMarkdownInline,
  type MarkdownConversion
} from './markdown'
import { sourceLocation } from './shared'

function questionPlacementError(source: ContentSource, node: AstNode): Error {
  return new Error(
    `${sourceLocation(source.sourceFile, node)}: <Question> must be inside <Questionnaire>`
  )
}

function blockOnlyInlineError(source: ContentSource, node: AstNode): Error {
  return new Error(
    `${sourceLocation(source.sourceFile, node)}: component <${rawComponentName(node)}> is block-only and cannot be used inline`
  )
}

function unknownComponentError(source: ContentSource, node: AstNode): Error {
  return new Error(
    `${sourceLocation(source.sourceFile, node)}: unknown MDX component <${rawComponentName(node)}>`
  )
}

function unsupportedNodeError(
  kind: 'inline' | 'content',
  source: ContentSource,
  node: AstNode
): Error {
  return new Error(
    `${sourceLocation(source.sourceFile, node)}: unsupported ${kind} node "${node.type}"`
  )
}

function componentParseContext(source: ContentSource): ComponentParseContext {
  return {
    source,
    convertChildren: (nodes) => convertSiblingNodes(nodes, source, 'content')
  }
}

function markdownConversion(source: ContentSource): MarkdownConversion {
  return {
    sourceFile: source.sourceFile,
    root: source.root,
    convertInline: (nodes) => convertInlineNodes(nodes, source),
    convertChildren: (nodes) => convertSiblingNodes(nodes, source, 'content'),
    convertParagraph: (nodes) => convertSiblingNodes(nodes, source, 'inline')
  }
}

/**
 * Whether a node belongs to an inline run: standard Markdown inline syntax or
 * an inline-capable authoring component (only `<Image>` today). Used at content
 * level, where block nodes are simply everything else.
 */
function isInlineFlowNode(node: AstNode): boolean {
  return (
    isMarkdownInline(node) ||
    (node.type === 'mdxJsxTextElement' && isInlineComponent(componentName(node)))
  )
}

/**
 * Whether a node ends an inline run inside a paragraph: a flow-position JSX
 * element, a block-only component, or `<Question>` (owned by the Questionnaire
 * grammar). Inside a paragraph everything else (including unrecognized nodes)
 * stays in the inline run so it is reported as an inline failure.
 */
function isHoistableBlock(node: AstNode): boolean {
  if (node.type === 'mdxJsxFlowElement') {
    return true
  }

  if (node.type !== 'mdxJsxTextElement') {
    return false
  }

  const name = componentName(node)
  return isBlockOnlyComponent(name) || name === 'Question'
}

async function convertInlineNodes(nodes: AstNode[], source: ContentSource): Promise<InlineNode[]> {
  const conversion = markdownConversion(source)
  const context = componentParseContext(source)
  const output: InlineNode[] = []
  for (const node of nodes) {
    if (isMarkdownInline(node)) {
      output.push(await parseMarkdownInline(node, conversion))
    } else if (node.type === 'mdxJsxTextElement') {
      const name = componentName(node)
      if (isInlineComponent(name)) {
        output.push(await inlineComponentHandlers[name](node, context))
      } else if (name === 'Question') {
        throw questionPlacementError(source, node)
      } else if (isBlockOnlyComponent(name)) {
        throw blockOnlyInlineError(source, node)
      } else {
        throw unknownComponentError(source, node)
      }
    } else {
      throw unsupportedNodeError('inline', source, node)
    }
  }
  return output
}

async function convertComponent(node: AstNode, source: ContentSource): Promise<ContentNode> {
  const name = componentName(node)

  if (name === 'Question') {
    throw questionPlacementError(source, node)
  }

  if (isFlowComponent(name)) {
    return flowComponentHandlers[name](node, componentParseContext(source))
  }

  throw unknownComponentError(source, node)
}

async function convertBlock(node: AstNode, source: ContentSource): Promise<ContentNode[]> {
  if (isMarkdownBlock(node)) {
    return parseMarkdownBlock(node, markdownConversion(source))
  }

  if (isJsx(node)) {
    return [await convertComponent(node, source)]
  }

  throw unsupportedNodeError('content', source, node)
}

/**
 * Where a sibling run is being converted. A paragraph body (`inline`) treats
 * every non-inline child as inline-position content, while content-level runs
 * (`content`, inside list items, quotes and referenced documents) treat
 * whitespace-only text as block separation.
 */
type SiblingPosition = 'content' | 'inline'

/**
 * Converts sibling nodes into ordered content. Inline syntax and inline
 * components buffer into paragraphs; every other node is converted as a block.
 * This single buffer is the canonical inline/block boundary for paragraphs,
 * list items, quotes and referenced documents.
 */
async function convertSiblingNodes(
  nodes: AstNode[],
  source: ContentSource,
  position: SiblingPosition
): Promise<ContentNode[]> {
  const output: ContentNode[] = []
  let inline: AstNode[] = []
  const flush = async () => {
    if (!inline.length) return
    const children = await convertInlineNodes(inline, source)
    if (children.some((child) => child.type !== 'text' || child.value.trim() !== ''))
      output.push({ type: 'paragraph', children })
    inline = []
  }

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    if (position === 'content' && whitespace(node)) {
      // Between content blocks, whitespace only matters while an inline run is
      // open: a space joins the run, while a line break closes it.
      if (isText(node) && inline.length && !/[\r\n]/.test(String(node.value ?? '')))
        inline.push(node)
      else await flush()
      continue
    }
    if (position === 'content' && node.type === 'mdxjsEsm')
      throw new Error(`${sourceLocation(source.sourceFile, node)}: MDX JavaScript is not supported`)
    if (position === 'content' ? isInlineFlowNode(node) : !isHoistableBlock(node)) {
      inline.push(node)
      continue
    }
    if (
      position === 'inline' &&
      (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement')
    ) {
      const name = componentName(node)
      // Placement checks run before the pending inline run flushes, matching
      // the paragraph grammar's error precedence.
      if (name === 'Question') throw questionPlacementError(source, node)
      if (node.type === 'mdxJsxTextElement' && isBlockOnlyComponent(name)) {
        const previous = nodes[index - 1]
        const next = nodes[index + 1]
        if ((previous && !whitespace(previous)) || (next && !whitespace(next)))
          throw blockOnlyInlineError(source, node)
      }
    }
    await flush()
    output.push(...(await convertBlock(node, source)))
  }
  await flush()
  return output
}

/**
 * Converts one authored node (a referenced document's direct child) into
 * content. A lone inline node becomes a paragraph; everything else is converted
 * through the shared block dispatcher.
 */
export async function parseContentNodes(
  node: AstNode,
  sourceFile: string,
  root: string,
  rootPageSources?: Set<string>,
  sourceLineOffset = 0
): Promise<ContentNode[]> {
  const source: ContentSource = { sourceFile, root, rootPageSources, sourceLineOffset }

  if (isMarkdownInline(node)) {
    return [{ type: 'paragraph', children: await convertInlineNodes([node], source) }]
  }

  if (node.type === 'mdxJsxTextElement') {
    return [await convertComponent(node, source)]
  }

  return convertBlock(node, source)
}
