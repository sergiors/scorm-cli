import type { ImageNode, VideoNode, VideoProvider } from '@scorm-cli/core'
import type { AstNode } from './ast'
import { assetReference, sourceNodeId } from './io'
import { assertAttributes, attrs, optionalString, requiredString, sourceLocation } from './shared'

export async function parseImageComponent(
  node: AstNode,
  sourceFile: string,
  root: string
): Promise<ImageNode> {
  const values = attrs(node, sourceFile)
  assertAttributes(values, ['src', 'alt', 'caption'], sourceFile, node)
  const src = requiredString(values.src, 'src', sourceFile, node)

  if (typeof values.alt !== 'string') {
    throw new Error(
      `${sourceLocation(sourceFile, node)}: Image requires an explicit string "alt" attribute`
    )
  }

  const caption = optionalString(values.caption, 'caption', sourceFile, node)
  return {
    type: 'image',
    src: await assetReference(src, sourceFile, root, sourceFile, node),
    alt: values.alt,
    ...(caption ? { caption } : {})
  }
}

export async function parseVideo(
  node: AstNode,
  sourceFile: string,
  root: string,
  sourceLineOffset = 0
): Promise<VideoNode> {
  const values = attrs(node, sourceFile)
  assertAttributes(values, ['src', 'title', 'poster', 'captions'], sourceFile, node)
  const src = requiredString(values.src, 'src', sourceFile, node)
  const title = optionalString(values.title, 'title', sourceFile, node)
  const poster = optionalString(values.poster, 'poster', sourceFile, node)
  const captions = optionalString(values.captions, 'captions', sourceFile, node)
  const provider = videoProvider(src)

  return {
    type: 'video',
    id: sourceNodeId('video', node, sourceFile, root, sourceLineOffset),
    provider,
    src: await assetReference(src, sourceFile, root, sourceFile, node),
    ...(title ? { title } : {}),
    ...(poster ? { poster: await assetReference(poster, sourceFile, root, sourceFile, node) } : {}),
    ...(captions
      ? { captions: await assetReference(captions, sourceFile, root, sourceFile, node) }
      : {})
  }
}

function videoProvider(src: string): VideoProvider {
  let url: URL
  try {
    url = new URL(src.startsWith('//') ? `https:${src}` : src)
  } catch {
    return 'native'
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com')
  ) {
    return 'youtube'
  }
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo'
  return 'native'
}
