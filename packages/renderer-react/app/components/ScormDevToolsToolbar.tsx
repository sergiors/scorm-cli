import { useEffect, useId, useState } from 'react'
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
 * global it installed), whether the mock persists `cmi.*` values in
 * localStorage, and a read-only snapshot of the current `cmi.*` storage.
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
        <PopoverTrigger
          render={<Button type="button" variant="secondary" size="sm" className="shadow-md" />}
        >
          <Settings2 aria-hidden="true" />
          Dev tools
        </PopoverTrigger>
        <PopoverContent align="end" aria-label="Dev tools" className="w-80 p-6">
          <CmiPersistenceControl />
          <ScormVersionControl />
          <CmiInspector />
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

  function handleChange(value: string | null) {
    if (value === null) return
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
        <Select
          items={{ '1.2': 'SCORM 1.2', '2004': 'SCORM 2004' }}
          value={state.version}
          onValueChange={handleChange}
          disabled={!canSwitch}
        >
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

/**
 * Dev-only, read-only inspector for the mock's current `cmi.*` storage.
 *
 * The whole snapshot is held in a single React state value: it hydrates from
 * `getCmiSnapshot` and is replaced wholesale by every `subscribeToCmi`
 * notification, so what is rendered is exactly the mock's flat `cmi.*` map with
 * no per-field UI, polling or event replay. Both bridge methods are optional, so
 * an older injected mock simply shows an unavailable note instead of crashing.
 */
function CmiInspector() {
  // Resolve the bridge during render so the subscription follows the bridge
  // identity React Fast Refresh sees. A refreshed component can otherwise stay
  // attached to a capture from its previous mount.
  const bridge = getScormDevTools()
  const [cmi, setCmi] = useState<Record<string, string>>(() => readCmiSnapshot(bridge))
  const available = typeof bridge?.getCmiSnapshot === 'function'

  useEffect(() => {
    if (!bridge) {
      return
    }

    if (typeof bridge.subscribeToCmi !== 'function') {
      // A rebind to a read-only bridge must still replace the previous mock's
      // snapshot rather than leave it on screen.
      setCmi(readCmiSnapshot(bridge))
      return
    }
    // Each notification carries a complete snapshot (never a patch), so the
    // state is replaced outright rather than merged. Switching SCORM version
    // reloads the preview, so the new mock starts its own snapshot with nothing
    // carried over from the previous version. Keying the effect on the bridge
    // also releases the previous bridge's listener and immediately hydrates
    // from the active one when Fast Refresh swaps the global.
    return bridge.subscribeToCmi((snapshot) => setCmi(snapshot))
  }, [bridge])

  return (
    <section className="space-y-2.5 overflow-hidden">
      <p className="text-sm font-medium">CMI data</p>
      {available ? (
        <div className="rounded-2xl border border-border bg-secondary overflow-hidden">
          <pre aria-label="CMI data" className="text-sm font-mono not-prose overflow-x-auto p-2.5">
            <code>{JSON.stringify(cmi, null, 2)}</code>
          </pre>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">CMI data is not available in this preview.</p>
      )}
    </section>
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

function readCmiSnapshot(bridge = getScormDevTools()): Record<string, string> {
  if (!bridge || typeof bridge.getCmiSnapshot !== 'function') {
    return {}
  }
  try {
    return bridge.getCmiSnapshot()
  } catch {
    return {}
  }
}

function describeDevToolsError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return 'The dev tools are unavailable.'
}
