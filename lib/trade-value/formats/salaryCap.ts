import { capLegality, contractSurplus } from '@/lib/trade-intel/salaryCap'
import type { FormatValueInput, FormatValueModel } from './types'

const object = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null

export const salaryCapModel: FormatValueModel = {
  formatId: 'salary_cap',
  label: 'Salary Cap / Contract Dynasty',
  extraAssetKinds: ['cap_space', 'contract'],

  adjust(input) {
    const asset = object(input.assetState)
    if (!asset || input.base <= 0) return null
    const salary = num(asset.salary)
    const yearsRemaining = num(asset.yearsRemaining)
    const playerValueInCapUnits = num(asset.playerValueInCapUnits)
    if (salary == null || yearsRemaining == null || playerValueInCapUnits == null) return null
    const result = contractSurplus({ playerValueInCapUnits, salary, yearsRemaining })
    if (!result) return null
    return {
      multiplier: Math.max(0, result.surplus / playerValueInCapUnits),
      reason: `${result.basis} This uses this player's actual salary and remaining contract years in this league.`,
    }
  },

  canTrade(input) {
    const acquiring = object(input.acquiringTeamState)
    const asset = object(input.assetState)
    if (!acquiring || !asset) return { ok: false, reason: 'Cap legality is unverified because the receiving team ledger or contract salary is missing.' }
    const result = capLegality({
      capSpace: num(acquiring.capSpace),
      salaryIn: num(asset.salary) ?? 0,
      salaryOut: num(acquiring.salaryOut) ?? 0,
      capFloor: num(acquiring.capFloor),
      totalCapHit: num(acquiring.totalCapHit),
    })
    return result
      ? { ok: result.legal, reason: result.legal ? undefined : result.basis }
      : { ok: false, reason: 'Cap legality is unverified; the deal cannot be approved until the current ledger is available.' }
  },
}
