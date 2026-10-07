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
}
