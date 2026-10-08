import { useId, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Field, FieldDescription, FieldLabel } from './ui/field';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './ui/popover';

export interface ScormDevToolsToolbarProps {
  /**
   * Overrides dev-client detection. Defaults to whether Vite's HMR client is
   * present, so the toolbar only renders in `scorm dev`. Tests pass `true`
   * explicitly since `import.meta.hot` is undefined under Vitest.
   */
  enabled?: boolean;
}

/**
 * Compact, collapsible dev-only toolbar for the mock LMS injected during
 * `scorm dev`.
 *
 * It is deliberately not an event log. Every SCORM runtime event is written
 * straight to the browser console by the injected mock/runtime, so this toolbar
 * only hosts the mock-persistence control: toggling whether the mock LMS saves
 * `cmi.*` values in localStorage.
 *
 * Mounted only in Vite dev mode (see `main.tsx`), collapsed by default and
 * pinned out of the way in the top-right corner so it never competes with the
 * preview or the scroll navigation controls.
 *
 * Copy is intentionally English-only: the whole module is dropped from the
 * production bundle, so its UI is not part of the localized player chrome and
 * must not depend on the package language.
 */
export function ScormDevToolsToolbar({
  enabled = Boolean(import.meta.hot),
}: ScormDevToolsToolbarProps) {
  // The toolbar has no meaning outside `scorm dev`; keeping it inert also lets
  // the production bundle tree-shake the whole module away.
  if (!enabled) {
    return null;
  }

  return (
    <div className='fixed right-3 top-3 z-40 print:hidden'>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='shadow-md'
          >
            <Settings2 aria-hidden='true' />
            Dev tools
          </Button>
        </PopoverTrigger>
        <PopoverContent align='end' aria-label='Dev tools' className='w-80'>
          <PopoverHeader>
            <PopoverTitle>LMS persistence</PopoverTitle>
          </PopoverHeader>
          <CmiPersistenceControl />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface CmiPersistenceState {
  enabled: boolean;
  status: 'ready' | 'unavailable' | 'error';
  message?: string;
}

/**
 * Dev-only control that lets the preview toggle whether the mock LMS persists
 * `cmi.*` values to localStorage.
 *
 * Reads its initial state from `window.scormDevTools`; both the bridge and its
 * calls are optional, so an absent bridge or a throwing call (e.g. storage
 * blocked) is surfaced as a small status message instead of crashing the
 * toolbar.
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
    <div className='flex flex-col gap-3 px-3 py-3'>
      <Field
        orientation='horizontal'
        data-disabled={disabled ? true : undefined}
        className='items-start gap-2.5'
      >
        <Checkbox
          id={checkboxId}
          checked={state.enabled}
          disabled={disabled}
          aria-describedby={descriptionId}
          onCheckedChange={(checked) => handleChange(checked === true)}
          className='mt-0.5'
        />
        <div className='space-y-1.5'>
          <FieldLabel htmlFor={checkboxId} className='font-medium'>
            Persist CMI data
          </FieldLabel>
          <FieldDescription id={descriptionId} className='text-xs'>
            Saves the <code>cmi.*</code> values in this browser&apos;s
            localStorage and restores them on the next preview. Turning this off
            clears the saved data.
          </FieldDescription>
        </div>
      </Field>

      {state.status === 'ready' ? null : (
        <p role='status' className='text-xs text-destructive'>
          {state.status === 'unavailable'
            ? 'Dev tools are unavailable, so CMI persistence cannot be changed.'
            : `CMI persistence is unavailable: ${state.message ?? ''}`}
        </p>
      )}
    </div>
  );
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
