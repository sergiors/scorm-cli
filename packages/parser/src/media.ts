import type { ImageNode, VideoNode } from '@scorm-cli/core';
import type { AstNode } from './ast';
import { assetReference } from './io';
import { assertAttributes, attrs, optionalString, requiredString, sourceLocation } from './shared';

/**
 * Media component handlers. Both the inline `<Image>` and the block-level
 * `<Image>`/`<Video>` authoring components resolve their local assets relative
 * to the declaring file and reject unknown or dynamic attributes here.
 */

export async function parseImageComponent(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<ImageNode> {
  const values = attrs(node, sourceFile);
  assertAttributes(values, ['src', 'alt', 'caption'], sourceFile, node);
  const src = requiredString(values.src, 'src', sourceFile, node);

  if (typeof values.alt !== 'string') {
    throw new Error(
      `${sourceLocation(sourceFile, node)}: Image requires an explicit string "alt" attribute`,
    );
  }

  const caption = optionalString(values.caption, 'caption', sourceFile, node);
  return {
    type: 'image',
    src: await assetReference(src, sourceFile, root, sourceFile, node),
    alt: values.alt,
    ...(caption ? { caption } : {}),
  };
}

export async function parseVideo(
  node: AstNode,
  sourceFile: string,
  root: string,
): Promise<VideoNode> {
  const values = attrs(node, sourceFile);
  assertAttributes(values, ['src', 'title', 'poster', 'captions'], sourceFile, node);
  const src = requiredString(values.src, 'src', sourceFile, node);
  const title = optionalString(values.title, 'title', sourceFile, node);
  const poster = optionalString(values.poster, 'poster', sourceFile, node);
  const captions = optionalString(values.captions, 'captions', sourceFile, node);

  return {
    type: 'video',
    src: await assetReference(src, sourceFile, root, sourceFile, node),
    ...(title ? { title } : {}),
    ...(poster ? { poster: await assetReference(poster, sourceFile, root, sourceFile, node) } : {}),
    ...(captions
      ? { captions: await assetReference(captions, sourceFile, root, sourceFile, node) }
      : {}),
  };
}
