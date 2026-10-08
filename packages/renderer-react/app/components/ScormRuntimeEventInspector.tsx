import { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronUp, Radio, Trash2 } from 'lucide-react';
import {
  appendScormRuntimeEvent,
  subscribeToScormRuntimeEvents,
  type ScormRuntimeEvent,
} from '../lib/scorm-runtime-events';
import { Button } from './ui/button';

export interface ScormRuntimeEventInspectorProps {
  /**
   * Overrides dev-client detection. Defaults to whether Vite's HMR client is
   * present, so the inspector only listens in `scorm dev`. Tests pass `true`
   * explicitly since `import.meta.hot` is undefined under Vitest.
   */
  enabled?: boolean;
}

/**
 * Compact, collapsible inspector for SCORM runtime events emitted by the
 * package's injected runtime during `scorm dev`.
 *
 * The preview runs against a mock LMS API, so every row is a call the SCORM
 * runtime made against that mock — API discovery, initialize/get/set/commit/
 * finish, and error or skip paths. It is *not* renderer interaction logging.
 *
 * Mounted only in Vite dev mode (see `main.tsx`), collapsed by default and
 * pinned out of the way in the top-right corner so it never competes with the
 * preview or the scroll navigation controls. It shows a newest-first, capped
 * history and can be cleared; each row carries a timestamp, the protocol event
 * name and the LMS method/details.
 *
 * Because the runtime runs ahead of React, the subscription replays the events
 * it buffered before mount, so startup calls (API discovery, initialize, the
 * first status calls) appear immediately. Clearing only drops this panel's
 * history; the runtime keeps its own buffer.
 *
 * The panel also hosts a dev-only "Persist CMI data" toggle that drives the
 * mock LMS's localStorage persistence through `window.scormDevTools`.
 */
export function ScormRuntimeEventInspector({
  enabled = Boolean(import.meta.hot),
}: ScormRuntimeEventInspectorProps) {
  const [events, setEvents] = useState<ScormRuntimeEvent[]>([]);
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return subscribeToScormRuntimeEvents(
      (event) =>
        setEvents((previous) => appendScormRuntimeEvent(previous, event)),
      enabled,
    );
  }, [enabled]);

  return (
    <div className='fixed right-3 top-3 z-40 flex flex-col items-end gap-2 print:hidden'>
      <Button
        type='button'
        variant='outline'
        size='sm'
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className='shadow-md'
      >
        <Radio aria-hidden='true' />
        SCORM events
        <span className='font-normal text-muted-foreground'>(Mock LMS)</span>
        <span className='rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground'>
          {events.length}
        </span>
        {open ? (
          <ChevronUp aria-hidden='true' />
        ) : (
          <ChevronDown aria-hidden='true' />
        )}
      </Button>

      {open ? (
        <section
          id={panelId}
          aria-label='SCORM runtime event inspector'
          className='flex w-88 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg'
        >
          <header className='flex items-center justify-between gap-2 border-b px-3 py-2'>
            <p className='text-xs font-medium'>
              SCORM events{' '}
              <span className='font-normal text-muted-foreground'>
                (newest first)
              </span>
            </p>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              // Clears only the panel's captured history; the SCORM runtime
              // owns and keeps `window.__SCORM_DEV_EVENT_BUFFER__`.
              onClick={() => setEvents([])}
              aria-label='Clear captured SCORM events'
            >
              <Trash2 aria-hidden='true' />
              Clear
            </Button>
          </header>

          {enabled ? <CmiPersistenceControl /> : null}

          {events.length === 0 ? (
            <p className='px-3 py-4 text-xs text-muted-foreground'>
              No SCORM runtime events yet. The preview uses a mock LMS API.
            </p>
          ) : (
            <ol
              role='log'
              aria-live='polite'
              aria-relevant='additions'
              className='max-h-72 overflow-y-auto text-xs'
            >
              {events.map((event, index) => (
                <ScormRuntimeEventRow
                  key={`${event.at}-${index}`}
                  event={event}
                />
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Dev-only control that lets the preview toggle whether the mock LMS persists
 * `cmi.*` values to localStorage and restores them on the next preview.
 *
 * Reads its initial state from `window.scormDevTools`; both the bridge and its
 * calls are optional, so an absent bridge or a throwing call (e.g. storage
 * blocked) is surfaced as a small status message instead of crashing the panel.
 * It only talks to the dev bridge — SCORM runtime events stay the sole source
 * of the inspector's history.
 */
function CmiPersistenceControl() {
  const [state, setState] = useState<CmiPersistenceState>(() =>
    readCmiPersistenceState(),
  );
  const checkboxId = useId();
  const descriptionId = useId();

  // A missing bridge cannot be toggled; a throwing bridge can be retried.
  const disabled = state.status === 'unavailable';

  function handleChange(nextEnabled: boolean) {
    const bridge = getScormDevTools();
    if (!bridge) {
      setState({ enabled: false, status: 'unavailable' });
      return;
    }
    try {
      bridge.setCmiPersistenceEnabled(nextEnabled);
      // `setCmiPersistenceEnabled` returns void, so read the resulting state
      // back rather than assuming the write took effect.
      setState({
        enabled: bridge.getCmiPersistenceEnabled() === true,
        status: 'ready',
      });
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: 'error',
        message: describePersistenceError(error),
      }));
    }
  }

  return (
    <div className='border-b px-3 py-2'>
      <div className='flex items-start gap-2'>
        <input
          id={checkboxId}
          type='checkbox'
          checked={state.enabled}
          disabled={disabled}
          aria-describedby={descriptionId}
          onChange={(event) => handleChange(event.target.checked)}
          className='mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover disabled:cursor-not-allowed disabled:opacity-50'
        />
        <div className='min-w-0'>
          <label htmlFor={checkboxId} className='text-xs font-medium'>
            Persist CMI data
          </label>
          <p id={descriptionId} className='text-[11px] text-muted-foreground'>
            Saves the mock LMS <code>cmi.*</code> values in this browser&apos;s
            localStorage and restores them on the next preview. Turning this off
            clears the saved data.
          </p>
        </div>
      </div>
      {state.status === 'ready' ? null : (
        <p role='status' className='mt-1 text-[11px] text-destructive'>
          {state.status === 'unavailable'
            ? 'Mock LMS dev tools are unavailable, so CMI persistence cannot be changed.'
            : `CMI persistence is unavailable: ${state.message}`}
        </p>
      )}
    </div>
  );
}

interface CmiPersistenceState {
  enabled: boolean;
  status: 'ready' | 'unavailable' | 'error';
  message?: string;
}

function getScormDevTools(): ScormDevTools | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.scormDevTools;
}

function readCmiPersistenceState(): CmiPersistenceState {
  const bridge = getScormDevTools();
  if (!bridge) {
    return { enabled: false, status: 'unavailable' };
  }
  try {
    return {
      enabled: bridge.getCmiPersistenceEnabled() === true,
      status: 'ready',
    };
  } catch (error) {
    return {
      enabled: false,
      status: 'error',
      message: describePersistenceError(error),
    };
  }
}

function describePersistenceError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Local storage is unavailable.';
}

function ScormRuntimeEventRow({ event }: { event: ScormRuntimeEvent }) {
  const entries = detailEntries(event);

  return (
    <li className='border-b border-border/60 px-3 py-2 last:border-b-0'>
      <div className='flex items-baseline justify-between gap-2'>
        <code className='font-medium text-foreground'>{event.name}</code>
        <time className='shrink-0 tabular-nums text-muted-foreground'>
          {formatTime(event.at)}
        </time>
      </div>
      {entries.length > 0 ? (
        <p className='mt-0.5 break-words text-muted-foreground'>
          {entries.map(([key, value]) => `${key}=${value}`).join(' · ')}
        </p>
      ) : null}
    </li>
  );
}

function detailEntries(event: ScormRuntimeEvent): Array<[string, string]> {
  return Object.entries(event.details).map(([key, value]) => [
    key,
    String(value),
  ]);
}

function formatTime(at: number): string {
  const date = new Date(at);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
}
