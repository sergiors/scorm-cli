export {};

declare global {
  /**
   * Optional host-provided completion hook (e.g. a SCORM bridge installed by
   * the surrounding LMS wrapper). The renderer never implements or discovers
   * the SCORM API itself and works fine when this is absent.
   */
  interface CourseRuntimeHook {
    markCompleted?: () => void;
    finish?: () => void;
  }

  interface Window {
    courseRuntime?: CourseRuntimeHook;
  }
}
