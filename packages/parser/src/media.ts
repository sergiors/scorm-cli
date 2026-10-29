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
  assertAttributes(values, ['src', 'title', 'poster', 'duration', 'minWatchTime'], sourceFile, node)
  const src = requiredString(values.src, 'src', sourceFile, node)
  const title = optionalString(values.title, 'title', sourceFile, node)
  const poster = optionalString(values.poster, 'poster', sourceFile, node)
  const duration = optionalSeconds(values.duration, 'duration', sourceFile, node)
  const minWatchTime = optionalSeconds(values.minWatchTime, 'minWatchTime', sourceFile, node)
  if (duration !== undefined && minWatchTime !== undefined && minWatchTime > duration) {
    throw new Error(
      `${sourceLocation(sourceFile, node)}: "minWatchTime" must not exceed "duration"`
    )
  }
  const provider = videoProvider(src, sourceFile, node)

  return {
    type: 'video',
    id: sourceNodeId('video', node, sourceFile, root, sourceLineOffset),
    provider,
    src,
    ...(title ? { title } : {}),
    ...(poster ? { poster: await assetReference(poster, sourceFile, root, sourceFile, node) } : {}),
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

function videoProvider(src: string, sourceFile: string, node: AstNode): VideoProvider {
  const url = parseVideoUrl(src, sourceFile, node)
  const host = normalizedHost(url)

  if (isYoutubeHost(host)) {
    if (isYoutubeVideoUrl(url, host)) return 'youtube'
    throw videoUrlError(
      sourceFile,
      node,
      `must be an individual YouTube video URL (youtu.be/<11-character ID>, watch?v=<ID>, /embed/, /shorts/, or /live/); playlists and user routes are not supported (received "${src}")`
    )
  }

  if (isVimeoHost(host)) {
    if (isVimeoVideoUrl(url, host)) return 'vimeo'
    throw videoUrlError(
      sourceFile,
      node,
      `must be an individual Vimeo video URL (vimeo.com/<numeric ID> or player.vimeo.com/video/<numeric ID>); playlists, user routes, and direct media URLs are not supported (received "${src}")`
    )
  }

  throw videoUrlError(
    sourceFile,
    node,
    `must use a supported YouTube or Vimeo single-video host; local paths and direct media URLs are not supported (received host "${host || '(empty)'}")`
  )
}

function parseVideoUrl(src: string, sourceFile: string, node: AstNode): URL {
  const isProtocolRelative = src.startsWith('//')
  let url: URL
  try {
    url = new URL(isProtocolRelative ? `https:${src}` : src)
  } catch {
    throw videoUrlError(
      sourceFile,
      node,
      `must be an absolute YouTube or Vimeo URL; local paths and relative URLs are not supported (received "${src}")`
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw videoUrlError(
      sourceFile,
      node,
      `must use the http: or https: protocol (received "${url.protocol}")`
    )
  }
  return url
}

function videoUrlError(sourceFile: string, node: AstNode, message: string): Error {
  return new Error(`${sourceLocation(sourceFile, node)}: Video "src" ${message}`)
}

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '')
}

function isYoutubeHost(host: string): boolean {
  return (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube-nocookie.com') ||
    host === 'youtubeeducation.com' ||
    host.endsWith('.youtubeeducation.com')
  )
}

function isVimeoHost(host: string): boolean {
  return host === 'vimeo.com' || host === 'player.vimeo.com'
}

const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/

function isYoutubeVideoUrl(url: URL, host: string): boolean {
  if (host === 'youtu.be') {
    return /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)
  }

  if (url.pathname === '/watch') {
    return hasYoutubeWatchVideoId(url)
  }

  return /^\/(?:embed|shorts|live)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname)
}

function hasYoutubeWatchVideoId(url: URL): boolean {
  const ids = url.search
    .slice(1)
    .split('&')
    .filter((parameter) => parameter.startsWith('v='))
    .map((parameter) => parameter.slice(2))
  return ids.length === 1 && youtubeVideoIdPattern.test(ids[0])
}

function isVimeoVideoUrl(url: URL, host: string): boolean {
  return host === 'vimeo.com'
    ? /^\/\d+\/?$/.test(url.pathname)
    : /^\/video\/\d+\/?$/.test(url.pathname)
}
