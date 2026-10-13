/**
 * Clamps a requested index into the range of an ordered presentation, so a
 * saved or referenced index never points outside the nodes that exist. An empty
 * presentation always resolves to index 0.
 */
export function clampPageIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0
  }
  return Math.max(0, Math.min(count - 1, index))
}
