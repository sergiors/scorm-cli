import { useId, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Field, FieldDescription, FieldLabel } from './ui/field'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'

export interface ScormDevToolsToolbarProps {
  /**
   * Overrides dev-client detection. Defaults to whether Vite's HMR client is
   * present, so the toolbar only renders in `scorm preview`. Tests pass `true`
   * explicitly since `import.meta.hot` is undefined under Vitest.
   */
  enabled?: boolean
}

/**
 * Compact, collapsible dev-only toolbar for the mock LMS injected during
 * `scorm preview`.
 *
 * It is deliberately not an event log. Every SCORM runtime event is written
 * straight to the browser console by the injected mock/runtime, so this toolbar
 * only hosts the mock controls: the active SCORM version (with the learner API
 * global it installed) and whether the mock persists `cmi.*` values in
 * localStorage.
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
  enabled = Boolean(import.meta.hot)
}: ScormDevToolsToolbarProps) {
  // The toolbar has no meaning outside `scorm preview`; keeping it inert also lets
  // the production bundle tree-shake the whole module away.
  if (!enabled) {
    return null
  }

  return (
    <div className="fixed right-3 top-3 z-40 print:hidden">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="shadow-md">
            <Settings2 aria-hidden="true" />
            Dev tools
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Dev tools" className="w-80 p-6">
          <CmiPersistenceControl />
          <ScormVersionControl />
        </PopoverContent>
      </Popover>
    </div>
  )
}

type ScormPreviewVersion = '1.2' | '2004'

interface ScormVersionState {
  /** Whether the injected mock exposes the version contract at all. */
  supported: boolean
  version: ScormPreviewVersion
  apiName: string
  message?: string
}

/**
 * Dev-only control that shows the SCORM version the preview simulates and the
 * learner API global the mock installed, and lets the preview switch between
 * SCORM 1.2 and SCORM 2004.
 *
 * The version and its API name are read from `window.scormDevTools` rather than
 * derived here, so no version-to-API mapping lives in React. The whole control
 * is hidden when the bridge does not expose the version contract (for example
 * an older injected mock), keeping the optional bridge genuinely optional.
 */
function ScormVersionControl() {
  const [state, setState] = useState<ScormVersionState>(() => readScormVersionState())
  const selectId = useId()
  const descriptionId = useId()

  // Hooks run unconditionally, then the whole section is omitted when unsupported
  // so the persistence control keeps its place (and its status region) alone.
  if (!state.supported) {
    return null
  }

  const canSwitch = typeof getScormDevTools()?.setScormVersion === 'function'

  function handleChange(value: string) {
    const version: ScormPreviewVersion = value === '2004' ? '2004' : '1.2'
    const bridge = getScormDevTools()
    if (!bridge || typeof bridge.setScormVersion !== 'function') {
      setState((previous) => ({
        ...previous,
        message: 'Version switching is not available in this preview.'
      }))
      return
    }
    try {
      bridge.setScormVersion(version)
      // The mock typically reloads the page, but read the resulting state back
      // so the control stays correct when the reload is a no-op or deferred.
      setState(readScormVersionState())
    } catch (error) {
      setState((previous) => ({ ...previous, message: describeDevToolsError(error) }))
    }
  }

  return (
    <>
      <Field className="items-start gap-2.5">
        <FieldLabel htmlFor={selectId}>SCORM version</FieldLabel>
        <Select value={state.version} onValueChange={handleChange} disabled={!canSwitch}>
          <SelectTrigger id={selectId} aria-describedby={descriptionId} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="1.2">SCORM 1.2</SelectItem>
              <SelectItem value="2004">SCORM 2004</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {state.message ? (
        <p role="status" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </>
  )
}

interface CmiPersistenceState {
  enabled: boolean
  status: 'ready' | 'unavailable' | 'error'
  message?: string
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
  const [state, setState] = useState<CmiPersistenceState>(() => readCmiPersistenceState())
  const checkboxId = useId()
  const descriptionId = useId()

  // A missing bridge cannot be toggled; a throwing bridge can be retried.
  const disabled = state.status === 'unavailable'

  function handleChange(nextEnabled: boolean) {
    const bridge = getScormDevTools()
    if (!bridge) {
      setState({ enabled: false, status: 'unavailable' })
      return
    }
    try {
      bridge.setCmiPersistenceEnabled(nextEnabled)
      // `setCmiPersistenceEnabled` returns void, so read the resulting state
      // back rather than assuming the write took effect.
      setState({
        enabled: bridge.getCmiPersistenceEnabled() === true,
        status: 'ready'
      })
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: 'error',
        message: describeDevToolsError(error)
      }))
    }
  }

  return (
    <>
      <Field
        orientation="horizontal"
        data-disabled={disabled ? true : undefined}
        className="items-start gap-2.5"
      >
        <Checkbox
          id={checkboxId}
          checked={state.enabled}
          disabled={disabled}
          aria-describedby={descriptionId}
          onCheckedChange={(checked) => handleChange(checked === true)}
          className="mt-0.5"
        />
        <div className="space-y-1.5">
          <FieldLabel htmlFor={checkboxId} className="font-medium">
            Persist CMI data
          </FieldLabel>
          <FieldDescription id={descriptionId} className="text-xs">
            Saves the <code>cmi.*</code> values in this browser&apos;s localStorage and restores
            them on the next preview. Turning this off clears the saved data.
          </FieldDescription>
        </div>
      </Field>

      {state.status === 'ready' ? null : (
        <p role="status" className="text-xs text-destructive">
          {state.status === 'unavailable'
            ? 'Dev tools are unavailable, so CMI persistence cannot be changed.'
            : `CMI persistence is unavailable: ${state.message ?? ''}`}
        </p>
      )}
    </>
  )
}

function getScormDevTools(): ScormDevTools | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.scormDevTools
}

function readScormVersionState(): ScormVersionState {
  const bridge = getScormDevTools()
  if (!bridge || typeof bridge.getScormVersion !== 'function') {
    return { supported: false, version: '1.2', apiName: '' }
  }
  try {
    const version = bridge.getScormVersion() === '2004' ? '2004' : '1.2'
    const apiName = typeof bridge.getApiName === 'function' ? bridge.getApiName() : ''
    return { supported: true, version, apiName }
  } catch (error) {
    return {
      supported: true,
      version: '1.2',
      apiName: '',
      message: describeDevToolsError(error)
    }
  }
}

function readCmiPersistenceState(): CmiPersistenceState {
  const bridge = getScormDevTools()
  if (!bridge) {
    return { enabled: false, status: 'unavailable' }
  }
  try {
    return {
      enabled: bridge.getCmiPersistenceEnabled() === true,
      status: 'ready'
    }
  } catch (error) {
    return {
      enabled: false,
      status: 'error',
      message: describeDevToolsError(error)
    }
  }
}

function describeDevToolsError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'The dev tools are unavailable.'
}
