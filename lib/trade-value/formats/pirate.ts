import { acquisitionSafety } from '@/lib/trade-intel/pirate'
import type { FormatValueModel } from './types'

const object = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const values = (v: unknown): Array<number | null> | null =>
  Array.isArray(v) && v.every((x) => x == null || (typeof x === 'number' && Number.isFinite(x))) ? v as Array<number | null> : null

export const pirateModel: FormatValueModel = {
  formatId: 'pirate_vampire', label: 'Pirate',
  adjust(input) {
    const receiver = object(input.acquiringTeamState)
    const protectedValues = values(receiver?.protectedValues)
    if (!protectedValues) return null
    const safety = acquisitionSafety({ incomingValue: input.base, protectedValues })
    if (!safety) return null
    const displaced = safety.displaces ?? 0
    return {
      multiplier: safety.protectable ? Math.max(0, 1 - displaced / input.base) : 0.5,
      reason: safety.basis,
    }
  },
  canTrade(input) {
    const giver = object(input.teamState)
    const receiver = object(input.acquiringTeamState)
    if (giver?.inLockWindow === true || receiver?.inLockWindow === true) {
      return { ok: false, reason: 'Trading is locked from Thursday kickoff until the Monday games end.' }
    }
    return { ok: true }
  },
}
