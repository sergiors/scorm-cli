import { useEffect, useRef } from 'react';
import type { PlayerState } from '@scorm-cli/core';

/**
 * Reads the persisted resume state through the optional bridge. Returns
 * `undefined` when there is no bridge, the runtime exposes no reader, or the
 * read throws (e.g. storage blocked). Callers then validate whatever comes back
 * against the current presentation rather than trusting it.
 */
export function restoreState(): PlayerState | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return window.scormBridge?.restoreState?.();
  } catch {
    return undefined;
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
    return false;
  }
  const save = window.scormBridge?.saveState;
  if (typeof save !== 'function') {
    return false;
  }
  try {
    return save(state, progress) !== false;
  } catch {
    return false;
  }
}

/**
 * Wires the optional `window.scormBridge` completion contract:
 * - calls `markCompleted()` once, after the package is complete (every scroll
 *   page completed, or every grid item visited);
 * - calls `finish()` when the page is being unloaded.
 *
 * All calls are guarded so the static application keeps working with no bridge
 * present. SCORM API discovery is intentionally out of scope here; the LMS — or
 * the `scorm dev` mock — injects its own runtime script which installs the
 * bridge.
 */
export function useScormBridge(complete: boolean): void {
  const markedRef = useRef(false);

  useEffect(() => {
    if (!complete || markedRef.current) {
      return;
    }
    markedRef.current = true;
    if (typeof window !== 'undefined') {
      window.scormBridge?.markCompleted?.();
    }
  }, [complete]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const finish = () => {
      window.scormBridge?.finish?.();
    };
    window.addEventListener('pagehide', finish);
    return () => window.removeEventListener('pagehide', finish);
  }, []);
}
