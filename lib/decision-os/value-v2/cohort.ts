import type { ScoringRule, StartingSlot } from './types'

/** Describes the observed market, not the requesting manager or a presumed league. */
export interface MarketCohortV2 {
  sport: string
  format: 'dynasty' | 'redraft'
  numQbs: 1 | 2
  /** Legacy rows did not record these axes. Unknown is a distinct cohort, never 12/PPR by default. */
  numTeams: number | null
  ppr: number | null
}

export function marketCohortKey(cohort: MarketCohortV2): string {
  if (!cohort.sport.trim() || !['dynasty', 'redraft'].includes(cohort.format) || ![1, 2].includes(cohort.numQbs) ||
    (cohort.numTeams !== null && (!Number.isInteger(cohort.numTeams) || cohort.numTeams < 1)) ||
    (cohort.ppr !== null && (!Number.isFinite(cohort.ppr) || cohort.ppr < 0))) throw new Error('Invalid market cohort')
  return `market-v2:${JSON.stringify([cohort.sport.trim().toUpperCase(), cohort.format, cohort.numQbs, cohort.numTeams, cohort.ppr])}`
}

export function completeMarketCohort(cohort: MarketCohortV2): boolean {
  return cohort.numTeams !== null && cohort.ppr !== null
}

/** Stable serialization for exact settings. Object order is irrelevant; array order is preserved. */
function stable(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('League fingerprint requires finite JSON settings')
}

export interface LeagueFingerprintInput {
  sport: string
  format: string
  teamCount: number
  scoring: readonly ScoringRule[] | null
  slots: readonly StartingSlot[] | null
  benchSlots: number | null
  reserveSlots: number | null
  taxiSlots: number | null
  /** Exact keeper, contracts, deadlines, waiver economy and specialty rules supplied by the runtime. */
  formatRules: Readonly<Record<string, unknown>> | null
}

/** Versioned exact fingerprint. League/user ids never split otherwise identical league cohorts. */
export function leagueFingerprint(input: LeagueFingerprintInput): string {
  if (!input.sport.trim() || !input.format.trim() || !Number.isInteger(input.teamCount) || input.teamCount < 1) throw new Error('Invalid league identity')
  for (const count of [input.benchSlots, input.reserveSlots, input.taxiSlots]) {
    if (count !== null && (!Number.isInteger(count) || count < 0)) throw new Error('Invalid roster capacity')
  }
  const scoring = input.scoring === null ? null : input.scoring.map(rule => {
    if (!rule.stat.trim() || !Number.isFinite(rule.points)) throw new Error('Invalid scoring rule')
    return { stat: rule.stat.trim(), points: rule.points,
      positions: rule.positions ? [...new Set(rule.positions.map(p => p.trim().toUpperCase()))].sort() : null }
  }).sort((a, b) => stable(a).localeCompare(stable(b)))
  const counts = new Map<string, number>()
  if (input.slots) for (const slot of input.slots) {
    if (!Number.isInteger(slot.count) || slot.count < 0 || !slot.eligiblePositions.length) throw new Error('Invalid slot')
    const eligible = [...new Set(slot.eligiblePositions.map(p => p.trim().toUpperCase()))].sort()
    if (eligible.some(p => !p)) throw new Error('Invalid position')
    const key = stable(eligible)
    counts.set(key, (counts.get(key) ?? 0) + slot.count)
  }
  const topology = input.slots === null ? null : [...counts].filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b))
  return `league-v2:${stable({ sport: input.sport.trim().toUpperCase(), format: input.format.trim().toLowerCase(),
    teamCount: input.teamCount, scoring, slots: topology, benchSlots: input.benchSlots,
    reserveSlots: input.reserveSlots, taxiSlots: input.taxiSlots, formatRules: input.formatRules })}`
}
