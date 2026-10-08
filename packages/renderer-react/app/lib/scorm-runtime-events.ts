/**
 * Dev-only channel for SCORM package runtime events.
 *
 * During `scorm dev`, the CLI injects a mock LMS API followed by the real SCORM
 * runtime ahead of the app. When `window.__SCORM_DEVTOOLS__` is set, that
 * runtime dispatches a `scorm:runtime-event` CustomEvent for every LMS call it
 * makes: API discovery (`lms.api-found` / `lms.api-missing`), initialize,
 * get-value, set-value, commit, finish, and their error or skip paths.
 *
 * That runtime runs in `<head>`, so its startup calls (API discovery,
 * initialize and the first status read/write/commit) fire before React mounts
 * and a listener registered on mount would miss them. To close that gap the dev
 * runtime also mirrors the first events it emits into
 * `window.__SCORM_DEV_EVENT_BUFFER__`; this module replays the buffer when the
 * inspector subscribes. The renderer only *reads* that array — it never writes
 * to or clears it — and treats every entry as untrusted.
 *
 * This module only *consumes* those events. Nothing in the renderer dispatches
 * them, so the channel leaves the production bundle together with the inspector
 * that imports it: `import.meta.hot` is `undefined` outside Vite dev mode, and
 * every entry point is guarded so the bundler can tree-shake it away.
 *
 * The channel is intentionally independent of Vite's HMR socket: it only needs
 * a shared DOM event name, and never leaves the page.
 */

/** DOM event name carrying a single {@link ScormRuntimeEvent} in its `detail`. */
export const SCORM_RUNTIME_EVENT_NAME = 'scorm:runtime-event';

/** Maximum number of events the inspector keeps before dropping the oldest. */
export const MAX_SCORM_RUNTIME_EVENTS = 100;

/** Primitive values the runtime reports in an event's `details`. */
export type ScormRuntimeEventDetailValue = string | number | boolean;

/** LMS call context attached to a runtime event (method, key, value, result…). */
export type ScormRuntimeEventDetails = Record<
  string,
  ScormRuntimeEventDetailValue
>;

/** A SCORM runtime event, as dispatched by the injected runtime. */
export interface ScormRuntimeEvent {
  /** Protocol event name, e.g. `lms.set-value`. */
  name: string;
  /** Epoch milliseconds at dispatch time. */
  at: number;
  /** LMS call context: method, key, value, result, error or skip reason. */
  details: ScormRuntimeEventDetails;
}

/**
 * Structural view of the runtime-owned dev buffer on `window`.
 *
 * Declared locally (rather than augmenting `Window`) so the renderer depends on
 * nothing more than an optional property it reads defensively, and so the
 * reference is removed from production bundles along with the rest of this
 * module.
 */
interface ScormDevEventBufferWindow {
  __SCORM_DEV_EVENT_BUFFER__?: unknown;
}

/**
 * Returns the runtime's event buffer by reference, or `undefined` when absent.
 *
 * Never mutates the buffer; callers copy it before iterating so a runtime push
 * mid-replay cannot change what is being replayed.
 */
function readScormDevEventBuffer(): unknown[] | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const buffer = (window as ScormDevEventBufferWindow)
    .__SCORM_DEV_EVENT_BUFFER__;
  return Array.isArray(buffer) ? buffer : undefined;
}

/**
 * Narrows an untrusted `CustomEvent.detail` to a {@link ScormRuntimeEvent}.
 *
 * Returns `undefined` for anything that does not match the wire contract, so
 * stray or malformed events are ignored rather than rendered.
 */
export function parseScormRuntimeEvent(
  detail: unknown,
): ScormRuntimeEvent | undefined {
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  const { name, at, details } = detail as {
    name?: unknown;
    at?: unknown;
    details?: unknown;
  };
  if (typeof name !== 'string' || name.length === 0) {
    return undefined;
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    return undefined;
  }
  if (!isScormRuntimeEventDetails(details)) {
    return undefined;
  }
  return { name, at, details };
}

function isScormRuntimeEventDetails(
  value: unknown,
): value is ScormRuntimeEventDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean',
  );
}

/**
 * Stable identity for an event, used to tell whether a buffered startup event
 * has already been captured (e.g. replayed on a React StrictMode re-mount).
 * Details are key-sorted so the same payload compares equal regardless of
 * insertion order.
 */
function scormRuntimeEventKey(event: ScormRuntimeEvent): string {
  const details = Object.keys(event.details)
    .sort()
    .map((key) => `${key}=${String(event.details[key])}`)
    .join('\u0001');
  return `${event.name}\u0000${event.at}\u0000${details}`;
}

/**
 * Events already replayed from a given runtime buffer array.
 *
 * Keyed weakly by the buffer so a fresh page (or a test that installs a new
 * buffer) replays from scratch, while StrictMode's double effect re-run does
 * not replay the same startup events twice.
 */
const replayedScormDevEvents = new WeakMap<object, Set<string>>();

/**
 * Subscribes to SCORM runtime events and returns an unsubscribe function.
 * Inert unless `enabled` (Vite dev client present) and a DOM is available.
 *
 * When active it first listens for future `scorm:runtime-event`s and then
 * replays whatever the runtime buffered before React mounted, in original
 * chronological order. Each buffered entry goes through the same defensive
 * parser as live events, so malformed records are ignored. Chronological replay
 * plus the inspector's newest-first append leaves the latest startup event at
 * the top of the panel.
 */
export function subscribeToScormRuntimeEvents(
  listener: (event: ScormRuntimeEvent) => void,
  enabled: boolean = Boolean(import.meta.hot),
): () => void {
  if (!enabled || typeof window === 'undefined') {
    return () => {};
  }

  // Keys delivered live while catching up; lets the replay skip an event the
  // listener already saw. Bounded to the synchronous catch-up window.
  const liveKeys = new Set<string>();
  let catchingUp = true;
  const handler = (event: Event) => {
    const parsed = parseScormRuntimeEvent(
      (event as CustomEvent<unknown>).detail,
    );
    if (parsed) {
      if (catchingUp) {
        liveKeys.add(scormRuntimeEventKey(parsed));
      }
      listener(parsed);
    }
  };

  // Subscribe before replaying so events emitted during catch-up are not lost.
  window.addEventListener(SCORM_RUNTIME_EVENT_NAME, handler);

  const buffer = readScormDevEventBuffer();
  if (buffer) {
    let replayed = replayedScormDevEvents.get(buffer);
    if (!replayed) {
      replayed = new Set<string>();
      replayedScormDevEvents.set(buffer, replayed);
    }
    for (const entry of buffer.slice()) {
      const parsed = parseScormRuntimeEvent(entry);
      if (!parsed) {
        continue;
      }
      const key = scormRuntimeEventKey(parsed);
      if (liveKeys.has(key) || replayed.has(key)) {
        continue;
      }
      replayed.add(key);
      listener(parsed);
    }
  }

  catchingUp = false;
  liveKeys.clear();

  return () => window.removeEventListener(SCORM_RUNTIME_EVENT_NAME, handler);
}

/**
 * Prepends `event` (newest first) and caps the history, returning a new array.
 * Extracted so the inspector's retention rule can be exercised directly.
 */
export function appendScormRuntimeEvent(
  events: ScormRuntimeEvent[],
  event: ScormRuntimeEvent,
): ScormRuntimeEvent[] {
  return [event, ...events].slice(0, MAX_SCORM_RUNTIME_EVENTS);
}
