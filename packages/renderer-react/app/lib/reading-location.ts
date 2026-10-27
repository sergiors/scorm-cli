import type { PlayerState } from '../types'

/**
 * The stable reading-anchor ID format. Anchors are short base-36 strings, so a
 * persisted lesson location stays compact and an authored page ID (which may
 * itself contain `#`) is split on the final separator only.
 */
const READING_ANCHOR_PATTERN = /^[0-9a-z]{6,8}$/

/** Whether `value` has the shape of a generated reading anchor. */
export function isReadingAnchorId(value: unknown): value is string {
  return typeof value === 'string' && READING_ANCHOR_PATTERN.test(value)
}

export interface DecodedReadingLocation {
  /** The semantic page/item ID, without an anchor suffix. */
  location?: string
  /** The reading anchor within the page/item, when the value carried one. */
  anchor?: string
}

/** Splits a persisted location into its semantic page ID and optional anchor. */
export function decodeReadingLocation(value: unknown): DecodedReadingLocation {
  if (typeof value !== 'string' || value.length === 0) {
    return {}
  }
  const separator = value.lastIndexOf('#')
  if (separator < 0) {
    return { location: value }
  }
  const location = value.slice(0, separator)
  if (location.length === 0) {
    return {}
  }
  const anchor = value.slice(separator + 1)
  return isReadingAnchorId(anchor) ? { location, anchor } : { location }
}

/** Encodes a page/item ID and reading anchor into the persisted location form. */
export function encodeReadingLocation(location: string, anchor?: string): string {
  return anchor === undefined || anchor.length === 0 ? location : `${location}#${anchor}`
}

/**
 * The state handed to the persistence boundary: the semantic in-memory location
 * plus the latest reading anchor, encoded as one lesson-location string. The
 * in-memory state itself keeps them separate. No pixels or viewport geometry
 * travel through this value.
 */
export function persistablePlayerState(
  state: PlayerState,
  reading: { pageId?: string; anchor?: string } | undefined
): PlayerState {
  if (state.location === undefined) {
    return state
  }

  const anchor =
    reading === undefined
      ? state.anchor
      : reading.pageId === state.location
        ? reading.anchor
        : undefined
  const location = encodeReadingLocation(state.location, anchor)

  if (location === state.location && state.anchor === undefined) {
    return state
  }
  if (location === state.location && anchor === state.anchor) {
    const { anchor: _restored, ...rest } = state
    return rest
  }
  const { anchor: _stored, ...rest } = state
  return { ...rest, location }
}
