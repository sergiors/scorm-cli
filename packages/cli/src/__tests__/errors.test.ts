import { describe, expect, it } from 'vitest'
import { errorMessage } from '../errors'

describe('CLI error messages', () => {
  it('uses an Error message', () => {
    expect(errorMessage(new Error('failed'))).toBe('failed')
  })

  it('uses the message from an Error subclass', () => {
    class CustomError extends Error {}

    expect(errorMessage(new CustomError('custom failure'))).toBe('custom failure')
  })

  it('preserves an empty Error message as an empty string', () => {
    expect(errorMessage(new Error(''))).toBe('')
  })

  it('converts non-Error thrown values', () => {
    expect(errorMessage('failed')).toBe('failed')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
    expect(errorMessage(undefined)).toBe('undefined')
    expect(errorMessage({ reason: 'failed' })).toBe('[object Object]')
  })
})
