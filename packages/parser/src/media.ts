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
  assertAttributes(
    values,
    ['src', 'title', 'poster', 'captions', 'duration', 'minWatchTime'],
    sourceFile,
    node
  )
  const src = requiredString(values.src, 'src', sourceFile, node)
  const title = optionalString(values.title, 'title', sourceFile, node)
  const poster = optionalString(values.poster, 'poster', sourceFile, node)
  const captions = optionalString(values.captions, 'captions', sourceFile, node)
  const duration = optionalSeconds(values.duration, 'duration', sourceFile, node)
  const minWatchTime = optionalSeconds(values.minWatchTime, 'minWatchTime', sourceFile, node)
  if (duration !== undefined && minWatchTime !== undefined && minWatchTime > duration) {
    throw new Error(
      `${sourceLocation(sourceFile, node)}: "minWatchTime" must not exceed "duration"`
    )
  }
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
      : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(minWatchTime !== undefined ? { minWatchTime } : {})
  }
}

/** A compound duration with hours, minutes, and seconds in descending order. */
const compoundSecondsPattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/

/** A bare seconds count, optionally fractional. */
const plainSecondsPattern = /^\d+(?:\.\d+)?$/

const secondsError =
  'must be a positive number of seconds or a duration such as "30s", "2m", ' +
  '"1m30s", or "1h20m30s"'

function optionalSeconds(
  value: unknown,
  name: string,
  file: string,
  node: AstNode
): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) {
      return value
    }
    throw new Error(`${sourceLocation(file, node)}: "${name}" ${secondsError}`)
  }
  if (typeof value !== 'string') {
    throw new Error(`${sourceLocation(file, node)}: "${name}" ${secondsError}`)
  }
  if (name === 'minWatchTime' && value === '0m0s') {
    return 0
  }

  const text = value.trim().toLowerCase()
  if (plainSecondsPattern.test(text)) {
    const seconds = Number(text)
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds
    }
    throw new Error(`${sourceLocation(file, node)}: "${name}" ${secondsError}`)
  }

  const match = compoundSecondsPattern.exec(text)
  if (match && (match[1] !== undefined || match[2] !== undefined || match[3] !== undefined)) {
    const seconds =
      Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds
    }
  }
  throw new Error(`${sourceLocation(file, node)}: "${name}" ${secondsError}`)
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
