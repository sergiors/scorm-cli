/**
 * Custom Vite HMR events exchanged with the `scorm dev` preview server.
 *
 * The names are part of the dev-server contract and are shared with
 * `src/dev.ts`; keep both sides in sync through these constants.
 */
export const PREVIEW_ERROR_EVENT = 'scorm:preview-error';
export const PREVIEW_CLEAR_EVENT = 'scorm:preview-clear';

/**
 * The subset of Vite's HMR context the app relies on. Declared structurally so
 * the app does not need to pull in `vite/client` types, and so it stays a
 * no-op when `import.meta.hot` is absent (production builds and tests).
 */
export interface PreviewHotContext {
  on(event: string, listener: (data: unknown) => void): void;
  off(event: string, listener: (data: unknown) => void): void;
}

export interface PreviewEventHandlers {
  onError(message: string): void;
  onClear(): void;
}

const FALLBACK_MESSAGE = 'The content could not be rendered.';

/** Extracts an author-friendly message from a preview-error payload. */
export function parsePreviewErrorMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return FALLBACK_MESSAGE;
}

/**
 * Subscribes to preview error/clear events and returns an unsubscribe function.
 * Extracted from the hook so it can be exercised without a live HMR socket.
 */
export function subscribeToPreviewEvents(
  hot: PreviewHotContext,
  handlers: PreviewEventHandlers,
): () => void {
  const onError = (data: unknown) => {
    handlers.onError(parsePreviewErrorMessage(data));
  };
  const onClear = () => {
    handlers.onClear();
  };

  hot.on(PREVIEW_ERROR_EVENT, onError);
  hot.on(PREVIEW_CLEAR_EVENT, onClear);

  return () => {
    hot.off(PREVIEW_ERROR_EVENT, onError);
    hot.off(PREVIEW_CLEAR_EVENT, onClear);
  };
}
