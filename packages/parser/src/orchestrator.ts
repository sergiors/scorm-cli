import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type {
  ContentPackage,
  PageNode,
  RootPresentation,
  ScrollNode,
  SlidesNode,
  ItemNode,
  TilesNode
} from '@scorm-cli/core'
import type { AstNode } from './ast'
import { meaningfulChildren, rawComponentName } from './ast'
import {
  assertAttributes,
  assertFrontmatterKeys,
  attrs,
  canonicalLanguage,
  sourceLocation,
  normalizedRelative,
  optionalString,
  requiredString
} from './shared'
import { componentName } from './component-name'
import { parseMdx } from './mdx'
import { hasComponentContext } from './components'
import { parseReference } from './reference'

function presentationChildSource(node: AstNode, declaredIn: string): string {
  const values = attrs(node, declaredIn)
  assertAttributes(values, ['src'], declaredIn, node)
  return requiredString(values.src, 'src', declaredIn, node)
}

function hasPresentationChildContent(node: AstNode): boolean {
  return meaningfulChildren(node.children ?? []).length > 0
}

function parsePresentationChildren(
  nodes: AstNode[],
  kind: 'page',
  container: string,
  declaredIn: string,
  root: string,
  ids: Set<string>,
  rootPageSources?: Set<string>
): Promise<PageNode[]>
function parsePresentationChildren(
  nodes: AstNode[],
  kind: 'item',
  container: string,
  declaredIn: string,
  root: string,
  ids: Set<string>
): Promise<ItemNode[]>
async function parsePresentationChildren(
  nodes: AstNode[],
  kind: 'page' | 'item',
  container: string,
  declaredIn: string,
  root: string,
  ids: Set<string>,
  rootPageSources?: Set<string>
): Promise<Array<PageNode | ItemNode>> {
  const output: Array<PageNode | ItemNode> = []
  const expected = kind === 'page' ? 'Page' : 'Item'
  for (const node of meaningfulChildren(nodes)) {
    if (node.type === 'mdxjsEsm')
      throw new Error(`${sourceLocation(declaredIn, node)}: MDX JavaScript is not supported`)
    if (node.type !== 'mdxJsxFlowElement' || componentName(node) !== expected) {
      const name = rawComponentName(node)
      const found = name ? `<${name}>` : node.type
      throw new Error(
        `${sourceLocation(declaredIn, node)}: ${container} children may only contain direct <${expected} src="..." /> components; found ${found}`
      )
    }
    if (hasPresentationChildContent(node))
      throw new Error(
        `${sourceLocation(declaredIn, node)}: <${expected}> must be self-closing and cannot contain children`
      )
    const src = presentationChildSource(node, declaredIn)
    if (kind === 'page') {
      output.push(await parseReference('page', src, node, declaredIn, root, ids, rootPageSources))
    } else {
      output.push(await parseReference('item', src, node, declaredIn, root, ids))
    }
  }
  return output
}

function declaredRootPageSources(nodes: AstNode[], entry: string, root: string): Set<string> {
  const sources = new Set<string>()
  for (const node of meaningfulChildren(nodes)) {
    // The normal presentation validator reports malformed children. This
    // preliminary pass only gathers valid root Page declarations so content
    // can resolve forward references while each Page is parsed exactly once.
    if (node.type !== 'mdxJsxFlowElement' || componentName(node) !== 'Page') continue
    if (hasPresentationChildContent(node)) continue
    try {
      const src = presentationChildSource(node, entry)
      sources.add(
        normalizedRelative(root, path.resolve(path.dirname(entry), src), entry, node, 'Page src')
      )
    } catch {
      // Defer malformed declarations to the ordered presentation parser below.
      // In particular, a later Page must not make this look-ahead pass mask an
      // earlier invalid Scroll child. Keep scanning so references can still
      // resolve to later valid declarations.
      continue
    }
  }
  return sources
}

async function parseRootPresentation(
  nodes: AstNode[],
  entry: string,
  root: string
): Promise<RootPresentation> {
  const directNodes = meaningfulChildren(nodes)
  if (directNodes.length !== 1) {
    throw new Error(
      `${sourceLocation(entry, directNodes[0])}: root must contain exactly one <Scroll>, <Slides> or <Tiles> presentation; found ${directNodes.length}`
    )
  }

  const node = directNodes[0]!
  if (node.type !== 'mdxJsxFlowElement' || !hasComponentContext(componentName(node), 'root')) {
    const name = rawComponentName(node)
    const found = name ? `<${name}>` : node.type
    throw new Error(
      `${sourceLocation(entry, node)}: root must contain exactly one <Scroll>, <Slides> or <Tiles> presentation; found 1 direct node (${found})`
    )
  }

  const ids = new Set<string>()
  const values = attrs(node, entry)
  const name = componentName(node)

  if (name === 'Scroll' || name === 'Slides') {
    assertAttributes(values, [], entry, node)
    const container = `<${name}>`
    const pages = await parsePresentationChildren(
      node.children ?? [],
      'page',
      container,
      entry,
      root,
      ids,
      declaredRootPageSources(node.children ?? [], entry, root)
    )
    if (!pages.length) {
      throw new Error(
        `${sourceLocation(entry, node)}: ${container} must contain at least one <Page>; found 0`
      )
    }

    return name === 'Scroll'
      ? ({ type: 'scroll', pages } satisfies ScrollNode)
      : ({ type: 'slides', pages } satisfies SlidesNode)
  }

  assertAttributes(values, ['columns'], entry, node)
  const columns = values.columns
  if (
    columns !== undefined &&
    (!Number.isInteger(columns) || Number(columns) < 1 || Number(columns) > 12)
  ) {
    throw new Error(
      `${sourceLocation(entry, node)}: <Tiles> "columns" must be an integer from 1 to 12`
    )
  }
  const items = await parsePresentationChildren(
    node.children ?? [],
    'item',
    '<Tiles>',
    entry,
    root,
    ids
  )

  if (!items.length) {
    throw new Error(
      `${sourceLocation(entry, node)}: <Tiles> must contain at least one <Item>; found 0`
    )
  }

  return {
    type: 'tiles',
    ...(columns !== undefined ? { columns: Number(columns) } : {}),
    items
  } satisfies TilesNode
}

export interface ParsedPackageLocation {
  content: ContentPackage
  contentRoot: string
  entrypoint: string
}

interface PackageLocation {
  contentRoot: string
  entrypoint: string
}

interface PackageMetadata {
  title: string
  lang: string
}

function packageLocation(
  absolutePath: string,
  stat: Awaited<ReturnType<typeof fs.stat>>
): PackageLocation {
  if (stat.isDirectory()) {
    return {
      contentRoot: absolutePath,
      entrypoint: path.join(absolutePath, 'index.mdx')
    }
  }

  if (stat.isFile()) {
    return {
      contentRoot: path.dirname(absolutePath),
      entrypoint: absolutePath
    }
  }

  throw new Error(`${absolutePath}: content package path must be a file or directory`)
}

async function statPackagePath(absolutePath: string): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  try {
    return await fs.stat(absolutePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code

    const detail =
      code === 'ENOENT'
        ? 'content package path does not exist'
        : 'unable to access content package path'

    throw new Error(`${absolutePath}: ${detail}`, {
      cause: error
    })
  }
}

async function resolvePackageLocation(pathOrDir: string): Promise<PackageLocation> {
  const absolutePath = path.resolve(pathOrDir)
  const stat = await statPackagePath(absolutePath)

  return packageLocation(absolutePath, stat)
}

async function readPackageEntrypoint(entrypoint: string): Promise<string> {
  try {
    return await fs.readFile(entrypoint, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code

    const detail =
      code === 'ENOENT'
        ? 'content package entry does not exist'
        : 'unable to read content package entry'

    throw new Error(`${entrypoint}: ${detail}`, {
      cause: error
    })
  }
}

function parseFrontmatter(source: string, sourceFile: string): ReturnType<typeof matter> {
  try {
    return matter(source)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)

    throw new Error(`${sourceFile}: invalid frontmatter: ${detail}`, {
      cause: error
    })
  }
}

function parsePackageMetadata(data: Record<string, unknown>, sourceFile: string): PackageMetadata {
  assertFrontmatterKeys(data, ['title', 'lang'], sourceFile)

  const title = requiredString(data.title, 'title', sourceFile, {
    type: 'frontmatter'
  })

  const lang = canonicalLanguage(
    optionalString(data.lang, 'lang', sourceFile, {
      type: 'frontmatter'
    }),
    sourceFile
  )

  return {
    title,
    lang
  }
}

export async function parsePackageWithPaths(pathOrDir: string): Promise<ParsedPackageLocation> {
  const { contentRoot, entrypoint } = await resolvePackageLocation(pathOrDir)

  const source = await readPackageEntrypoint(entrypoint)
  const parsed = parseFrontmatter(source, entrypoint)
  const metadata = parsePackageMetadata(parsed.data, entrypoint)
  const tree = parseMdx(parsed.content, entrypoint)

  const presentation = await parseRootPresentation(tree.children, entrypoint, contentRoot)

  return {
    content: {
      metadata,
      presentation
    },
    contentRoot,
    entrypoint
  }
}

export async function parsePackage(pathOrDir: string): Promise<ContentPackage> {
  const parsed = await parsePackageWithPaths(pathOrDir)

  return parsed.content
}
