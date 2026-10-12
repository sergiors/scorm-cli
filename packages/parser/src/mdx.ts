import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { AstNode, ImageReferenceAstNode, LinkReferenceAstNode, MdxjsEsmAstNode } from './ast'
import { isDefinition, isJsx, isLinkReference, isMdxjsEsm, isReference } from './ast'
import { isAuthoringComponent } from './components'
import { sourceLocation } from './shared'

const processor = unified().use(remarkParse).use(remarkMdx)

/** The only module MDX content may import components from. */
const authoringSource = 'scorm-cli/authoring'

/**
 * Sentinel canonical name for JSX bound by an import from a module other than
 * `scorm-cli/authoring`. It matches no canonical component, so shadowed names
 * are reported as unknown instead of falling back to the legacy raw-name
 * vocabulary.
 */
const shadowedComponentName = '\u0000shadowed'

interface ImportBindings {
  aliases: Map<string, string>
  namespaces: Set<string>
  /**
   * Local names bound by imports from modules other than `scorm-cli/authoring`.
   * They can never name an authoring component, so JSX using one must be
   * treated as unknown instead of falling back to the canonical vocabulary.
   */
  shadowed: Set<string>
}

/**
 * Collects import bindings from every ESM import in a document. Imports from
 * `scorm-cli/authoring` name canonical components (directly or through aliases
 * and namespace members); authoring bindings win over any other import. Every
 * other import still binds its local name, so it shadows the legacy raw-name
 * vocabulary even though it can never resolve to a canonical component.
 */
function collectImportBindings(nodes: AstNode[], file: string): ImportBindings {
  const aliases = new Map<string, string>()
  const namespaces = new Set<string>()
  const shadowed = new Set<string>()
  for (const node of nodes) {
    if (!isMdxjsEsm(node)) continue
    for (const statement of node.data?.estree?.body ?? []) {
      if (statement.type !== 'ImportDeclaration') continue
      const fromAuthoring = statement.source?.value === authoringSource
      for (const specifier of statement.specifiers ?? []) {
        const local = typeof specifier.local?.name === 'string' ? specifier.local.name : undefined
        if (!local) continue
        if (!fromAuthoring) {
          shadowed.add(local)
          continue
        }
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaces.add(local)
          continue
        }
        if (specifier.type === 'ImportDefaultSpecifier')
          throw new Error(
            `${sourceLocation(file, node)}: "${authoringSource}" provides named exports only; import "Page", "Scroll", and friends by name`
          )
        if (specifier.type !== 'ImportSpecifier') continue
        const imported =
          typeof specifier.imported?.name === 'string' ? specifier.imported.name : undefined
        if (!imported) continue
        if (!isAuthoringComponent(imported))
          throw new Error(
            `${sourceLocation(file, node)}: "${imported}" is not an authoring component exported by "${authoringSource}"`
          )
        const existing = aliases.get(local)
        if (existing && existing !== imported)
          throw new Error(
            `${sourceLocation(file, node)}: import binding "${local}" is declared more than once for different authoring components`
          )
        aliases.set(local, imported)
      }
    }
  }
  return { aliases, namespaces, shadowed }
}

function isImportOnlyEsm(node: MdxjsEsmAstNode): boolean {
  const body = node.data?.estree?.body
  return (
    Array.isArray(body) &&
    body.length > 0 &&
    body.every((statement) => statement.type === 'ImportDeclaration')
  )
}

function resolveComponentName(
  name: string,
  bindings: ImportBindings,
  file: string,
  node: AstNode
): string {
  const dot = name.indexOf('.')
  if (dot > 0) {
    const namespace = name.slice(0, dot)
    const member = name.slice(dot + 1)
    if (bindings.namespaces.has(namespace)) {
      if (!isAuthoringComponent(member))
        throw new Error(
          `${sourceLocation(file, node)}: "${member}" is not an authoring component exported by "${authoringSource}"`
        )
      return member
    }
    if (bindings.shadowed.has(namespace)) return shadowedComponentName
    return name
  }
  const alias = bindings.aliases.get(name)
  if (alias) return alias
  if (bindings.shadowed.has(name)) return shadowedComponentName
  return name
}

function resolveComponentNames(
  nodes: AstNode[],
  bindings: ImportBindings,
  file: string
): AstNode[] {
  return nodes.map((node) => {
    const children = node.children
      ? resolveComponentNames(node.children, bindings, file)
      : undefined
    if (!isJsx(node)) return children ? { ...node, children } : node
    const canonicalName =
      typeof node.name === 'string' ? resolveComponentName(node.name, bindings, file, node) : ''
    return { ...node, canonicalName, ...(children ? { children } : {}) }
  })
}

export function parseMdx(source: string, file: string): { children: AstNode[] } {
  let tree: { children: AstNode[] }
  try {
    tree = processor.parse(source) as { children: AstNode[] }
  } catch (error) {
    const detail = error as {
      message?: string
      line?: number
      column?: number
    }
    const position = detail.line ? `:${detail.line}${detail.column ? `:${detail.column}` : ''}` : ''
    throw new Error(`${file}${position}: ${detail.message ?? String(error)}`)
  }
  const definitions = new Map<string, string>()
  for (const node of tree.children) {
    if (isDefinition(node) && typeof node.identifier === 'string' && typeof node.url === 'string') {
      definitions.set(node.identifier.toLowerCase(), node.url)
    }
  }

  // References are normalized to their resolved link/image variants by
  // building new nodes rather than mutating the parsed ones, so the node union
  // keeps its literal discriminants.
  const resolveReference = (node: LinkReferenceAstNode | ImageReferenceAstNode): AstNode => {
    const url = definitions.get((node.identifier ?? '').toLowerCase())
    if (!url) {
      throw new Error(
        `${sourceLocation(file, node)}: undefined Markdown reference "${node.identifier ?? ''}"`
      )
    }

    return isLinkReference(node)
      ? { type: 'link', url, children: node.children, position: node.position }
      : { type: 'image', url, alt: node.alt, position: node.position }
  }
  const resolveReferences = (nodes: AstNode[]): AstNode[] =>
    nodes.map((node) => {
      const resolved = isReference(node) ? resolveReference(node) : node
      return resolved.children
        ? { ...resolved, children: resolveReferences(resolved.children) }
        : resolved
    })

  const referencedChildren = resolveReferences(tree.children)
  const bindings = collectImportBindings(referencedChildren, file)
  const normalizedChildren = resolveComponentNames(referencedChildren, bindings, file)
  // Import declarations are inert metadata: `scorm-cli/authoring` imports drive
  // canonical component resolution while every other import shadows its local
  // bindings; imports are removed before content validation. Non-import ESM
  // (for example `export` statements) is left in place and rejected below.
  tree.children = normalizedChildren.filter(
    (node) => !isDefinition(node) && !(isMdxjsEsm(node) && isImportOnlyEsm(node))
  )
  return tree
}
