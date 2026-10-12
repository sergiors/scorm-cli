import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type {
  ContentPackage,
  GridNode,
  ItemNode,
  PageNode,
  RootPresentation,
  ScrollNode,
} from '@scorm-cli/core';
import {
  AstNode,
  assertAttributes,
  assertFrontmatterKeys,
  attrs,
  canonicalLanguage,
  fail,
  meaningfulChildren,
  normalizedRelative,
  optionalString,
  requiredString,
} from './shared';
import { componentName, parseMdx } from './mdx';
import { parseReference } from './reference';

async function parsePresentationChildren<T extends PageNode | ItemNode>(
  nodes: AstNode[],
  kind: 'page' | 'item',
  declaredIn: string,
  root: string,
  ids: Set<string>,
  rootPageSources?: Set<string>,
): Promise<T[]> {
  const output: T[] = [];
  const expected = kind === 'page' ? 'Page' : 'Item';
  for (const node of meaningfulChildren(nodes)) {
    if (node.type === 'mdxjsEsm') fail(declaredIn, 'MDX JavaScript is not supported', node);
    if (node.type !== 'mdxJsxFlowElement' || componentName(node) !== expected) {
      const found = node.name ? `<${node.name}>` : node.type;
      fail(
        declaredIn,
        `${kind === 'page' ? '<Scroll>' : '<Grid>'} children may only contain direct <${expected} src="..." /> components; found ${found}`,
        node,
      );
    }
    if (meaningfulChildren(node.children ?? []).length > 0)
      fail(declaredIn, `<${expected}> must be self-closing and cannot contain children`, node);
    const values = attrs(node, declaredIn);
    assertAttributes(values, ['src'], declaredIn, node);
    const src = requiredString(values.src, 'src', declaredIn, node);
    output.push(
      await parseReference<T>(
        kind,
        src,
        node,
        declaredIn,
        root,
        ids,
        kind === 'page' ? rootPageSources : undefined,
      ),
    );
  }
  return output;
}

function declaredRootPageSources(nodes: AstNode[], entry: string, root: string): Set<string> {
  const sources = new Set<string>();
  for (const node of meaningfulChildren(nodes)) {
    // The normal presentation validator reports malformed children. This
    // preliminary pass only gathers valid root Page declarations so content
    // can resolve forward references while each Page is parsed exactly once.
    if (node.type !== 'mdxJsxFlowElement' || componentName(node) !== 'Page') continue;
    if (meaningfulChildren(node.children ?? []).length > 0) continue;
    const values = attrs(node, entry);
    assertAttributes(values, ['src'], entry, node);
    const src = requiredString(values.src, 'src', entry, node);
    sources.add(
      normalizedRelative(root, path.resolve(path.dirname(entry), src), entry, node, 'Page src'),
    );
  }
  return sources;
}

async function parseRootPresentation(
  nodes: AstNode[],
  entry: string,
  root: string,
): Promise<RootPresentation> {
  const directNodes = meaningfulChildren(nodes);
  if (directNodes.length !== 1) {
    fail(
      entry,
      `root must contain exactly one <Scroll> or <Grid> presentation; found ${directNodes.length}`,
      directNodes[0],
    );
  }
  const node = directNodes[0]!;
  if (
    node.type !== 'mdxJsxFlowElement' ||
    (componentName(node) !== 'Scroll' && componentName(node) !== 'Grid')
  ) {
    const found = node.name ? `<${node.name}>` : node.type;
    fail(
      entry,
      `root must contain exactly one <Scroll> or <Grid> presentation; found 1 direct node (${found})`,
      node,
    );
  }

  const ids = new Set<string>();
  const values = attrs(node, entry);
  if (componentName(node) === 'Scroll') {
    assertAttributes(values, [], entry, node);
    const pages = await parsePresentationChildren<PageNode>(
      node.children ?? [],
      'page',
      entry,
      root,
      ids,
      declaredRootPageSources(node.children ?? [], entry, root),
    );
    if (!pages.length) fail(entry, '<Scroll> must contain at least one <Page>; found 0', node);
    return { type: 'scroll', pages } satisfies ScrollNode;
  }

  assertAttributes(values, ['columns'], entry, node);
  const columns = values.columns;
  if (
    columns !== undefined &&
    (!Number.isInteger(columns) || Number(columns) < 1 || Number(columns) > 12)
  ) {
    fail(entry, '<Grid> "columns" must be an integer from 1 to 12', node);
  }
  const items = await parsePresentationChildren<ItemNode>(
    node.children ?? [],
    'item',
    entry,
    root,
    ids,
  );
  if (!items.length) fail(entry, '<Grid> must contain at least one <Item>; found 0', node);
  return {
    type: 'grid',
    ...(columns !== undefined ? { columns: Number(columns) } : {}),
    items,
  } satisfies GridNode;
}

/** Parse an entry MDX file, or a directory containing index.mdx, into a content package. */
export async function parsePackage(pathOrDir: string): Promise<ContentPackage> {
  const absolute = path.resolve(pathOrDir);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    throw new Error(`${absolute}: content package path does not exist`);
  }
  const entry = stat.isDirectory() ? path.join(absolute, 'index.mdx') : absolute;
  const root = stat.isDirectory() ? absolute : path.dirname(absolute);
  let source: string;
  try {
    source = await fs.readFile(entry, 'utf8');
  } catch {
    throw new Error(`${entry}: unable to read content package entry`);
  }
  const parsed = matter(source);
  assertFrontmatterKeys(parsed.data, ['title', 'lang'], entry);
  const title = requiredString(parsed.data.title, 'title', entry, {
    type: 'frontmatter',
  });
  const lang = canonicalLanguage(
    optionalString(parsed.data.lang, 'lang', entry, { type: 'frontmatter' }),
    entry,
  );
  const tree = parseMdx(parsed.content, entry);
  const presentation = await parseRootPresentation(tree.children, entry, root);
  const contentPackage: ContentPackage = {
    metadata: { title, lang },
    presentation,
  };
  return contentPackage;
}
