import type { ContentNode, ContentPackage, PlayerPageState, PlayerState, VideoNode } from '../types'
import { collectVideoNodes, getPresentationNodes } from './content-helpers'

/**
 * How close accumulated watch time may be to the authored requirement while
 * still counting as met. Persisted progress is normalized to tenths of a
 * second, so a total recorded just below the whole-second requirement must not
 * leave the page permanently locked.
 */
const WATCH_COMPLETION_EPSILON_SECONDS = 0.05

/** The authored video properties that define a watch requirement. */
export interface VideoWatchFields {
  duration?: number
  minWatchTime?: number
}

/** Reads a positive finite duration, rejecting zero, negatives and `Infinity`. */
function positiveSeconds(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * The accumulated active watch time a video requires before it stops gating its
 * page. `minWatchTime` is authored in seconds; a video without a positive value
 * has no requirement. When the authored duration is known, the requirement is
 * capped to it so malformed content can never create an unreachable gate.
 */
export function requiredWatchSeconds(video: VideoWatchFields): number | undefined {
  const minimum = positiveSeconds(video.minWatchTime)
  if (minimum === undefined) {
    return undefined
  }
  const duration = positiveSeconds(video.duration)
  return duration === undefined ? minimum : Math.min(minimum, duration)
}

/** Whether the video gates its page's completion. */
export function isVideoRequired(video: VideoNode): boolean {
  return requiredWatchSeconds(video) !== undefined
}

/**
 * The learner's accumulated active watch time for a video, in seconds. A
 * missing or invalid persisted value reads as zero, so a fresh video starts
 * with no progress.
 */
export function watchedVideoSeconds(
  pageState: PlayerPageState | undefined,
  videoId: string
): number {
  const value = pageState?.videoWatchSeconds?.[videoId]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Whether accumulated watch time satisfies the video's authored requirement. */
export function isVideoRequirementMet(
  video: VideoNode,
  pageState: PlayerPageState | undefined
): boolean {
  const required = requiredWatchSeconds(video)
  if (required === undefined) {
    return true
  }
  return watchedVideoSeconds(pageState, video.id) >= required - WATCH_COMPLETION_EPSILON_SECONDS
}

/** Whether every required video reachable in a page/item's content is met. */
export function arePageVideoRequirementsMet(
  nodes: ContentNode[],
  pageState: PlayerPageState | undefined
): boolean {
  return collectVideoNodes(nodes).every((video) => isVideoRequirementMet(video, pageState))
}

/** Whether every required video across the package is met. */
export function arePackageVideoRequirementsMet(
  contentPackage: ContentPackage,
  playerState: PlayerState
): boolean {
  return getPresentationNodes(contentPackage).every((node) =>
    arePageVideoRequirementsMet(node.content, playerState.pages[node.id])
  )
}

export interface VideoRequirementProgress {
  /** The accumulated active watch time, in seconds. */
  watched: number
  /** The authored minimum watch time, in seconds. */
  required: number
  /** Whole-percent progress toward the requirement, from 0 to 100. */
  percent: number
  /** Whether the requirement has been satisfied. */
  complete: boolean
}

/**
 * The display projection of a video's requirement, or `undefined` when the
 * video has none. A satisfied requirement always projects as 100%, even when
 * the persisted total rounds just below the authored value.
 */
export function videoRequirementProgress(
  video: VideoNode,
  pageState: PlayerPageState | undefined
): VideoRequirementProgress | undefined {
  const required = requiredWatchSeconds(video)
  if (required === undefined) {
    return undefined
  }
  const watched = watchedVideoSeconds(pageState, video.id)
  const complete = watched >= required - WATCH_COMPLETION_EPSILON_SECONDS
  const percent = complete
    ? 100
    : Math.min(100, Math.max(0, Math.floor((watched / required) * 100)))
  return { watched, required, percent, complete }
}
