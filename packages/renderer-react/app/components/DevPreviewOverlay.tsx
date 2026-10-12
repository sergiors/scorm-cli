import { PreviewErrorOverlay } from './PreviewErrorOverlay';
import { usePreviewError } from '../lib/use-preview-error';

/**
 * Dev-only preview surface: subscribes to `scorm dev` content errors and shows
 * the author-facing overlay.
 *
 * It is mounted only behind the `import.meta.hot` guard in `main.tsx`, so both
 * this component and the preview client it pulls in are removed from the
 * production bundle and never reach learners. Keeping the wiring here — rather
 * than inside the player shell — keeps the learner app free of any preview
 * dependency while preserving the exact dev behaviour.
 */
export function DevPreviewOverlay() {
  const message = usePreviewError();
  return message ? <PreviewErrorOverlay message={message} /> : null;
}
