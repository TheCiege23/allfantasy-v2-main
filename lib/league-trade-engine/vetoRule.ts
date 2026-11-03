/**
 * How many veto votes kill a league-vote trade — ONE rule both trade runtimes read.
 *
 * 🛑 THE COMMISSIONER'S VETO THRESHOLD WAS READ BY NOTHING. The Trade Settings panel saves
 * `settings.vetoThreshold` (a number); the generic engine counted a percent of the league from
 * `commissionerSettings.vetoThresholdPercent` (default 50%), and the redraft runtime used a fixed 4 votes.
 * So the number a commissioner typed changed nothing.
 *
 * Owner's decision (2026-10-29): a NUMBER OF VOTES by default, and the commissioner may switch it to a
 * PERCENT of the league's teams.
 *
 *   settings.vetoThreshold       the number the panel saves
 *   settings.vetoThresholdMode   'count' (default) | 'percent'
 *
 * A league that never set one keeps a working rule: a saved `commissionerSettings.vetoThresholdPercent`
 * (league creation's concept defaults) reads as that percent; with neither, 4 votes — the redraft
 * runtime's default, so the two runtimes agree.
 */

export type VetoRuleMode = 'count' | 'percent'
export type VetoRule = { mode: VetoRuleMode; value: number }

/** The redraft runtime's long-standing default (`REDRAFT_DEFAULT_VETO_THRESHOLD`). */
export const DEFAULT_VETO_VOTES = 4

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function readVetoRuleMode(raw: unknown): VetoRuleMode {
  return String(raw ?? '').trim().toLowerCase() === 'percent' ? 'percent' : 'count'
}

/**
 * PURE: the league's veto rule from its settings JSON. `legacyPercent` is a percent stored elsewhere
 * (the format's concept-rule extensions), used only when the league saved no threshold.
 */
export function readVetoRule(settings: unknown, legacyPercent?: unknown): VetoRule {
  const s = record(settings)
  const saved = finite(s.vetoThreshold ?? s.veto_threshold)
  if (saved != null && saved >= 1) {
    const mode = readVetoRuleMode(s.vetoThresholdMode ?? s.veto_threshold_mode)
    return mode === 'percent'
      ? { mode, value: Math.min(100, Math.round(saved)) }
      : { mode, value: Math.round(saved) }
  }
  const legacy = finite(record(s.commissionerSettings).vetoThresholdPercent ?? legacyPercent)
  if (legacy != null && legacy >= 1) return { mode: 'percent', value: Math.min(100, Math.round(legacy)) }
  return { mode: 'count', value: DEFAULT_VETO_VOTES }
}

/**
 * PURE: the veto votes that kill a trade. A count is capped at the teams that can vote (every team but
 * the ones in the trade), so a threshold larger than the league can still be reached. A percent is of
 * all the league's teams, rounded up — the generic engine's long-standing arithmetic.
 */
export function vetoVotesNeeded(rule: VetoRule, league: { teamCount: number; tradingTeams: number }): number {
  const voters = Math.max(1, league.teamCount - league.tradingTeams)
  if (rule.mode === 'percent') return Math.max(1, Math.ceil((league.teamCount * rule.value) / 100))
  return Math.max(1, Math.min(rule.value, voters))
}

/** PURE: a rule stored on a trade's metadata, or null (a trade proposed before rules were stored). */
export function storedVetoRule(metadata: unknown): VetoRule | null {
  const r = record(record(metadata).vetoRule)
  const value = finite(r.value)
  if (value == null || value < 1) return null
  return { mode: readVetoRuleMode(r.mode), value }
}
