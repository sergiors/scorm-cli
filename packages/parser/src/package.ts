import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
  ContentNode,
  ContentPackage,
  GridNode,
  ImageNode,
  InlineContentNode,
  InlineNode,
  ItemNode,
  ListItemNode,
  PageNode,
  PathNode,
  QuestionNode,
  QuestionOption,
  QuestionType,
  QuestionnaireNode,
  RootPresentation,
  ScrollNode,
  VideoNode,
} from '@scorm-cli/core';
import { isRemoteReference } from '@scorm-cli/core';

type AstNode = {
  type: string;
  name?: string | null;
  value?: unknown;
  alt?: string | null;
  url?: string;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  lang?: string | null;
  children?: AstNode[];
  position?: { start?: { line?: number; column?: number } };
  attributes?: Array<{
    type: string;
    name?: string;
    value?: unknown;
    position?: unknown;
  }>;
  data?: {
    estree?: {
      body?: Array<{
        type?: string;
        source?: { value?: unknown };
        specifiers?: Array<{
          type?: string;
          local?: { name?: unknown };
          imported?: { name?: unknown } | null;
        }>;
      }>;
    };
  };
};

const processor = unified().use(remarkParse).use(remarkMdx);
const flowComponents = new Set(['Video', 'Question', 'Questionnaire', 'Path']);

/** The only module MDX content may import components from. */
const authoringSource = 'scorm-cli/authoring';

/**
 * Canonical component names recognized by the parser, in the same order as the
 * `scorm-cli/authoring` marker exports. Exported so tooling and tests can
 * assert the authoring vocabulary stays aligned with the parser contract.
 */
export const authoringComponentNames = [
  'Scroll',
  'Grid',
  'Page',
  'Item',
  'Path',
  'Image',
  'Video',
  'Questionnaire',
  'Question',
  'Prompt',
  'Option',
] as const;

const authoringComponents = new Set<string>(authoringComponentNames);

/**
 * Canonical component name for every parsed JSX node, resolved from
 * `scorm-cli/authoring` imports. Keyed by node identity so the same traversal
 * helpers can read it without threading resolver state through every call.
 */
const resolvedComponentNames = new WeakMap<AstNode, string>();

/**
 * Sentinel canonical name for JSX bound by an import from a module other than
 * `scorm-cli/authoring`. It matches no canonical component, so shadowed names
 * are reported as unknown instead of falling back to the legacy raw-name
 * vocabulary.
 */
const shadowedComponentName = '\u0000shadowed';

/** The canonical name a JSX node refers to after resolving authoring imports. */
function componentName(node: AstNode): string {
  return resolvedComponentNames.get(node) ?? node.name ?? '';
}

interface ImportBindings {
  /** Local names bound by named authoring imports, mapped to their marker. */
  aliases: Map<string, string>;
  /** Local names bound by `import * as` authoring imports. */
  namespaces: Set<string>;
  /**
   * Local names bound by imports from modules other than `scorm-cli/authoring`.
   * They can never name an authoring component, so JSX using one must be
   * treated as unknown instead of falling back to the canonical vocabulary.
   */
  shadowed: Set<string>;
}

/**
 * Collects import bindings from every ESM import in a document. Imports from
 * `scorm-cli/authoring` name canonical components (directly or through aliases
 * and namespace members); authoring bindings win over any other import. Every
 * other import still binds its local name, so it shadows the legacy raw-name
 * vocabulary even though it can never resolve to a canonical component.
 */
function collectImportBindings(nodes: AstNode[], file: string): ImportBindings {
  const aliases = new Map<string, string>();
  const namespaces = new Set<string>();
  const shadowed = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'mdxjsEsm') continue;
    for (const statement of node.data?.estree?.body ?? []) {
      if (statement.type !== 'ImportDeclaration') continue;
      const fromAuthoring = statement.source?.value === authoringSource;
      for (const specifier of statement.specifiers ?? []) {
        const local =
          typeof specifier.local?.name === 'string'
            ? specifier.local.name
            : undefined;
        if (!local) continue;
        if (!fromAuthoring) {
          shadowed.add(local);
          continue;
        }
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaces.add(local);
          continue;
        }
        if (specifier.type === 'ImportDefaultSpecifier')
          fail(
            file,
            `"${authoringSource}" provides named exports only; import "Page", "Scroll", and friends by name`,
            node,
          );
        if (specifier.type !== 'ImportSpecifier') continue;
        const imported =
          typeof specifier.imported?.name === 'string'
            ? specifier.imported.name
            : undefined;
        if (!imported) continue;
        if (!authoringComponents.has(imported))
          fail(
            file,
            `"${imported}" is not an authoring component exported by "${authoringSource}"`,
            node,
          );
        const existing = aliases.get(local);
        if (existing && existing !== imported)
          fail(
            file,
            `import binding "${local}" is declared more than once for different authoring components`,
            node,
          );
        aliases.set(local, imported);
      }
    }
  }
  return { aliases, namespaces, shadowed };
}

/** Whether an ESM node contains only import declarations and can be ignored. */
function isImportOnlyEsm(node: AstNode): boolean {
  const body = node.data?.estree?.body;
  return (
    Array.isArray(body) &&
    body.length > 0 &&
    body.every((statement) => statement.type === 'ImportDeclaration')
  );
}

/** Resolves a JSX name to its canonical authoring component name. */
function resolveComponentName(
  name: string,
  bindings: ImportBindings,
  file: string,
  node: AstNode,
): string {
  const dot = name.indexOf('.');
  if (dot > 0) {
    const namespace = name.slice(0, dot);
    const member = name.slice(dot + 1);
    if (bindings.namespaces.has(namespace)) {
      if (!authoringComponents.has(member))
        fail(
          file,
          `"${member}" is not an authoring component exported by "${authoringSource}"`,
          node,
        );
      return member;
    }
    if (bindings.shadowed.has(namespace)) return shadowedComponentName;
    return name;
  }
  const alias = bindings.aliases.get(name);
  if (alias) return alias;
  if (bindings.shadowed.has(name)) return shadowedComponentName;
  return name;
}

/** Records the canonical name of every JSX node in a parsed tree. */
function resolveComponentNames(
  nodes: AstNode[],
  bindings: ImportBindings,
  file: string,
): void {
  for (const node of nodes) {
    if (
      (node.type === 'mdxJsxFlowElement' ||
        node.type === 'mdxJsxTextElement') &&
      typeof node.name === 'string'
    ) {
      resolvedComponentNames.set(
        node,
        resolveComponentName(node.name, bindings, file, node),
      );
    }
    if (node.children) resolveComponentNames(node.children, bindings, file);
  }
}

function location(file: string, node?: AstNode): string {
  const line = node?.position?.start?.line;
  return `${file}${line ? `:${line}` : ''}`;
}

function fail(file: string, message: string, node?: AstNode): never {
  throw new Error(`${location(file, node)}: ${message}`);
}

function attrs(node: AstNode, file: string): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const attr of node.attributes ?? []) {
    if (attr.type !== 'mdxJsxAttribute' || !attr.name) {
      fail(file, 'spread/dynamic component attributes are not supported', node);
    }
    const raw = attr.value;
    if (raw === null) output[attr.name] = true;
    else if (typeof raw === 'string') output[attr.name] = raw;
    else if (raw && typeof raw === 'object' && 'value' in raw) {
      const value = (raw as { value: unknown }).value;
      if (typeof value === 'string' && /^(?:true|false)$/.test(value))
        output[attr.name] = value === 'true';
      else if (typeof value === 'string' && /^\d+$/.test(value))
        output[attr.name] = Number(value);
      else
        fail(
          file,
          `dynamic value for attribute "${attr.name}" is not supported`,
          node,
        );
    } else
      fail(
        file,
        `dynamic value for attribute "${attr.name}" is not supported`,
        node,
      );
  }
  return output;
}

function requiredString(
  value: unknown,
  name: string,
  file: string,
  node: AstNode,
): string {
  if (typeof value !== 'string' || !value.trim())
    fail(file, `"${name}" must be a non-empty string`, node);
  return value.trim();
}

function optionalString(
  value: unknown,
  name: string,
  file: string,
  node: AstNode,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name, file, node);
}

function canonicalLanguage(value: string | undefined, file: string): string {
  if (value === undefined) return 'en';
  try {
    return Intl.getCanonicalLocales(value)[0]!;
  } catch {
    throw new Error(
      `${file}: "lang" must be a valid BCP-47 language tag (for example, "en" or "pt-BR"); received "${value}"`,
    );
  }
}

function assertAttributes(
  values: Record<string, unknown>,
  allowed: string[],
  file: string,
  node: AstNode,
) {
  for (const key of Object.keys(values))
    if (!allowed.includes(key)) fail(file, `unknown attribute "${key}"`, node);
}

function assertFrontmatterKeys(
  data: Record<string, unknown>,
  allowed: string[],
  file: string,
): void {
  for (const key of Object.keys(data))
    if (!allowed.includes(key))
      fail(file, `unknown frontmatter field "${key}"`);
}

function normalizedRelative(
  root: string,
  absolute: string,
  file: string,
  node: AstNode,
  label: string,
): string {
  const rel = path.relative(root, absolute);
  if (!rel || rel === '.')
    fail(
      file,
      `${label} must refer to a file inside the content package directory`,
      node,
    );
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    fail(file, `${label} resolves outside the content package directory`, node);
  }
  return rel.split(path.sep).join('/');
}

async function assetReference(
  value: string,
  sourceFile: string,
  root: string,
  file: string,
  node: AstNode,
): Promise<string> {
  if (isRemoteReference(value) || value.startsWith('data:')) return value;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    fail(file, `asset reference "${value}" has invalid URL encoding`, node);
  }
  const absolute = path.resolve(path.dirname(sourceFile), decoded);
  const relative = normalizedRelative(
    root,
    absolute,
    file,
    node,
    'asset reference',
  );
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    fail(file, `asset "${value}" does not exist`, node);
  }
  if (!stat!.isFile()) fail(file, `asset "${value}" is not a file`, node);
  const realRoot = await fs.realpath(root);
  const realAsset = await fs.realpath(absolute);
  const realRelative = path.relative(realRoot, realAsset);
  if (
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    fail(
      file,
      `asset "${value}" resolves outside the content package directory`,
      node,
    );
  }
  return relative;
}

function parseMdx(source: string, file: string): { children: AstNode[] } {
  let tree: { children: AstNode[] };
  try {
    tree = processor.parse(source) as unknown as { children: AstNode[] };
  } catch (error) {
    const detail = error as {
      message?: string;
      line?: number;
      column?: number;
    };
    const position = detail.line
      ? `:${detail.line}${detail.column ? `:${detail.column}` : ''}`
      : '';
    throw new Error(`${file}${position}: ${detail.message ?? String(error)}`);
  }
  const definitions = new Map(
    tree.children
      .filter(
        (node) => node.type === 'definition' && node.identifier && node.url,
      )
      .map((node) => [node.identifier!.toLowerCase(), node.url!]),
  );
  const resolveReferences = (nodes: AstNode[]) => {
    for (const node of nodes) {
      if (node.type === 'linkReference' || node.type === 'imageReference') {
        const url = definitions.get(node.identifier?.toLowerCase() ?? '');
        if (!url)
          fail(
            file,
            `undefined Markdown reference "${node.identifier ?? ''}"`,
            node,
          );
        node.type = node.type === 'linkReference' ? 'link' : 'image';
        node.url = url;
      }
      if (node.children) resolveReferences(node.children);
    }
  };
  resolveReferences(tree.children);
  const bindings = collectImportBindings(tree.children, file);
  resolveComponentNames(tree.children, bindings, file);
  // Import declarations are inert metadata: `scorm-cli/authoring` imports drive
  // canonical component resolution while every other import shadows its local
  // bindings; imports are removed before content validation. Non-import ESM
  // (for example `export` statements) is left in place and rejected below.
  tree.children = tree.children.filter(
    (node) =>
      node.type !== 'definition' &&
      !(node.type === 'mdxjsEsm' && isImportOnlyEsm(node)),
  );
  return tree;
}

function isJsx(node: AstNode): boolean {
  return node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';
}

function whitespace(node: AstNode): boolean {
  return node.type === 'text' && !String(node.value ?? '').trim();
}

async function parseInlineNodes(
  nodes: AstNode[],
  sourceFile: string,
  root: string,
): Promise<InlineNode[]> {
  const output: InlineNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        output.push({ type: 'text', value: String(node.value ?? '') });
        break;
      case 'emphasis':
        output.push({
          type: 'emphasis',
          children: await parseInlineNodes(
            node.children ?? [],
            sourceFile,
            root,
          ),
        });
        break;
      case 'strong':
        output.push({
          type: 'strong',
          children: await parseInlineNodes(
            node.children ?? [],
            sourceFile,
            root,
          ),
        });
        break;
      case 'inlineCode':
        output.push({ type: 'inlineCode', value: String(node.value ?? '') });
        break;
      case 'link':
        output.push({
          type: 'link',
          href: node.url ?? '',
          children: await parseInlineNodes(
            node.children ?? [],
            sourceFile,
            root,
          ),
        });
        break;
      case 'image':
        output.push(await parseMarkdownImage(node, sourceFile, root));
        break;
      case 'break':
        output.push({ type: 'break' });
        break;
      case 'mdxJsxTextElement':
        if (componentName(node) !== 'Image') {
          if (componentName(node) === 'Question')
            fail(sourceFile, '<Question> must be inside <Questionnaire>', node);
          if (flowComponents.has(componentName(node)))
            fail(
              sourceFile,
              `component <${node.name ?? ''}> is block-only and cannot be used inline`,
              node,
            );
          fail(sourceFile, `unknown MDX component <${node.name ?? ''}>`, node);
        }
        output.push(await parseImageComponent(node, sourceFile, root));
        break;
      default:
        fail(sourceFile, `unsupported inline node "${node.type}"`, node);
    }
  }
  return output;
}

async function parseMarkdownImage(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<ImageNode> {
  return {
    type: 'image',
    src: await assetReference(
      node.url ?? '',
      sourceFile,
      root,
      sourceFile,
      node,
    ),
    alt: String(node.alt ?? node.value ?? ''),
  };
}

/**
 * Normalizes the parsed children of a single list item. Tight list items
 * (`spread === false`) render their inline runs without a block wrapper, so the
 * paragraphs the source parser reports are rewritten into {@link InlineContentNode}
 * runs. Every non-paragraph block (nested lists, quotes, code, media) is kept
 * as-is, preserving order and nesting; loose items keep their paragraphs.
 */
function normalizeListItemChildren(
  children: ContentNode[],
  tight: boolean,
): Array<ContentNode | InlineContentNode> {
  if (!tight) return children;
  return children.map((child) =>
    child.type === 'paragraph'
      ? { type: 'inlineContent', children: child.children }
      : child,
  );
}

async function parseContentNode(
  node: AstNode,
  sourceFile: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<ContentNode> {
  switch (node.type) {
    case 'heading':
      return {
        type: 'heading',
        depth: node.depth ?? 1,
        children: await parseInlineNodes(node.children ?? [], sourceFile, root),
      };
    case 'paragraph':
      return {
        type: 'paragraph',
        children: await parseInlineNodes(node.children ?? [], sourceFile, root),
      };
    case 'list': {
      // A tight list's items render inline, so their paragraphs become
      // `inlineContent` runs in the AST; loose items keep their paragraphs.
      const tight = node.spread === false;
      return {
        type: 'list',
        ordered: Boolean(node.ordered),
        ...(node.ordered && node.start != null && node.start !== 1
          ? { start: node.start }
          : {}),
        // Carry the source parser's exact tightness through unchanged; no
        // inference from structure or child count.
        ...(typeof node.spread === 'boolean' ? { spread: node.spread } : {}),
        items: await Promise.all(
          (node.children ?? []).map(async (item): Promise<ListItemNode> => ({
            children: normalizeListItemChildren(
              await contentChildren(
                item.children ?? [],
                sourceFile,
                root,
                rootPageSources,
              ),
              tight,
            ),
          })),
        ),
      };
    }
    case 'image':
      return parseMarkdownImage(node, sourceFile, root);
    case 'code':
      return {
        type: 'code',
        value: String(node.value ?? ''),
        ...(node.lang ? { language: node.lang } : {}),
      };
    case 'blockquote':
      return {
        type: 'quote',
        children: await contentChildren(
          node.children ?? [],
          sourceFile,
          root,
          rootPageSources,
        ),
      };
    case 'mdxJsxFlowElement':
      return parseContentComponent(node, sourceFile, root, rootPageSources);
    case 'mdxJsxTextElement':
      if (componentName(node) !== 'Image')
        if (flowComponents.has(componentName(node)))
          return parseContentComponent(node, sourceFile, root, rootPageSources);
        else
          fail(sourceFile, `unknown MDX component <${node.name ?? ''}>`, node);
      return parseImageComponent(node, sourceFile, root);
    default:
      fail(sourceFile, `unsupported content node "${node.type}"`, node);
  }
}

async function parseContentNodes(
  node: AstNode,
  sourceFile: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<ContentNode[]> {
  if (
    [
      'text',
      'emphasis',
      'strong',
      'inlineCode',
      'link',
      'image',
      'break',
    ].includes(node.type)
  ) {
    return [
      {
        type: 'paragraph',
        children: await parseInlineNodes([node], sourceFile, root),
      },
    ];
  }
  if (node.type === 'mdxJsxTextElement') {
    return [await parseContentNode(node, sourceFile, root, rootPageSources)];
  }
  if (node.type !== 'paragraph')
    return [await parseContentNode(node, sourceFile, root, rootPageSources)];
  const output: ContentNode[] = [];
  let inlineNodes: AstNode[] = [];
  const flushInline = async () => {
    if (!inlineNodes.length) return;
    const parsed = await parseInlineNodes(inlineNodes, sourceFile, root);
    if (
      parsed.some((child) => child.type !== 'text' || child.value.trim() !== '')
    ) {
      output.push({ type: 'paragraph', children: parsed });
    }
    inlineNodes = [];
  };
  for (const child of node.children ?? []) {
    if (
      child.type === 'mdxJsxFlowElement' ||
      (child.type === 'mdxJsxTextElement' &&
        flowComponents.has(componentName(child)))
    ) {
      if (componentName(child) === 'Question')
        fail(sourceFile, '<Question> must be inside <Questionnaire>', child);
      const index = (node.children ?? []).indexOf(child);
      const previous = node.children?.[index - 1];
      const next = node.children?.[index + 1];
      if (
        child.type === 'mdxJsxTextElement' &&
        ((previous && !whitespace(previous)) || (next && !whitespace(next)))
      ) {
        fail(
          sourceFile,
          `component <${child.name ?? ''}> is block-only and cannot be used inline`,
          child,
        );
      }
      await flushInline();
      output.push(
        await parseContentNode(child, sourceFile, root, rootPageSources),
      );
    } else {
      inlineNodes.push(child);
    }
  }
  await flushInline();
  return output;
}

async function parseContentComponent(
  node: AstNode,
  sourceFile: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<ContentNode> {
  const name = componentName(node);
  const file = sourceFile;
  if (name === 'Question')
    fail(file, '<Question> must be inside <Questionnaire>', node);
  if (name === 'Questionnaire')
    return parseQuestionnaire(node, sourceFile, root, rootPageSources);
  if (name === 'Path')
    return parsePath(node, sourceFile, root, rootPageSources);
  const values = attrs(node, file);
  if (name === 'Image') {
    return parseImageComponent(node, sourceFile, root);
  }
  if (name === 'Video') {
    assertAttributes(
      values,
      ['src', 'title', 'poster', 'captions'],
      file,
      node,
    );
    const src = requiredString(values.src, 'src', file, node);
    const title = optionalString(values.title, 'title', file, node);
    const poster = optionalString(values.poster, 'poster', file, node);
    const captions = optionalString(values.captions, 'captions', file, node);
    const video: VideoNode = {
      type: 'video',
      src: await assetReference(src, sourceFile, root, file, node),
      ...(title ? { title } : {}),
      ...(poster
        ? { poster: await assetReference(poster, sourceFile, root, file, node) }
        : {}),
      ...(captions
        ? {
            captions: await assetReference(
              captions,
              sourceFile,
              root,
              file,
              node,
            ),
          }
        : {}),
    };
    return video;
  }
  fail(file, `unknown MDX component <${node.name ?? ''}>`, node);
}

async function parseImageComponent(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<ImageNode> {
  const values = attrs(node, sourceFile);
  assertAttributes(values, ['src', 'alt', 'caption'], sourceFile, node);
  const src = requiredString(values.src, 'src', sourceFile, node);
  if (typeof values.alt !== 'string')
    fail(sourceFile, 'Image requires an explicit string "alt" attribute', node);
  const caption = optionalString(values.caption, 'caption', sourceFile, node);
  return {
    type: 'image',
    src: await assetReference(src, sourceFile, root, sourceFile, node),
    alt: values.alt,
    ...(caption ? { caption } : {}),
  };
}

async function contentChildren(
  nodes: AstNode[],
  sourceFile: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<ContentNode[]> {
  const output: ContentNode[] = [];
  let inline: AstNode[] = [];
  const flushInline = async () => {
    if (!inline.length) return;
    const children = await parseInlineNodes(inline, sourceFile, root);
    if (children.some((child) => child.type !== 'text' || child.value.trim()))
      output.push({ type: 'paragraph', children });
    inline = [];
  };
  for (const child of nodes) {
    if (whitespace(child)) {
      if (
        child.type === 'text' &&
        inline.length &&
        !/[\r\n]/.test(String(child.value ?? ''))
      ) {
        inline.push(child);
      } else {
        await flushInline();
      }
      continue;
    }
    if (child.type === 'mdxjsEsm')
      fail(sourceFile, 'MDX JavaScript is not supported', child);
    const inlineType = [
      'text',
      'emphasis',
      'strong',
      'inlineCode',
      'link',
      'image',
      'break',
    ].includes(child.type);
    const inlineImage =
      child.type === 'mdxJsxTextElement' && componentName(child) === 'Image';
    if (inlineType || inlineImage) inline.push(child);
    else {
      await flushInline();
      output.push(
        ...(await parseContentNodes(child, sourceFile, root, rootPageSources)),
      );
    }
  }
  await flushInline();
  return output;
}

async function parsePath(
  node: AstNode,
  file: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<PathNode> {
  const values = attrs(node, file);
  assertAttributes(values, [], file, node);
  const children = (node.children ?? [])
    .flatMap((child) => {
      if (
        child.type === 'paragraph' &&
        (child.children ?? []).every(
          (nested) =>
            whitespace(nested) ||
            (isJsx(nested) && componentName(nested) === 'Page'),
        )
      ) {
        return child.children ?? [];
      }
      return [child];
    })
    .filter((child) => !whitespace(child));

  if (children.length === 0)
    fail(
      file,
      'Path requires at least one direct <Page ref="..." /> child',
      node,
    );

  const pageIds: string[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (child.type !== 'mdxJsxFlowElement' || componentName(child) !== 'Page') {
      const found = child.name ? `<${child.name}>` : child.type;
      fail(
        file,
        `Path may contain only direct <Page ref="..." /> children; found ${found}`,
        child,
      );
    }
    if (meaningfulChildren(child.children ?? []).length > 0)
      fail(
        file,
        '<Page> inside <Path> must be self-closing and cannot contain children',
        child,
      );
    const pageValues = attrs(child, file);
    assertAttributes(pageValues, ['ref'], file, child);
    const ref = requiredString(pageValues.ref, 'ref', file, child);
    if (!rootPageSources)
      fail(
        file,
        'Path references are only valid for pages declared directly in a root <Scroll> presentation',
        child,
      );
    const source = normalizedRelative(
      root,
      path.resolve(root, ref),
      file,
      child,
      'Path Page ref',
    );
    if (!rootPageSources.has(source))
      fail(
        file,
        `Path Page ref "${ref}" does not match a root <Page src="..." /> in the root <Scroll> presentation`,
        child,
      );
    if (seen.has(source)) fail(file, `duplicate Path Page ref "${ref}"`, child);
    seen.add(source);
    pageIds.push(`page:${source}`);
  }
  return { type: 'path', pageIds };
}

async function parseQuestion(
  node: AstNode,
  file: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<QuestionNode> {
  const values = attrs(node, file);
  assertAttributes(values, ['type'], file, node);
  const rawType = values.type;
  if (
    rawType !== 'single-choice' &&
    rawType !== 'multiple-choice' &&
    rawType !== 'true-false'
  )
    fail(
      file,
      'Question "type" must be "single-choice", "multiple-choice", or "true-false"',
      node,
    );
  const children = (node.children ?? [])
    .flatMap((child) => {
      if (
        child.type === 'paragraph' &&
        (child.children ?? []).every(
          (nested) =>
            whitespace(nested) ||
            (isJsx(nested) &&
              (componentName(nested) === 'Prompt' ||
                componentName(nested) === 'Option')),
        )
      ) {
        return child.children ?? [];
      }
      return [child];
    })
    .filter((child) => !whitespace(child));
  const prompts: AstNode[] = [];
  const options: AstNode[] = [];
  for (const child of children) {
    if (!isJsx(child))
      fail(
        file,
        'Question may contain only <Prompt> and <Option> components',
        child,
      );
    if (componentName(child) === 'Prompt') prompts.push(child);
    else if (componentName(child) === 'Option') options.push(child);
    else fail(file, `unknown Question child <${child.name ?? ''}>`, child);
  }
  if (prompts.length !== 1)
    fail(
      file,
      `Question must contain exactly 1 Prompt; found ${prompts.length}`,
      node,
    );
  if (options.length < 2)
    fail(
      file,
      `Question must contain at least 2 Options; found ${options.length}`,
      node,
    );
  const promptNode = prompts[0]!;
  const promptAttrs = attrs(promptNode, file);
  assertAttributes(promptAttrs, [], file, promptNode);
  const prompt = await contentChildren(
    promptNode.children ?? [],
    file,
    root,
    rootPageSources,
  );
  const seenValues = new Set<string>();
  const parsedOptions: QuestionOption[] = [];
  for (const option of options) {
    const optionAttrs = attrs(option, file);
    assertAttributes(optionAttrs, ['value', 'correct'], file, option);
    const value = requiredString(optionAttrs.value, 'value', file, option);
    if (seenValues.has(value))
      fail(file, `Option value "${value}" must be unique`, option);
    seenValues.add(value);
    if (
      optionAttrs.correct !== undefined &&
      typeof optionAttrs.correct !== 'boolean'
    )
      fail(file, 'Option "correct" must be a boolean', option);
    parsedOptions.push({
      value,
      correct: optionAttrs.correct === true,
      content: await contentChildren(
        option.children ?? [],
        file,
        root,
        rootPageSources,
      ),
    });
  }
  const correctCount = parsedOptions.filter((option) => option.correct).length;
  if (rawType === 'single-choice' && correctCount !== 1)
    fail(
      file,
      'single-choice Question must have exactly one correct Option',
      node,
    );
  if (rawType === 'multiple-choice' && correctCount < 1)
    fail(
      file,
      'multiple-choice Question must have at least one correct Option',
      node,
    );
  if (rawType === 'true-false' && parsedOptions.length !== 2)
    fail(file, 'true-false Question must have exactly 2 Options', node);
  if (rawType === 'true-false' && correctCount !== 1)
    fail(
      file,
      'true-false Question must have exactly one correct Option',
      node,
    );
  return {
    type: 'question',
    id: await sourceNodeId('question', node, file, root),
    questionType: rawType as QuestionType,
    prompt,
    options: parsedOptions,
  };
}

async function sourceNodeId(
  kind: 'question' | 'questionnaire',
  node: AstNode,
  file: string,
  root: string,
): Promise<string> {
  const relativeFile = normalizedRelative(
    root,
    path.resolve(file),
    file,
    node,
    `${kind === 'question' ? 'Question' : 'Questionnaire'} source`,
  );
  const raw = await fs.readFile(file, 'utf8');
  const bodyStart = raw.indexOf(matter(raw).content);
  const lineOffset =
    raw.slice(0, Math.max(0, bodyStart)).split('\n').length - 1;
  const line = lineOffset + (node.position?.start?.line ?? 1);
  const column = node.position?.start?.column ?? 1;
  return `${kind}:${relativeFile}:${line}:${column}`;
}

async function parseQuestionnaire(
  node: AstNode,
  file: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<QuestionnaireNode> {
  const values = attrs(node, file);
  assertAttributes(values, [], file, node);

  const children = (node.children ?? [])
    .flatMap((child) => {
      if (
        child.type === 'paragraph' &&
        (child.children ?? []).every(
          (nested) =>
            whitespace(nested) ||
            (isJsx(nested) && componentName(nested) === 'Question'),
        )
      ) {
        return child.children ?? [];
      }
      return [child];
    })
    .filter((child) => !whitespace(child));
  if (!children.length)
    fail(
      file,
      'Questionnaire must contain at least one direct <Question>',
      node,
    );

  const questions: QuestionNode[] = [];
  for (const child of children) {
    if (!isJsx(child) || componentName(child) !== 'Question') {
      const found = child.name ? `<${child.name}>` : child.type;
      fail(
        file,
        `Questionnaire may contain only direct <Question> children; found ${found}`,
        child,
      );
    }
    questions.push(await parseQuestion(child, file, root, rootPageSources));
  }

  return {
    type: 'questionnaire',
    id: await sourceNodeId('questionnaire', node, file, root),
    questions,
  };
}

async function parseReference<T extends PageNode | ItemNode>(
  kind: 'page' | 'item',
  src: string,
  node: AstNode,
  declaredIn: string,
  root: string,
  ids: Set<string>,
  rootPageSources?: Set<string>,
): Promise<T> {
  const sourcePath = path.resolve(path.dirname(declaredIn), src);
  const source = normalizedRelative(
    root,
    sourcePath,
    declaredIn,
    node,
    `${kind === 'page' ? 'Page' : 'Item'} src`,
  );
  let raw: string;
  try {
    raw = await fs.readFile(sourcePath, 'utf8');
  } catch {
    fail(
      declaredIn,
      `${kind === 'page' ? 'Page' : 'Item'} source "${src}" does not exist`,
      node,
    );
  }
  const realRoot = await fs.realpath(root);
  const realSource = await fs.realpath(sourcePath);
  const realSourceRelative = path.relative(realRoot, realSource);
  if (
    realSourceRelative === '..' ||
    realSourceRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realSourceRelative)
  ) {
    fail(
      declaredIn,
      `${kind === 'page' ? 'Page' : 'Item'} source "${src}" resolves outside the content package directory`,
      node,
    );
  }
  const parsed = matter(raw!);
  assertFrontmatterKeys(
    parsed.data as Record<string, unknown>,
    kind === 'page' ? ['title', 'description'] : ['title'],
    sourcePath,
  );
  const title = requiredString(parsed.data.title, 'title', sourcePath, {
    type: 'frontmatter',
  });
  const id = `${kind}:${source}`;
  if (ids.has(id)) fail(sourcePath, `duplicate package node id "${id}"`, node);
  ids.add(id);
  const description =
    kind === 'page'
      ? optionalString(parsed.data.description, 'description', sourcePath, {
          type: 'frontmatter',
        })
      : undefined;
  const metadata = { title, ...(description ? { description } : {}) };
  const tree = parseMdx(parsed.content, sourcePath);
  const content: ContentNode[] = [];
  for (const child of tree.children) {
    if (child.type === 'mdxjsEsm') {
      fail(sourcePath, 'MDX JavaScript is not supported', child);
    }
    content.push(
      ...(await parseContentNodes(
        child,
        sourcePath,
        root,
        kind === 'page' ? rootPageSources : undefined,
      )),
    );
  }
  return {
    type: kind,
    id,
    source,
    metadata,
    content,
  } as T;
}

function meaningfulChildren(nodes: AstNode[]): AstNode[] {
  return nodes.filter((node) => !whitespace(node));
}

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
    if (node.type === 'mdxjsEsm')
      fail(declaredIn, 'MDX JavaScript is not supported', node);
    if (node.type !== 'mdxJsxFlowElement' || componentName(node) !== expected) {
      const found = node.name ? `<${node.name}>` : node.type;
      fail(
        declaredIn,
        `${kind === 'page' ? '<Scroll>' : '<Grid>'} children may only contain direct <${expected} src="..." /> components; found ${found}`,
        node,
      );
    }
    if (meaningfulChildren(node.children ?? []).length > 0)
      fail(
        declaredIn,
        `<${expected}> must be self-closing and cannot contain children`,
        node,
      );
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

function declaredRootPageSources(
  nodes: AstNode[],
  entry: string,
  root: string,
): Set<string> {
  const sources = new Set<string>();
  for (const node of meaningfulChildren(nodes)) {
    // The normal presentation validator reports malformed children. This
    // preliminary pass only gathers valid root Page declarations so content
    // can resolve forward references while each Page is parsed exactly once.
    if (node.type !== 'mdxJsxFlowElement' || componentName(node) !== 'Page')
      continue;
    if (meaningfulChildren(node.children ?? []).length > 0) continue;
    const values = attrs(node, entry);
    assertAttributes(values, ['src'], entry, node);
    const src = requiredString(values.src, 'src', entry, node);
    sources.add(
      normalizedRelative(
        root,
        path.resolve(path.dirname(entry), src),
        entry,
        node,
        'Page src',
      ),
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
    if (!pages.length)
      fail(entry, '<Scroll> must contain at least one <Page>; found 0', node);
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
  if (!items.length)
    fail(entry, '<Grid> must contain at least one <Item>; found 0', node);
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
  const entry = stat.isDirectory()
    ? path.join(absolute, 'index.mdx')
    : absolute;
  const root = stat.isDirectory() ? absolute : path.dirname(absolute);
  let source: string;
  try {
    source = await fs.readFile(entry, 'utf8');
  } catch {
    throw new Error(`${entry}: unable to read content package entry`);
  }
  const parsed = matter(source);
  assertFrontmatterKeys(
    parsed.data as Record<string, unknown>,
    ['title', 'lang'],
    entry,
  );
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
