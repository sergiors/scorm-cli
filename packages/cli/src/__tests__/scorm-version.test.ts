import { describe, expect, it } from 'vitest'
import { parseScormVersion } from '../scorm-version'

describe('SCORM CLI option', () => {
  it('defaults to 1.2 and accepts 2004', () => {
    expect(parseScormVersion()).toBe('1.2')
    expect(parseScormVersion('1.2')).toBe('1.2')
    expect(parseScormVersion(1.2)).toBe('1.2')
    expect(parseScormVersion('2004')).toBe('2004')
    expect(parseScormVersion(2004)).toBe('2004')
  })

  it('rejects unsupported versions with a clear error', () => {
    expect(() => parseScormVersion('1.3')).toThrow('--scorm must be either "1.2" or "2004"')
    expect(() => parseScormVersion(2005)).toThrow(
      '--scorm must be either "1.2" or "2004" (received "2005")'
    )
  })
})
