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
  /**
   * Requests a node's content once. A no-op when the content is already
   * available from the provider or loaded this session, when a load is in
   * flight, or when the node was requested before — including after a failure,
   * which is not re-issued until `retry` clears it.
   */
  request(nodeId: string): void
  /**
   * Loads a node's content and resolves once it is available, so a caller can
   * defer an action (such as moving a list) until the target exists. This is a
   * user-explicit load attempt: the caller invokes it in response to a
   * deliberate action, never automatically on a remount. A node is only
   * remembered as loaded once its load succeeds, so `ensure` will reattempt a
   * node whose earlier `request` or `ensure` failed rather than treating the
   * failure as loaded. That is not an automatic retry: nothing re-runs `ensure`
   * on its own, and the failure still surfaces through `hasError` until a
   * caller retries explicitly. Rejects if the node's module fails to load.
   * Unlike `request`, the load is not fire-and-forget, and it joins any load
   * already in flight rather than issuing a second one.
   */
  ensure(nodeId: string): Promise<void>
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
  // The nodes whose content is already resolved for the session, and the loads
  // still in flight, kept as refs so `request` and `ensure` stay state-free and
  // stable and can share one load per node.
  const loadedRef = useRef<Set<string>>(new Set())
  const pendingRef = useRef<Map<string, Promise<ContentNode[]>>>(new Map())

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

  // Starts a node's load, or joins the one already in flight, and returns the
  // shared promise. Both `request` (fire-and-forget) and `ensure` (awaited) go
  // through it, so a node is loaded at most once and either caller can observe
  // the same result. It deliberately reads no state: it is stable until the
  // provider itself changes, so effects can depend on it without re-issuing
  // loads on every render.
  const beginLoad = useCallback(
    (nodeId: string): Promise<ContentNode[]> => {
      const available = provider.get(nodeId)
      if (available !== undefined) {
        loadedRef.current.add(nodeId)
        return Promise.resolve(available)
      }
      const inFlight = pendingRef.current.get(nodeId)
      if (inFlight !== undefined) {
        return inFlight
      }

      setLoadingIds((previous) => withId(previous, nodeId, true))

      let pending: Promise<ContentNode[]>
      try {
        pending = provider.load(nodeId)
      } catch (error) {
        setErrorIds((previous) => withId(previous, nodeId, true))
        setLoadingIds((previous) => withId(previous, nodeId, false))
        return Promise.reject(error)
      }

      const tracked = pending
        .then(
          (nodes) => {
            setContentById((previous) =>
              previous[nodeId] !== undefined ? previous : { ...previous, [nodeId]: nodes }
            )
            setErrorIds((previous) => withId(previous, nodeId, false))
            loadedRef.current.add(nodeId)
            return nodes
          },
          (error: unknown) => {
            setErrorIds((previous) => withId(previous, nodeId, true))
            throw error
          }
        )
        .finally(() => {
          setLoadingIds((previous) => withId(previous, nodeId, false))
          pendingRef.current.delete(nodeId)
        })

      pendingRef.current.set(nodeId, tracked)
      return tracked
    },
    [provider]
  )

  const request = useCallback(
    (nodeId: string) => {
      if (
        provider.get(nodeId) !== undefined ||
        loadedRef.current.has(nodeId) ||
        pendingRef.current.has(nodeId) ||
        requestedRef.current.has(nodeId)
      ) {
        return
      }
      requestedRef.current.add(nodeId)
      // A failed load surfaces through `hasError`; the fire-and-forget caller
      // has nothing to await, so the rejection is swallowed here.
      beginLoad(nodeId).catch(() => {})
    },
    [provider, beginLoad]
  )

  const ensure = useCallback(
    (nodeId: string): Promise<void> => {
      if (provider.get(nodeId) !== undefined || loadedRef.current.has(nodeId)) {
        return Promise.resolve()
      }
      requestedRef.current.add(nodeId)
      return beginLoad(nodeId).then(() => undefined)
    },
    [provider, beginLoad]
  )

  const retry = useCallback(
    (nodeId: string) => {
      requestedRef.current.delete(nodeId)
      loadedRef.current.delete(nodeId)
      setErrorIds((previous) => withId(previous, nodeId, false))
      request(nodeId)
    },
    [request]
  )

  return { content, isLoaded, isLoading, hasError, request, ensure, retry }
}
