import path from 'node:path';
import type {
  ContentNode,
  ImageNode,
  InlineContentNode,
  InlineNode,
  ListItemNode,
  PathNode,
  QuestionNode,
  QuestionOption,
  QuestionType,
  QuestionnaireNode,
  VideoNode,
} from '@scorm-cli/core';
import {
  AstNode,
  assertAttributes,
  attrs,
  fail,
  isJsx,
  isQuestionType,
  meaningfulChildren,
  normalizedRelative,
  optionalString,
  requiredString,
  whitespace,
} from './shared';
import { componentName, flowComponents } from './mdx';
import { assetReference, sourceNodeId } from './io';

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
        else fail(sourceFile, `unknown MDX component <${node.name ?? ''}>`, node);
      return parseImageComponent(node, sourceFile, root);
    default:
      fail(sourceFile, `unsupported content node "${node.type}"`, node);
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
  if (name === 'Question') fail(file, '<Question> must be inside <Questionnaire>', node);
  if (name === 'Questionnaire') return parseQuestionnaire(node, sourceFile, root, rootPageSources);
  if (name === 'Path') return parsePath(node, sourceFile, root, rootPageSources);
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
      if (child.type === 'text' && inline.length && !/[\r\n]/.test(String(child.value ?? ''))) {
        inline.push(child);
      } else {
        await flushInline();
      }
      continue;
    }
    if (child.type === 'mdxjsEsm') fail(sourceFile, 'MDX JavaScript is not supported', child);
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
    fail(file, 'Path requires at least one direct <Page ref="..." /> child', node);

  const pageIds: string[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (child.type !== 'mdxJsxFlowElement' || componentName(child) !== 'Page') {
      const found = child.name ? `<${child.name}>` : child.type;
      fail(file, `Path may contain only direct <Page ref="..." /> children; found ${found}`, child);
    }
    if (meaningfulChildren(child.children ?? []).length > 0)
      fail(file, '<Page> inside <Path> must be self-closing and cannot contain children', child);
    const pageValues = attrs(child, file);
    assertAttributes(pageValues, ['ref'], file, child);
    const ref = requiredString(pageValues.ref, 'ref', file, child);
    if (!rootPageSources)
      fail(
        file,
        'Path references are only valid for pages declared directly in a root <Scroll> presentation',
        child,
      );
    const source = normalizedRelative(root, path.resolve(root, ref), file, child, 'Path Page ref');
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
  if (!isQuestionType(rawType))
    fail(file, 'Question "type" must be "single-choice", "multiple-choice", or "true-false"', node);
  const children = (node.children ?? [])
    .flatMap((child) => {
      if (
        child.type === 'paragraph' &&
        (child.children ?? []).every(
          (nested) =>
            whitespace(nested) ||
            (isJsx(nested) &&
              (componentName(nested) === 'Prompt' || componentName(nested) === 'Option')),
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
      fail(file, 'Question may contain only <Prompt> and <Option> components', child);
    if (componentName(child) === 'Prompt') prompts.push(child);
    else if (componentName(child) === 'Option') options.push(child);
    else fail(file, `unknown Question child <${child.name ?? ''}>`, child);
  }
  if (prompts.length !== 1)
    fail(file, `Question must contain exactly 1 Prompt; found ${prompts.length}`, node);
  if (options.length < 2)
    fail(file, `Question must contain at least 2 Options; found ${options.length}`, node);
  const promptNode = prompts[0]!;
  const promptAttrs = attrs(promptNode, file);
  assertAttributes(promptAttrs, [], file, promptNode);
  const prompt = await contentChildren(promptNode.children ?? [], file, root, rootPageSources);
  const seenValues = new Set<string>();
  const parsedOptions: QuestionOption[] = [];
  for (const option of options) {
    const optionAttrs = attrs(option, file);
    assertAttributes(optionAttrs, ['value', 'correct'], file, option);
    const value = requiredString(optionAttrs.value, 'value', file, option);
    if (seenValues.has(value)) fail(file, `Option value "${value}" must be unique`, option);
    seenValues.add(value);
    if (optionAttrs.correct !== undefined && typeof optionAttrs.correct !== 'boolean')
      fail(file, 'Option "correct" must be a boolean', option);
    parsedOptions.push({
      value,
      correct: optionAttrs.correct === true,
      content: await contentChildren(option.children ?? [], file, root, rootPageSources),
    });
  }
  const correctCount = parsedOptions.filter((option) => option.correct).length;
  if (rawType === 'single-choice' && correctCount !== 1)
    fail(file, 'single-choice Question must have exactly one correct Option', node);
  if (rawType === 'multiple-choice' && correctCount < 1)
    fail(file, 'multiple-choice Question must have at least one correct Option', node);
  if (rawType === 'true-false' && parsedOptions.length !== 2)
    fail(file, 'true-false Question must have exactly 2 Options', node);
  if (rawType === 'true-false' && correctCount !== 1)
    fail(file, 'true-false Question must have exactly one correct Option', node);
  return {
    type: 'question',
    id: await sourceNodeId('question', node, file, root),
    questionType: rawType,
    prompt,
    options: parsedOptions,
  };
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
          (nested) => whitespace(nested) || (isJsx(nested) && componentName(nested) === 'Question'),
        )
      ) {
        return child.children ?? [];
      }
      return [child];
    })
    .filter((child) => !whitespace(child));
  if (!children.length)
    fail(file, 'Questionnaire must contain at least one direct <Question>', node);

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
