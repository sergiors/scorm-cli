import type { PlayerState } from '@scorm-cli/core';
import type { PreviewHotContext } from './lib/preview-events';

export {};

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
    restoreState?: () => PlayerState;
    /**
     * Persists the full resume state together with the integer package progress
     * (0-100), both in renderer terms. The runtime owns encoding them against
     * the content manifest (`cmi.suspend_data` and `cmi.core.lesson_location`),
     * so the renderer never serializes suspend data itself. Returns whether the
     * LMS accepted every write; a missing bridge, a missing method, a thrown
     * call or a `void` return is treated as a best-effort no-op.
     */
    saveState?: (state: PlayerState, progress: number) => boolean | void;
    markCompleted?: () => void;
    finish?: () => void;
  }

  /**
   * Dev-only controls exposed by the mock LMS injected during `scorm dev`
   * (see the SCORM package's dev mock). It is never present in a production
   * SCORM archive, so the renderer must treat both the object and its calls as
   * optional: a missing bridge or a call that throws (e.g. storage blocked by
   * the browser) is handled by the UI rather than assumed.
   */
  interface ScormDevTools {
    /** Whether the mock LMS persists `cmi.*` values to localStorage. */
    getCmiPersistenceEnabled: () => boolean;
    /**
     * Enables or disables persistence. Disabling clears the previously saved
     * CMI state; enabling immediately writes the current state.
     */
    setCmiPersistenceEnabled: (enabled: boolean) => void;
  }

  interface Window {
    scormBridge?: ScormBridge;
    scormDevTools?: ScormDevTools;
  }

  /**
   * Vite's HMR context. Declared structurally (rather than pulling in
   * `vite/client`) so the app only depends on the events it actually uses.
   * `undefined` outside Vite dev mode.
   */
  interface ImportMeta {
    readonly hot?: PreviewHotContext;
  }
}
