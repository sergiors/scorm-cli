import type { PlayerState } from '@scorm-cli/core'
import type { ScoIndex } from './sco-index'
import { decodeSuspendData, encodeSuspendData } from './state-codec'

export function compactEncode(scoIndex: ScoIndex, state: PlayerState, progress: number): string {
  return JSON.stringify(encodeSuspendData(scoIndex, state, progress))
}

export function compactDecode(scoIndex: ScoIndex, raw: unknown): PlayerState {
  return decodeSuspendData(scoIndex, raw)
}
