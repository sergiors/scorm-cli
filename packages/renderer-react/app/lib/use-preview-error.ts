import { useEffect, useState } from 'react';
import { subscribeToPreviewEvents } from './preview-events';

/**
 * Listens for `scorm dev` preview errors over Vite's HMR channel and returns
 * the latest author-facing message.
 *
 * The subscription only exists in Vite dev mode: `import.meta.hot` is undefined
 * in production builds (where it is tree-shaken away) and in tests, so the
 * preview overlay never ships to learners.
 */
export function usePreviewError(): string | undefined {
  const [message, setMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) {
      return;
    }
    return subscribeToPreviewEvents(hot, {
      onError: setMessage,
      onClear: () => setMessage(undefined),
    });
  }, []);

  return message;
}
