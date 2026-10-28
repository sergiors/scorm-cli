import type { AccordionItemNode, AccordionNode } from '@scorm-cli/core'
import type { AstNode, ContentSource } from './ast'
import { isJsx, rawComponentName, whitespace } from './ast'
import { componentName } from './component-name'
import type { ComponentParseContext } from './components'
import { attrs, assertAttributes, sourceLocation } from './shared'

/** Unwraps parser-generated paragraphs containing only the expected child tags. */
function normalizeAccordionChildren(children: AstNode[], names: readonly string[]): AstNode[] {
  return children
    .flatMap((child) => {
      if (
        child.type === 'paragraph' &&
        (child.children ?? []).every(
          (nested) => whitespace(nested) || (isJsx(nested) && names.includes(componentName(nested)))
        )
      ) {
        return child.children ?? []
      }
      return [child]
    })
    .filter((child) => !whitespace(child))
}

function childName(node: AstNode): string {
  return isJsx(node) ? componentName(node) : ''
}

function foundChild(node: AstNode): string {
  const name = rawComponentName(node)
  return name ? `<${name}>` : node.type
}

function requiredStructureChildren(
  node: AstNode,
  containerName: 'Accordion' | 'Item',
  allowed: readonly string[],
  source: ContentSource
): AstNode[] {
  const children = normalizeAccordionChildren(node.children ?? [], allowed)
  const expectedChildren: AstNode[] = []
  for (const child of children) {
    if (!isJsx(child) || !allowed.includes(childName(child))) {
      throw new Error(
        `${sourceLocation(source.sourceFile, child)}: <${containerName}> may contain only direct ${allowed.map((name) => `<${name}>`).join(' and ')} children; found ${foundChild(child)}`
      )
    }
    expectedChildren.push(child)
  }
  return expectedChildren
}

async function parseAccordionItem(
  node: AstNode,
  source: ContentSource,
  context: ComponentParseContext
): Promise<AccordionItemNode> {
  const file = source.sourceFile
  const values = attrs(node, file)
  assertAttributes(values, ['defaultOpen'], file, node)
  if (values.defaultOpen !== undefined && typeof values.defaultOpen !== 'boolean') {
    throw new Error(`${sourceLocation(file, node)}: Item "defaultOpen" must be a boolean`)
  }

  const children = requiredStructureChildren(node, 'Item', ['Title', 'Content'], source)
  const titles: AstNode[] = []
  const contents: AstNode[] = []
  for (const child of children) {
    if (childName(child) === 'Title') titles.push(child)
    else contents.push(child)
  }
  if (titles.length !== 1) {
    throw new Error(
      `${sourceLocation(file, node)}: Item must contain exactly 1 direct <Title>; found ${titles.length}`
    )
  }
  if (contents.length !== 1) {
    throw new Error(
      `${sourceLocation(file, node)}: Item must contain exactly 1 direct <Content>; found ${contents.length}`
    )
  }

  const title = titles[0]!
  const content = contents[0]!
  assertAttributes(attrs(title, file), [], file, title)
  assertAttributes(attrs(content, file), [], file, content)

  // MDX represents inline Markdown inside a flow JSX element as a paragraph.
  // It is only a parser boundary here; title conversion remains the standard
  // inline Markdown conversion used by ordinary paragraphs and headings.
  const titleNodes = (title.children ?? []).flatMap((child) =>
    child.type === 'paragraph' ? (child.children ?? []) : [child]
  )
  const inlineTitle = await context.convertInline(titleNodes)
  return {
    type: 'accordionItem',
    defaultOpen: values.defaultOpen === true,
    title: inlineTitle,
    content: await context.convertContent(content.children ?? [])
  }
}

export async function parseAccordion(
  node: AstNode,
  context: ComponentParseContext
): Promise<AccordionNode> {
  const { source } = context
  const file = source.sourceFile
  const values = attrs(node, file)
  assertAttributes(values, ['multiple', 'collapsible'], file, node)
  for (const name of ['multiple', 'collapsible'] as const) {
    if (values[name] !== undefined && typeof values[name] !== 'boolean') {
      throw new Error(`${sourceLocation(file, node)}: Accordion "${name}" must be a boolean`)
    }
  }

  const multiple = values.multiple === true
  const collapsible = values.collapsible === true
  if (multiple && collapsible) {
    throw new Error(
      `${sourceLocation(file, node)}: Accordion cannot set both "multiple" and "collapsible" to true`
    )
  }

  const itemNodes = requiredStructureChildren(node, 'Accordion', ['Item'], source)
  if (itemNodes.length === 0) {
    throw new Error(
      `${sourceLocation(file, node)}: Accordion must contain at least one direct <Item>`
    )
  }

  const items: AccordionItemNode[] = []
  for (const child of itemNodes) {
    items.push(await parseAccordionItem(child, source, context))
  }

  const defaultOpenCount = items.filter((item) => item.defaultOpen).length
  if (!multiple && defaultOpenCount > 1) {
    throw new Error(
      `${sourceLocation(file, node)}: a single-open Accordion may have at most one Item with "defaultOpen"`
    )
  }

  return { type: 'accordion', multiple, collapsible, items }
}
