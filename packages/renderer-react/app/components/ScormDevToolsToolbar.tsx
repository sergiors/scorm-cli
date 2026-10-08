import { useId, useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import type { Locale } from '../lib/i18n';
import { useI18n } from '../lib/use-i18n';
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

interface DevToolsMessages {
  devTools: string;
  lmsPersistence: string;
  persistCmiData: string;
  persistCmiDescription: (code: ReactNode) => ReactNode;
  devToolsUnavailable: string;
  cmiPersistenceUnavailable: (message: string) => string;
  localStorageUnavailable: string;
}

/**
 * Dev-only copy, kept local so the whole module (and its strings) is dropped
 * from the production bundle along with the toolbar itself.
 */
const DEV_TOOLS_MESSAGES: Record<Locale, DevToolsMessages> = {
  en: {
    devTools: 'Dev tools',
    lmsPersistence: 'LMS persistence',
    persistCmiData: 'Persist CMI data',
    persistCmiDescription: (code) => (
      <>
        Saves the {code} values in this browser&apos;s localStorage and restores
        them on the next preview. Turning this off clears the saved data.
      </>
    ),
    devToolsUnavailable:
      'Dev tools are unavailable, so CMI persistence cannot be changed.',
    cmiPersistenceUnavailable: (message) =>
      `CMI persistence is unavailable: ${message}`,
    localStorageUnavailable: 'Local storage is unavailable.',
  },
  'pt-BR': {
    devTools: 'Ferramentas de desenvolvimento',
    lmsPersistence: 'Persistência do LMS',
    persistCmiData: 'Persistir dados CMI',
    persistCmiDescription: (code) => (
      <>
        Salva os valores {code} no localStorage deste navegador e os restaura na
        próxima pré-visualização. Desativar esta opção limpa os dados salvos.
      </>
    ),
    devToolsUnavailable:
      'As ferramentas de desenvolvimento estão indisponíveis, portanto a persistência de CMI não pode ser alterada.',
    cmiPersistenceUnavailable: (message) =>
      `A persistência de CMI está indisponível: ${message}`,
    localStorageUnavailable: 'O armazenamento local está indisponível.',
  },
};

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
 */
export function ScormDevToolsToolbar({
  enabled = Boolean(import.meta.hot),
}: ScormDevToolsToolbarProps) {
  const { locale } = useI18n();

  // The toolbar has no meaning outside `scorm dev`; keeping it inert also lets
  // the production bundle tree-shake the whole module away.
  if (!enabled) {
    return null;
  }

  const copy = DEV_TOOLS_MESSAGES[locale];

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
            {copy.devTools}
          </Button>
        </PopoverTrigger>
        <PopoverContent align='end' aria-label={copy.devTools} className='w-80'>
          <PopoverHeader>
            <PopoverTitle>{copy.lmsPersistence}</PopoverTitle>
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
  const { locale } = useI18n();
  const copy = DEV_TOOLS_MESSAGES[locale];
  const [state, setState] = useState<CmiPersistenceState>(() =>
    readCmiPersistenceState(copy),
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
        message: describePersistenceError(error, copy.localStorageUnavailable),
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
            {copy.persistCmiData}
          </FieldLabel>
          <FieldDescription id={descriptionId} className='text-xs'>
            {copy.persistCmiDescription(<code>cmi.*</code>)}
          </FieldDescription>
        </div>
      </Field>

      {state.status === 'ready' ? null : (
        <p role='status' className='text-xs text-destructive'>
          {state.status === 'unavailable'
            ? copy.devToolsUnavailable
            : copy.cmiPersistenceUnavailable(state.message ?? '')}
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

function readCmiPersistenceState(copy: DevToolsMessages): CmiPersistenceState {
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
      message: describePersistenceError(error, copy.localStorageUnavailable),
    };
  }
}

function describePersistenceError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
