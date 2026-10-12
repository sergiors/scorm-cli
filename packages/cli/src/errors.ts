/** Convert thrown values to displayable messages without losing non-Error throws. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
