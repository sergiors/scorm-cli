import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
  CalloutNode,
  ContentNode,
  ContentPackage,
  ExampleNode,
  ImageNode,
  InlineNode,
  ItemOpenMode,
  ItemNode,
  ListItemNode,
  QuestionNode,
  QuestionOption,
  QuestionType,
  SectionNode,
  StepNode,
  StructureNode,
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
const flowComponents = new Set([
  'Video',
  'Callout',
  'Example',
  'Question',
  'Steps',
]);

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
  tree.children = tree.children.filter((node) => node.type !== 'definition');
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
        if (node.name !== 'Image') {
          if (
            ['Video', 'Callout', 'Example', 'Question', 'Steps'].includes(
              node.name ?? '',
            )
          )
            fail(
              sourceFile,
              `component <${node.name}> is block-only and cannot be used inline`,
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

async function parseContentNode(
  node: AstNode,
  sourceFile: string,
  root: string,
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
    case 'list':
      return {
        type: 'list',
        ordered: Boolean(node.ordered),
        ...(node.ordered && node.start != null && node.start !== 1
          ? { start: node.start }
          : {}),
        items: await Promise.all(
          (node.children ?? []).map(async (item): Promise<ListItemNode> => ({
            children: await contentChildren(
              item.children ?? [],
              sourceFile,
              root,
            ),
          })),
        ),
      };
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
        children: await contentChildren(node.children ?? [], sourceFile, root),
      };
    case 'mdxJsxFlowElement':
      return parseContentComponent(node, sourceFile, root);
    case 'mdxJsxTextElement':
      if (node.name !== 'Image')
        if (flowComponents.has(node.name ?? ''))
          return parseContentComponent(node, sourceFile, root);
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
    return [await parseContentNode(node, sourceFile, root)];
  }
  if (node.type !== 'paragraph')
    return [await parseContentNode(node, sourceFile, root)];
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
        flowComponents.has(child.name ?? ''))
    ) {
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
      output.push(await parseContentNode(child, sourceFile, root));
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
): Promise<ContentNode> {
  const name = node.name ?? '';
  const file = sourceFile;
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
  if (name === 'Callout') return parseCallout(node, sourceFile, root);
  if (name === 'Example') return parseExample(node, sourceFile, root);
  if (name === 'Question') return parseQuestion(node, sourceFile, root);
  if (name === 'Steps') return parseSteps(node, sourceFile, root);
  fail(file, `unknown MDX component <${name}>`, node);
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
      fail(sourceFile, 'MDX JavaScript and imports are not supported', child);
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
      child.type === 'mdxJsxTextElement' && child.name === 'Image';
    if (inlineType || inlineImage) inline.push(child);
    else {
      await flushInline();
      output.push(...(await parseContentNodes(child, sourceFile, root)));
    }
  }
  await flushInline();
  return output;
}

async function parseCallout(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<CalloutNode> {
  const values = attrs(node, sourceFile);
  assertAttributes(values, ['type'], sourceFile, node);
  const variant = values.type;
  if (
    variant !== 'info' &&
    variant !== 'tip' &&
    variant !== 'warning' &&
    variant !== 'important'
  ) {
    fail(
      sourceFile,
      'Callout "type" must be "info", "tip", "warning", or "important"',
      node,
    );
  }
  return {
    type: 'callout',
    variant,
    children: await contentChildren(node.children ?? [], sourceFile, root),
  };
}

async function parseExample(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<ExampleNode> {
  const values = attrs(node, sourceFile);
  assertAttributes(values, ['title'], sourceFile, node);
  const title = optionalString(values.title, 'title', sourceFile, node);
  return {
    type: 'example',
    ...(title ? { title } : {}),
    children: await contentChildren(node.children ?? [], sourceFile, root),
  };
}

function significantChildren(node: AstNode): AstNode[] {
  return (node.children ?? []).filter((child) => !whitespace(child));
}

async function parseQuestion(
  node: AstNode,
  file: string,
  root: string,
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
              (nested.name === 'Prompt' || nested.name === 'Option')),
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
    if (child.name === 'Prompt') prompts.push(child);
    else if (child.name === 'Option') options.push(child);
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
  const prompt = await contentChildren(promptNode.children ?? [], file, root);
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
      content: await contentChildren(option.children ?? [], file, root),
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
    questionType: rawType as QuestionType,
    prompt,
    options: parsedOptions,
  };
}

async function parseSteps(
  node: AstNode,
  file: string,
  root: string,
): Promise<ContentNode> {
  const values = attrs(node, file);
  assertAttributes(values, [], file, node);
  const stepNodes: AstNode[] = [];
  for (const child of significantChildren(node)) {
    if (!isJsx(child) || child.name !== 'Step')
      fail(file, 'Steps may contain only <Step> components', child);
    stepNodes.push(child);
  }
  if (!stepNodes.length)
    fail(file, 'Steps must contain at least one Step', node);
  const steps: StepNode[] = [];
  for (const step of stepNodes) {
    const stepAttrs = attrs(step, file);
    assertAttributes(stepAttrs, ['title'], file, step);
    const title = optionalString(stepAttrs.title, 'title', file, step);
    steps.push({
      ...(title ? { title } : {}),
      children: await contentChildren(step.children ?? [], file, root),
    });
  }
  return { type: 'steps', steps };
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
