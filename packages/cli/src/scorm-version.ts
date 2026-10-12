import type { ScormVersion } from '@scorm-cli/scorm'

/** Parse and validate the user-supplied `--scorm` CLI option. */
export function parseScormVersion(value?: string | number): ScormVersion {
  if (value === undefined || value === '1.2' || value === 1.2) return '1.2'
  if (value === '2004' || value === 2004) return '2004'

  throw new Error(`--scorm must be either "1.2" or "2004" (received "${value}")`)
}
