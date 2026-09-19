import type { FormatValueModel } from './types'

const object = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const probability = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null

function survivalFit(input: Parameters<FormatValueModel['adjust']>[0], label: string) {
  const team = object(input.acquiringTeamState) ?? object(input.teamState)
  if (!team) return null
  const before = probability(team.survivalProbabilityBefore)
  const after = probability(team.survivalProbabilityAfter)
  if (before == null || after == null || before === 0) return null
  return {
    multiplier: after / before,
    reason: `${label} values this deal by this roster's survival odds: ${(before * 100).toFixed(1)}% before and ${(after * 100).toFixed(1)}% after. Tribe, exile and immunity effects must already be included in those league-specific simulations.`,
  }
}

function legality(input: Parameters<NonNullable<FormatValueModel['canTrade']>>[0]) {
  const giver = object(input.teamState)
  const receiver = object(input.acquiringTeamState)
  if (giver?.eliminated === true || receiver?.eliminated === true) return { ok: false, reason: 'An eliminated Survivor roster cannot trade.' }
  if (giver?.exiled === true || receiver?.exiled === true) return { ok: false, reason: 'Exile currently removes this roster from trading under the league rules.' }
  const deadline = input.shape.deadlineWeek
  if (deadline != null && input.currentWeek != null && input.currentWeek > deadline) return { ok: false, reason: `Trades closed after week ${deadline}.` }
  return { ok: true }
}

export const survivorModel: FormatValueModel = {
  formatId: 'survivor', label: 'Survivor / Exile', extraAssetKinds: ['idol', 'immunity', 'swap_token'],
  adjust(input) { return survivalFit(input, 'Survivor') },
  canTrade: legality,
}

export const survivorGuillotineModel: FormatValueModel = {
  formatId: 'survivor_guillotine', label: 'Survivor Guillotine', extraAssetKinds: ['idol', 'immunity', 'faab'],
  adjust(input) { return survivalFit(input, 'Survivor Guillotine') },
  canTrade: legality,
}
