import path from 'node:path';
import type {
  ContentNode,
  ImageNode,
  InlineContentNode,
  InlineNode,
  ListItemNode,
  PathNode,
  VideoNode,
} from '@scorm-cli/core';
import {
  AstNode,
  assertAttributes,
  attrs,
  sourceLocation,
  isJsx,
  meaningfulChildren,
  normalizedRelative,
  optionalString,
  requiredString,
  whitespace,
} from './shared';
import { componentName, flowComponents } from './mdx';
import { assetReference } from './io';
import { parseQuestionnaire } from './question';

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
          children: await parseInlineNodes(node.children ?? [], sourceFile, root),
        });
        break;
      case 'strong':
        output.push({
          type: 'strong',
          children: await parseInlineNodes(node.children ?? [], sourceFile, root),
        });
        break;
      case 'inlineCode':
        output.push({ type: 'inlineCode', value: String(node.value ?? '') });
        break;
      case 'link':
        output.push({
          type: 'link',
          href: node.url ?? '',
          children: await parseInlineNodes(node.children ?? [], sourceFile, root),
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
          if (componentName(node) === 'Question') {
            throw new Error(
              `${sourceLocation(sourceFile, node)}: <Question> must be inside <Questionnaire>`,
            );
          }
          if (flowComponents.has(componentName(node))) {
            throw new Error(
              `${sourceLocation(sourceFile, node)}: component <${node.name ?? ''}> is block-only and cannot be used inline`,
            );
          }
          throw new Error(
            `${sourceLocation(sourceFile, node)}: unknown MDX component <${node.name ?? ''}>`,
          );
        }
        output.push(await parseImageComponent(node, sourceFile, root));
        break;
      default:
        throw new Error(
          `${sourceLocation(sourceFile, node)}: unsupported inline node "${node.type}"`,
        );
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
    src: await assetReference(node.url ?? '', sourceFile, root, sourceFile, node),
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
    child.type === 'paragraph' ? { type: 'inlineContent', children: child.children } : child,
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
        ...(node.ordered && node.start != null && node.start !== 1 ? { start: node.start } : {}),
        // Carry the source parser's exact tightness through unchanged; no
        // inference from structure or child count.
        ...(typeof node.spread === 'boolean' ? { spread: node.spread } : {}),
        items: await Promise.all(
          (node.children ?? []).map(async (item): Promise<ListItemNode> => ({
            children: normalizeListItemChildren(
              await contentChildren(item.children ?? [], sourceFile, root, rootPageSources),
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
        children: await contentChildren(node.children ?? [], sourceFile, root, rootPageSources),
      };
    case 'mdxJsxFlowElement':
      return parseContentComponent(node, sourceFile, root, rootPageSources);
    case 'mdxJsxTextElement':
      if (componentName(node) !== 'Image')
        if (flowComponents.has(componentName(node)))
          return parseContentComponent(node, sourceFile, root, rootPageSources);
        else
          throw new Error(
            `${sourceLocation(sourceFile, node)}: unknown MDX component <${node.name ?? ''}>`,
          );
      return parseImageComponent(node, sourceFile, root);
    default:
      throw new Error(
        `${sourceLocation(sourceFile, node)}: unsupported content node "${node.type}"`,
      );
  }
}

export async function parseContentNodes(
  node: AstNode,
  sourceFile: string,
  root: string,
  rootPageSources?: Set<string>,
): Promise<ContentNode[]> {
  if (['text', 'emphasis', 'strong', 'inlineCode', 'link', 'image', 'break'].includes(node.type)) {
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
    if (parsed.some((child) => child.type !== 'text' || child.value.trim() !== '')) {
      output.push({ type: 'paragraph', children: parsed });
    }
    inlineNodes = [];
  };
  for (const child of node.children ?? []) {
    if (
      child.type === 'mdxJsxFlowElement' ||
      (child.type === 'mdxJsxTextElement' && flowComponents.has(componentName(child)))
    ) {
      if (componentName(child) === 'Question') {
        throw new Error(
          `${sourceLocation(sourceFile, child)}: <Question> must be inside <Questionnaire>`,
        );
      }
      const index = (node.children ?? []).indexOf(child);
      const previous = node.children?.[index - 1];
      const next = node.children?.[index + 1];
      if (
        child.type === 'mdxJsxTextElement' &&
        ((previous && !whitespace(previous)) || (next && !whitespace(next)))
      ) {
        throw new Error(
          `${sourceLocation(sourceFile, child)}: component <${child.name ?? ''}> is block-only and cannot be used inline`,
        );
      }
      await flushInline();
      output.push(await parseContentNode(child, sourceFile, root, rootPageSources));
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
  if (name === 'Question') {
    throw new Error(`${sourceLocation(file, node)}: <Question> must be inside <Questionnaire>`);
  }
  if (name === 'Questionnaire') {
    return parseQuestionnaire(node, sourceFile, root, (children) =>
      contentChildren(children, sourceFile, root, rootPageSources),
    );
  }
  if (name === 'Path') {
    return parsePath(node, sourceFile, root, rootPageSources);
  }
  const values = attrs(node, file);
  if (name === 'Image') {
    return parseImageComponent(node, sourceFile, root);
  }
  if (name === 'Video') {
    assertAttributes(values, ['src', 'title', 'poster', 'captions'], file, node);
    const src = requiredString(values.src, 'src', file, node);
    const title = optionalString(values.title, 'title', file, node);
    const poster = optionalString(values.poster, 'poster', file, node);
    const captions = optionalString(values.captions, 'captions', file, node);
    const video: VideoNode = {
      type: 'video',
      src: await assetReference(src, sourceFile, root, file, node),
      ...(title ? { title } : {}),
      ...(poster ? { poster: await assetReference(poster, sourceFile, root, file, node) } : {}),
      ...(captions
        ? {
            captions: await assetReference(captions, sourceFile, root, file, node),
          }
        : {}),
    };
    return video;
  }
  throw new Error(`${sourceLocation(file, node)}: unknown MDX component <${node.name ?? ''}>`);
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
    throw new Error(
      `${sourceLocation(sourceFile, node)}: Image requires an explicit string "alt" attribute`,
    );
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
      if (child.type === 'text' && inline.length && !/[\r\n]/.test(String(child.value ?? ''))) {
        inline.push(child);
      } else {
        await flushInline();
      }
      continue;
    }
    if (child.type === 'mdxjsEsm')
      throw new Error(`${sourceLocation(sourceFile, child)}: MDX JavaScript is not supported`);
    const inlineType = [
      'text',
      'emphasis',
      'strong',
      'inlineCode',
      'link',
      'image',
      'break',
    ].includes(child.type);
    const inlineImage = child.type === 'mdxJsxTextElement' && componentName(child) === 'Image';
    if (inlineType || inlineImage) inline.push(child);
    else {
      await flushInline();
      output.push(...(await parseContentNodes(child, sourceFile, root, rootPageSources)));
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
          (nested) => whitespace(nested) || (isJsx(nested) && componentName(nested) === 'Page'),
        )
      ) {
        return child.children ?? [];
      }
      return [child];
    })
    .filter((child) => !whitespace(child));

  if (children.length === 0)
    throw new Error(
      `${sourceLocation(file, node)}: Path requires at least one direct <Page ref="..." /> child`,
    );

  const pageIds: string[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (child.type !== 'mdxJsxFlowElement' || componentName(child) !== 'Page') {
      const found = child.name ? `<${child.name}>` : child.type;
      throw new Error(
        `${sourceLocation(file, child)}: Path may contain only direct <Page ref="..." /> children; found ${found}`,
      );
    }
    if (meaningfulChildren(child.children ?? []).length > 0)
      throw new Error(
        `${sourceLocation(file, child)}: <Page> inside <Path> must be self-closing and cannot contain children`,
      );
    const pageValues = attrs(child, file);
    assertAttributes(pageValues, ['ref'], file, child);
    const ref = requiredString(pageValues.ref, 'ref', file, child);
    if (!rootPageSources)
      throw new Error(
        `${sourceLocation(file, child)}: Path references are only valid for pages declared directly in a root <Scroll> presentation`,
      );
    const source = normalizedRelative(root, path.resolve(root, ref), file, child, 'Path Page ref');
    if (!rootPageSources.has(source))
      throw new Error(
        `${sourceLocation(file, child)}: Path Page ref "${ref}" does not match a root <Page src="..." /> in the root <Scroll> presentation`,
      );
    if (seen.has(source))
      throw new Error(`${sourceLocation(file, child)}: duplicate Path Page ref "${ref}"`);
    seen.add(source);
    pageIds.push(`page:${source}`);
  }
  return { type: 'path', pageIds };
}
