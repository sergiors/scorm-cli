import type { PreviewHotContext } from './lib/preview-events';

export {};

declare global {
  /**
   * Optional SCORM bridge installed by the surrounding LMS wrapper. The
   * renderer never discovers or implements the SCORM API itself and works fine
   * when this is absent.
   */
  interface ScormBridge {
    markCompleted?: () => void;
    finish?: () => void;
  }

  interface Window {
    scormBridge?: ScormBridge;
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
