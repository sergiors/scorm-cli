import { useCallback, useRef, useState } from 'react'
import type { ContentNode } from '../types'

/**
 * The single runtime source of a presentation node's authored content. Each
 * page (Scroll and Slides) and each item (Tiles) is emitted by the bundler as
 * its own module, so the player resolves a canonical node id — a `page:`/
 * `item:` semantic id — to that node's content here rather than reading it
 * inline from the package.
 *
 * `get` returns content that is already in memory: a node the provider has
 * loaded before, or an inline package in a test. Production providers keep no
 * page/item AST in the initial bundle, so `get` is `undefined` until `load`
 * resolves; loading state and module ids never travel through the provider
 * (they stay out of {@link PlayerState}, suspend data and semantic ids).
 */
export interface ContentProvider {
  /** The content already available for `nodeId`, or `undefined` if it must be loaded. */
  get(nodeId: string): ContentNode[] | undefined
  /** Loads `nodeId`'s content once, resolving to the content `get` then returns. */
  load(nodeId: string): Promise<ContentNode[]>
}

/**
 * The content-loading state shared by every presentation, derived from a
 * {@link ContentProvider}. It answers what a node's content is, whether it is
 * loaded, in flight or failed, and requests loads on demand — never eagerly.
 *
 * A load is requested at most once per node: `request` records the node so a
 * re-render cannot re-issue it, and resolved content is kept for the session so
 * a node that scrolls back into view, or a slide the learner revisits, renders
 * without reloading. A failed load is not retried automatically — `retry`
 * clears the failure and re-requests explicitly, so an error surface can offer
 * the learner a deliberate action.
 */
export interface ContentLoader {
  /** A node's content: loaded this session, or already available from the provider. */
  content(nodeId: string): ContentNode[] | undefined
  /** Whether a node's content is ready to render. */
  isLoaded(nodeId: string): boolean
  /** Whether a node's module is currently being requested. */
  isLoading(nodeId: string): boolean
  /** Whether a node's module failed to load and awaits a retry. */
  hasError(nodeId: string): boolean
  /** Requests a node's content once; a no-op when it is already available or in flight. */
  request(nodeId: string): void
  /** Clears a failed load and requests it again. */
  retry(nodeId: string): void
}

/** Adds or removes `id` from a set, preserving identity when nothing changes. */
function withId(set: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
  if (set.has(id) === present) {
    return set
  }
  const next = new Set(set)
  if (present) {
    next.add(id)
  } else {
    next.delete(id)
  }
  return next
}

export function useContentLoader(provider: ContentProvider): ContentLoader {
  const [contentById, setContentById] = useState<Record<string, ContentNode[]>>({})
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [errorIds, setErrorIds] = useState<ReadonlySet<string>>(() => new Set())
  const requestedRef = useRef<Set<string>>(new Set())

  const content = useCallback(
    (nodeId: string) => contentById[nodeId] ?? provider.get(nodeId),
    [contentById, provider]
  )

  const isLoaded = useCallback(
    (nodeId: string) => contentById[nodeId] !== undefined || provider.get(nodeId) !== undefined,
    [contentById, provider]
  )

  const isLoading = useCallback((nodeId: string) => loadingIds.has(nodeId), [loadingIds])
  const hasError = useCallback((nodeId: string) => errorIds.has(nodeId), [errorIds])

  // `request` deliberately reads no state: it is stable until the provider
  // itself changes, so effects can depend on it without re-issuing loads on
  // every render. A node the provider can already answer synchronously, or one
  // already requested, is skipped.
  const request = useCallback(
    (nodeId: string) => {
      if (provider.get(nodeId) !== undefined || requestedRef.current.has(nodeId)) {
        return
      }
      requestedRef.current.add(nodeId)
      setLoadingIds((previous) => withId(previous, nodeId, true))

      let pending: Promise<ContentNode[]>
      try {
        pending = provider.load(nodeId)
      } catch {
        setErrorIds((previous) => withId(previous, nodeId, true))
        setLoadingIds((previous) => withId(previous, nodeId, false))
        return
      }

      pending
        .then((nodes) => {
          setContentById((previous) =>
            previous[nodeId] !== undefined ? previous : { ...previous, [nodeId]: nodes }
          )
          setErrorIds((previous) => withId(previous, nodeId, false))
        })
        .catch(() => {
          setErrorIds((previous) => withId(previous, nodeId, true))
        })
        .finally(() => {
          setLoadingIds((previous) => withId(previous, nodeId, false))
        })
    },
    [provider]
  )

  const retry = useCallback(
    (nodeId: string) => {
      requestedRef.current.delete(nodeId)
      setErrorIds((previous) => withId(previous, nodeId, false))
      request(nodeId)
    },
    [request]
  )

  return { content, isLoaded, isLoading, hasError, request, retry }
}
