import { useEffect, useRef } from "react";

/**
 * Wires the optional `window.courseRuntime` bridge:
 * - calls `markCompleted()` once, after every item has been visited;
 * - calls `finish()` when the page is being unloaded.
 *
 * All calls are guarded so the static application keeps working with no
 * runtime present. SCORM API discovery is intentionally out of scope here;
 * the LMS injects its own runtime script.
 */
export function useCourseRuntime(complete: boolean): void {
  const markedRef = useRef(false);

  useEffect(() => {
    if (!complete || markedRef.current) {
      return;
    }
    markedRef.current = true;
    if (typeof window !== "undefined") {
      window.courseRuntime?.markCompleted?.();
    }
  }, [complete]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const finish = () => window.courseRuntime?.finish?.();
    window.addEventListener("pagehide", finish);
    return () => window.removeEventListener("pagehide", finish);
  }, []);
}
