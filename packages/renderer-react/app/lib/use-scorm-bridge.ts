import { useEffect, useRef } from 'react'
import type { PlayerState } from '@scorm-cli/core'

/**
 * Reads the persisted resume state through the optional bridge. Returns
 * `undefined` when there is no bridge, the runtime exposes no reader, or the
 * read throws (e.g. storage blocked). Callers then validate whatever comes back
 * against the current presentation rather than trusting it.
 */
export function restoreState(): PlayerState | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  try {
    return window.scormBridge?.restoreState?.()
  } catch {
    return undefined
  }
}

/**
 * Persists the readable resume state and the integer package progress through
 * the optional bridge. The runtime encodes both; the renderer never touches
 * suspend data. Returns whether the write was accepted: a missing bridge or a
 * missing method is a no-op (`false`), a `void` return is treated as accepted,
 * and only an explicit `false` (or a thrown call) reports a rejected write.
 */
export function saveState(state: PlayerState, progress: number): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const save = window.scormBridge?.saveState
  if (typeof save !== 'function') {
    return false
  }
  try {
    return save(state, progress) !== false
  } catch {
    return false
  }
}

/**
 * Wires the optional `window.scormBridge` completion contract. Every bridge
 * method is best-effort so a missing or failing bridge can never break the
 * player:
 * - `markCompleted()` is attempted once when the package first becomes
 *   complete. The attempt is recorded only after it succeeds, so a bridge that
 *   throws is retried the next time the package becomes complete rather than
 *   being treated as permanently reported.
 * - `finish()` is fire-and-forget on every `pagehide`. A page can be unloaded,
 *   restored from the back/forward cache and unloaded again, so `finish()` is
 *   intentionally not once-only and the runtime owns making it idempotent.
 *
 * Errors from either call are contained here. SCORM API discovery is
 * intentionally out of scope; the LMS — or the `scorm preview` mock — injects its
 * own runtime script which installs the bridge.
 */
export function useScormBridge(complete: boolean): void {
  const markCompletedOnce = useRef(false)

  useEffect(() => {
    if (!complete || markCompletedOnce.current || typeof window === 'undefined') {
      return
    }
    try {
      window.scormBridge?.markCompleted?.()
    } catch {
      // Best-effort: leave the attempt pending so a later completion retries it.
      return
    }
    markCompletedOnce.current = true
  }, [complete])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const finish = () => {
      try {
        window.scormBridge?.finish?.()
      } catch {
        // Best-effort: a throwing bridge must not escape the unload event.
      }
    }
    window.addEventListener('pagehide', finish)
    return () => window.removeEventListener('pagehide', finish)
  }, [])
}
