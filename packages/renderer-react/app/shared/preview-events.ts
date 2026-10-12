/**
 * Custom Vite HMR event names exchanged between the `scorm dev` preview server
 * (`src/dev.ts`) and the preview client that runs inside the app.
 *
 * These names are the one thing both sides must agree on, so they live in this
 * neutral, dependency-free module: the Node dev server never reaches into the
 * player's UI modules, and the browser preview client never depends on server
 * code. Keep the two sides in sync through these constants only.
 *
 * The strings themselves are only referenced by dead code in a production
 * build, so no dev-preview surface is shipped to learners.
 */
export const PREVIEW_ERROR_EVENT = 'scorm:preview-error';
export const PREVIEW_CLEAR_EVENT = 'scorm:preview-clear';
