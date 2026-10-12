import type { AggregateScore, PlayerState } from '@scorm-cli/core'
import type { PreviewHotContext } from './lib/preview-client'

export {}

declare global {
  /**
   * Optional SCORM bridge installed by the surrounding LMS wrapper. The
   * renderer never discovers or implements the SCORM API itself and works fine
   * when this is absent.
   */
  interface ScormBridge {
    /**
     * Reads the learner's resume state (lesson location plus per-page/item
     * progress and answers) so a package can restore exactly where the learner
     * left off. Returns a plain {@link PlayerState} keyed by stable authored ids
     * with answer values, never compact indices; the renderer still validates it
     * against the current presentation before using it. Installed by the SCORM
     * package runtime, so the renderer treats both the method and its result as
     * optional input.
     */
    restoreState?: () => PlayerState
    /**
     * Persists the full resume state together with the integer package progress
     * (0-100), both in renderer terms. The runtime owns encoding them against
     * the content manifest (`cmi.suspend_data` and `cmi.core.lesson_location`),
     * so the renderer never serializes suspend data itself. Returns whether the
     * LMS accepted every write; a missing bridge, a missing method, a thrown
     * call or a `void` return is treated as a best-effort no-op.
     */
    saveState?: (state: PlayerState, progress: number) => boolean | void
    /**
     * Reports the learner's aggregate questionnaire score, which the renderer
     * derives from the authored AST and the current resume state. `earned` and
     * `possible` are plain point counts (one point per eligible question; no
     * percentage, no passing/failing), and `undefined` means the package has no
     * scored questions and must never be encoded as a zero. The runtime owns the
     * version-specific element names, so the renderer never names them. Returns
     * whether the LMS accepted the write; a missing bridge, a missing method, a
     * thrown call or a `void` return is treated as a best-effort no-op.
     */
    setScore?: (score: AggregateScore | undefined) => boolean | void
    markCompleted?: () => void
    finish?: () => void
  }

  /**
   * Dev-only controls exposed by the mock LMS injected during `scorm preview`
   * (see the SCORM package's dev mock). It is never present in a production
   * SCORM archive, so the renderer must treat both the object and its calls as
   * optional: a missing bridge or a call that throws (e.g. storage blocked by
   * the browser) is handled by the UI rather than assumed.
   */
  interface ScormDevTools {
    /** Whether the mock LMS persists `cmi.*` values to localStorage. */
    getCmiPersistenceEnabled: () => boolean
    /**
     * Enables or disables persistence. Disabling clears the previously saved
     * CMI state; enabling immediately writes the current state.
     */
    setCmiPersistenceEnabled: (enabled: boolean) => void
    /**
     * The SCORM version the preview currently simulates (`'1.2'` by default).
     * Optional so the toolbar degrades gracefully against an older injected
     * mock; the SCORM package owns the value and its version-specific behavior.
     */
    getScormVersion?: () => '1.2' | '2004'
    /**
     * Name of the single learner API global the mock installed (`'API'` for
     * SCORM 1.2, `'API_1484_11'` for SCORM 2004). Read from the bridge rather
     * than derived here so no version-to-API mapping is duplicated in React.
     */
    getApiName?: () => string
    /**
     * Switches the simulated version. Selecting the active version is a no-op;
     * otherwise the mock clears the saved CMI state, replaces the API global and
     * reloads the preview so the runtime rebinds against the matching API.
     */
    setScormVersion?: (version: '1.2' | '2004') => void
    /**
     * Reads a fresh, complete flat snapshot of the mock's current CMI storage,
     * keyed by the actual `cmi.*` SCORM element names (never compact indices).
     * The renderer renders it verbatim rather than interpreting the elements, so
     * it treats the method and its result as optional input like the other
     * controls.
     */
    getCmiSnapshot?: () => Record<string, string>
    /**
     * Subscribes to the mock's CMI storage. The listener receives a complete
     * snapshot (never a patch) at subscription time and again after every state
     * change, and the returned function unsubscribes. Optional for the same
     * reason as {@link getCmiSnapshot}: an older injected mock may not expose it.
     */
    subscribeToCmi?: (listener: (snapshot: Record<string, string>) => void) => () => void
  }

  interface Window {
    scormBridge?: ScormBridge
    scormDevTools?: ScormDevTools
  }

  /**
   * Vite's HMR context. Declared structurally (rather than pulling in
   * `vite/client`) so the app only depends on the events it actually uses.
   * `undefined` outside Vite dev mode.
   */
  interface ImportMeta {
    readonly hot?: PreviewHotContext
  }
}
