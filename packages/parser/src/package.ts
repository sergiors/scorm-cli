import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { toString } from 'mdast-util-to-string';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
  ContentNode,
  ContentPackage,
  ItemOpenMode,
  ItemNode,
  SectionNode,
  StructureNode,
} from '@scorm-cli/core';
import { isRemoteReference } from '@scorm-cli/core';

type AstNode = {
  type: string;
  name?: string | null;
  value?: unknown;
  url?: string;
  depth?: number;
  ordered?: boolean | null;
  lang?: string | null;
  children?: AstNode[];
  position?: { start?: { line?: number; column?: number } };
  attributes?: Array<{
    type: string;
    name?: string;
    value?: unknown;
    position?: unknown;
  }>;
};

const processor = unified().use(remarkParse).use(remarkMdx);
const explicitIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

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

function plainText(node: AstNode): string {
  return toString(node as never).trim();
}

function parseMdx(source: string, file: string): { children: AstNode[] } {
  try {
    return processor.parse(source) as unknown as { children: AstNode[] };
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
}

async function parseContentNode(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<ContentNode> {
  switch (node.type) {
    case 'heading':
      return { type: 'heading', depth: node.depth ?? 1, text: plainText(node) };
    case 'paragraph':
      return { type: 'paragraph', text: plainText(node) };
    case 'list':
      return {
        type: 'list',
        ordered: Boolean(node.ordered),
        items: (node.children ?? []).map((item) => plainText(item)),
      };
    case 'link':
      return { type: 'link', href: node.url ?? '', text: plainText(node) };
    case 'image':
      return {
        type: 'image',
        src: await assetReference(
          node.url ?? '',
          sourceFile,
          root,
          sourceFile,
          node,
        ),
        alt: String(node.value ?? ''),
      };
    case 'code':
      return {
        type: 'code',
        value: String(node.value ?? ''),
        ...(node.lang ? { language: node.lang } : {}),
      };
    case 'blockquote':
      return { type: 'quote', text: plainText(node) };
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement':
      return parseContentComponent(node, sourceFile, root);
    default:
      throw new Error(
        `${location(sourceFile, node)}: unsupported content node "${node.type}"`,
      );
  }
}

async function parseContentNodes(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<ContentNode[]> {
  if (node.type !== 'paragraph')
    return [await parseContentNode(node, sourceFile, root)];
  const output: ContentNode[] = [];
  let text = '';
  const flushText = () => {
    const value = text.trim();
    if (value) output.push({ type: 'paragraph', text: value });
    text = '';
  };
  for (const child of node.children ?? []) {
    if (
      child.type === 'mdxJsxTextElement' ||
      child.type === 'mdxJsxFlowElement' ||
      child.type === 'link' ||
      child.type === 'image'
    ) {
      flushText();
      output.push(await parseContentNode(child, sourceFile, root));
    } else {
      text += `${text ? ' ' : ''}${plainText(child)}`;
    }
  }
  flushText();
  if (!output.length) output.push({ type: 'paragraph', text: plainText(node) });
  return output;
}

async function parseContentComponent(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<ContentNode> {
  const name = node.name ?? '';
  const file = sourceFile;
  const values = attrs(node, file);
  if (name === 'Image') {
    assertAttributes(values, ['src', 'alt'], file, node);
    const src = requiredString(values.src, 'src', file, node);
    return {
      type: 'image',
      src: await assetReference(src, sourceFile, root, file, node),
      alt: String(values.alt ?? ''),
    };
  }
  if (name === 'Video') {
    assertAttributes(values, ['src', 'url', 'title'], file, node);
    const src = requiredString(values.src ?? values.url, 'src', file, node);
    const title = optionalString(values.title, 'title', file, node);
    return {
      type: 'video',
      src: isRemoteReference(src)
        ? src
        : await assetReference(src, sourceFile, root, file, node),
      ...(title ? { title } : {}),
    };
  }
  if (name === 'Question') return parseQuestion(node, sourceFile);
  fail(file, `unknown MDX component <${name}>`, node);
}

function parseQuestion(node: AstNode, file: string): ContentNode {
  const values = attrs(node, file);
  assertAttributes(values, ['questionType', 'type', 'question'], file, node);
  const rawType = values.questionType ?? values.type;
  const questionType =
    rawType === 'single-choice' || rawType === 'single'
      ? 'single-choice'
      : rawType === 'multiple-choice' || rawType === 'multiple'
        ? 'multiple-choice'
        : undefined;
  if (!questionType)
    fail(
      file,
      'Question "questionType" must be "single-choice" or "multiple-choice"',
      node,
    );
  const questionChildren = (node.children ?? []).flatMap((child) =>
    child.type === 'paragraph' ? (child.children ?? []) : [child],
  );
  const promptChild = questionChildren.find(
    (child) =>
      (child.type === 'mdxJsxFlowElement' ||
        child.type === 'mdxJsxTextElement') &&
      child.name === 'Prompt',
  );
  const question = requiredString(
    values.question ?? (promptChild ? plainText(promptChild) : undefined),
    'question',
    file,
    node,
  );
  const answerNodes = questionChildren.filter(
    (child) =>
      (child.type === 'mdxJsxFlowElement' ||
        child.type === 'mdxJsxTextElement') &&
      (child.name === 'Answer' || child.name === 'Option'),
  );
  for (const child of questionChildren) {
    if (child.type === 'text' && !String(child.value ?? '').trim()) continue;
    if (
      child.type === 'paragraph' ||
      child === promptChild ||
      answerNodes.includes(child)
    )
      continue;
    if (
      child.type === 'mdxJsxFlowElement' ||
      child.type === 'mdxJsxTextElement'
    ) {
      if (child.name !== 'Prompt')
        fail(file, `unknown Question child <${child.name}>`, child);
      continue;
    }
    fail(file, `unsupported Question child "${child.type}"`, child);
  }
  if (answerNodes.length < 2)
    fail(file, 'Question must contain at least two Answer components', node);
  const answers = answerNodes.map((answer) => {
    if (
      (answer.children ?? []).some(
        (child) =>
          child.type === 'mdxJsxFlowElement' ||
          child.type === 'mdxJsxTextElement',
      )
    ) {
      fail(file, 'Answer content cannot contain components', answer);
    }
    const answerValues = attrs(answer, file);
    assertAttributes(answerValues, ['correct'], file, answer);
    if (
      answerValues.correct !== undefined &&
      typeof answerValues.correct !== 'boolean'
    ) {
      fail(file, 'Answer "correct" must be a boolean', answer);
    }
    return { text: plainText(answer), correct: answerValues.correct === true };
  });
  const correctCount = answers.filter((answer) => answer.correct).length;
  if (correctCount === 0)
    fail(file, 'Question must have at least one correct answer', node);
  if (questionType === 'single-choice' && correctCount !== 1)
    fail(
      file,
      'single-choice Question must have exactly one correct answer',
      node,
    );
  return { type: 'question', questionType, question, answers };
}

async function parseItem(
  src: string,
  node: AstNode,
  declaredIn: string,
  root: string,
  ids: Set<string>,
  open: ItemOpenMode,
  itemId?: unknown,
): Promise<ItemNode> {
  const sourcePath = path.resolve(path.dirname(declaredIn), src);
  const source = normalizedRelative(
    root,
    sourcePath,
    declaredIn,
    node,
    'Item src',
  );
  let raw: string;
  try {
    raw = await fs.readFile(sourcePath, 'utf8');
  } catch {
    fail(declaredIn, `Item source "${src}" does not exist`, node);
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
      `Item source "${src}" resolves outside the content package directory`,
      node,
    );
  }
  const parsed = matter(raw!);
  assertFrontmatterKeys(
    parsed.data as Record<string, unknown>,
    ['title', 'description', 'thumbnail', 'id'],
    sourcePath,
  );
  const title = requiredString(parsed.data.title, 'title', sourcePath, node);
  if (
    parsed.data.description !== undefined &&
    typeof parsed.data.description !== 'string'
  ) {
    fail(sourcePath, 'frontmatter "description" must be a string', node);
  }
  const explicit = parsed.data.id;
  if (
    explicit !== undefined &&
    (typeof explicit !== 'string' || !explicitIdPattern.test(explicit))
  ) {
    fail(
      sourcePath,
      'frontmatter "id" must contain only letters, numbers, ., _, :, or -',
      node,
    );
  }
  const id =
    (itemId as string | undefined) ??
    (explicit as string | undefined) ??
    `item:${source}`;
  if (
    itemId !== undefined &&
    (typeof itemId !== 'string' || !explicitIdPattern.test(itemId))
  )
    fail(declaredIn, `invalid id "${String(itemId)}"`, node);
  if (ids.has(id)) fail(sourcePath, `duplicate package node id "${id}"`, node);
  ids.add(id);
  const metadata: ItemNode['metadata'] = { title };
  if (parsed.data.description !== undefined)
    metadata.description = parsed.data.description;
  if (parsed.data.thumbnail !== undefined) {
    if (
      typeof parsed.data.thumbnail !== 'string' ||
      !parsed.data.thumbnail.trim()
    )
      fail(sourcePath, 'frontmatter "thumbnail" must be a path or URL', node);
    metadata.thumbnail = isRemoteReference(parsed.data.thumbnail)
      ? parsed.data.thumbnail
      : await assetReference(
          parsed.data.thumbnail,
          sourcePath,
          root,
          sourcePath,
          node,
        );
  }
  const tree = parseMdx(parsed.content, sourcePath);
  const content: ContentNode[] = [];
  for (const child of tree.children) {
    if (child.type === 'mdxjsEsm') {
      fail(sourcePath, 'MDX JavaScript and imports are not supported', child);
    }
    content.push(...(await parseContentNodes(child, sourcePath, root)));
  }
  return {
    type: 'item',
    id,
    source,
    presentation: { open },
    metadata,
    content,
  };
}

async function parseStructure(
  nodes: AstNode[],
  declaredIn: string,
  root: string,
  pathIndices: number[],
  ids: Set<string>,
  allowSections = true,
): Promise<StructureNode[]> {
  const result: StructureNode[] = [];
  let index = 0;
  for (const node of nodes) {
    if (node.type === 'text' && !String(node.value ?? '').trim()) continue;
    if (node.type === 'mdxjsEsm') {
      fail(declaredIn, 'MDX JavaScript and imports are not supported', node);
    }
    if (node.type !== 'mdxJsxFlowElement' || !node.name) {
      fail(
        declaredIn,
        `entry structure only accepts <Section> and <Item>; found ${node.type}`,
        node,
      );
    }
    const values = attrs(node, declaredIn);
    if (node.name === 'Item') {
      assertAttributes(values, ['src', 'id', 'open'], declaredIn, node);
      const src = requiredString(values.src, 'src', declaredIn, node);
      const open = values.open ?? 'page';
      if (open !== 'page' && open !== 'modal')
        fail(declaredIn, 'Item "open" must be "page" or "modal"', node);
      const itemId =
        values.id === undefined
          ? undefined
          : requiredString(values.id, 'id', declaredIn, node);
      const item = await parseItem(
        src,
        node,
        declaredIn,
        root,
        ids,
        open,
        itemId,
      );
      result.push(item);
      index++;
      continue;
    }
    if (node.name !== 'Section')
      fail(declaredIn, `unknown MDX component <${node.name}>`, node);
    if (!allowSections)
      fail(
        declaredIn,
        'Section children may only contain <Item> components',
        node,
      );
    assertAttributes(
      values,
      ['id', 'title', 'layout', 'columns'],
      declaredIn,
      node,
    );
    const layout = values.layout ?? 'list';
    if (layout !== 'list' && layout !== 'grid' && layout !== 'sequence')
      fail(
        declaredIn,
        'Section "layout" must be "list", "grid", or "sequence"',
        node,
      );
    const columns = values.columns;
    if (columns !== undefined && layout !== 'grid')
      fail(
        declaredIn,
        'Section "columns" is only valid with layout="grid"',
        node,
      );
    if (
      columns !== undefined &&
      (!Number.isInteger(columns) ||
        Number(columns) < 1 ||
        Number(columns) > 12)
    ) {
      fail(
        declaredIn,
        'Section "columns" must be an integer from 1 to 12',
        node,
      );
    }
    const sectionId =
      values.id === undefined
        ? `section:${[...pathIndices, index].join('.')}`
        : requiredString(values.id, 'id', declaredIn, node);
    if (!explicitIdPattern.test(sectionId))
      fail(declaredIn, `invalid id "${sectionId}"`, node);
    if (ids.has(sectionId))
      fail(declaredIn, `duplicate package node id "${sectionId}"`, node);
    ids.add(sectionId);
    const children = await parseStructure(
      node.children ?? [],
      declaredIn,
      root,
      [...pathIndices, index],
      ids,
      false,
    );
    const section: SectionNode = {
      type: 'section',
      id: sectionId,
      ...(values.title !== undefined
        ? { title: requiredString(values.title, 'title', declaredIn, node) }
        : {}),
      presentation: {
        layout,
        ...(columns !== undefined ? { columns: Number(columns) } : {}),
      },
      children: children as ItemNode[],
    };
    result.push(section);
    index++;
  }
  return result;
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
    ['title', 'description'],
    entry,
  );
  const title = requiredString(parsed.data.title, 'title', entry, {
    type: 'frontmatter',
  });
  if (
    parsed.data.description !== undefined &&
    typeof parsed.data.description !== 'string'
  ) {
    fail(entry, 'frontmatter "description" must be a string');
  }
  const tree = parseMdx(parsed.content, entry);
  const children = await parseStructure(
    tree.children,
    entry,
    root,
    [],
    new Set(),
  );
  const contentPackage: ContentPackage = {
    metadata: {
      title,
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
    },
    children,
  };
  return contentPackage;
}
