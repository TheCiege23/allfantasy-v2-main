/**
 * Pure resolution of scoring-related knobs from `SettingsSnapshot.scoringSettings` / `conceptRules`.
 * No I/O — deterministic and unit-testable.
 */

type ThresholdBonus = {
  statKey: string
  threshold: number
  bonusPoints: number
}

type MatchupTiebreakerMode = 'none' | 'bench_points'

export type StandingsTiebreakerKey = 'wins' | 'pointsFor' | 'pointsAgainst' | 'rosterId'

const IDP_POSITIONS = new Set(['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S', 'IDP', 'DEF'])

function normKey(k: string): string {
  return String(k)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

export function extractThresholdBonuses(scoringSettings: Record<string, unknown> | null | undefined): ThresholdBonus[] {
  if (!scoringSettings || typeof scoringSettings !== 'object') return []
  const rules = scoringSettings.rules
  if (!rules || typeof rules !== 'object') return []
  const raw = (rules as Record<string, unknown>).thresholdBonuses
  if (!Array.isArray(raw)) return []
  const out: ThresholdBonus[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const statKey = typeof o.statKey === 'string' ? o.statKey : typeof o.stat === 'string' ? o.stat : ''
    const threshold = Number(o.threshold ?? o.min ?? o.at)
    const bonusPoints = Number(o.bonusPoints ?? o.points ?? o.bonus)
    if (!statKey || !Number.isFinite(threshold) || !Number.isFinite(bonusPoints)) continue
    out.push({ statKey: normKey(statKey), threshold, bonusPoints })
  }
  return out
}

/**
 * Adds fixed bonus points when a raw stat meets or exceeds a threshold (e.g. 300 pass yards → +3).
 */
export function applyThresholdBonuses(
  basePoints: number,
  stats: Record<string, unknown>,
  bonuses: ThresholdBonus[],
): number {
  let extra = 0
  for (const b of bonuses) {
    const raw = stats[b.statKey] ?? stats[b.statKey.replace(/_/g, ' ')]
    const num = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(num)) continue
    if (num >= b.threshold) extra += b.bonusPoints
  }
  return Math.round((basePoints + extra) * 100) / 100
}

function getIdpStatAllowlist(scoringSettings: Record<string, unknown> | null | undefined): string[] | null {
  if (!scoringSettings || typeof scoringSettings !== 'object') return null
  const rules = scoringSettings.rules
  if (!rules || typeof rules !== 'object') return null
  const raw = (rules as Record<string, unknown>).idpStatAllowlist
  if (!Array.isArray(raw)) return null
  const keys = raw.map((x) => (typeof x === 'string' ? normKey(x) : '')).filter(Boolean)
  return keys.length ? keys : null
}

/**
 * When IDP allowlist is set, only those stat keys contribute for IDP roster positions.
 */
export function filterStatsForIdpPosition(
  stats: Record<string, unknown>,
  position: string | null | undefined,
  scoringSettings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const pos = String(position ?? '')
    .toUpperCase()
    .trim()
  const allow = getIdpStatAllowlist(scoringSettings)
  if (!allow || !IDP_POSITIONS.has(pos)) return { ...stats }
  const next: Record<string, unknown> = {}
  for (const k of allow) {
    const v = stats[k] ?? stats[k.replace(/_/g, ' ')]
    if (v !== undefined) next[k] = v
  }
  return next
}

export function getMatchupTiebreakerMode(
  scoringSettings: Record<string, unknown> | null | undefined,
): MatchupTiebreakerMode {
  if (!scoringSettings || typeof scoringSettings !== 'object') return 'none'
  const rules = scoringSettings.rules
  if (rules && typeof rules === 'object') {
    const m = (rules as Record<string, unknown>).matchupTiebreaker
    if (m === 'bench_points') return 'bench_points'
  }
  const top = (scoringSettings as Record<string, unknown>).matchupTiebreaker
  if (top === 'bench_points') return 'bench_points'
  return 'none'
}

export function getStandingsTiebreakerOrder(
  scoringSettings: Record<string, unknown> | null | undefined,
): StandingsTiebreakerKey[] {
  const fallback: StandingsTiebreakerKey[] = ['wins', 'pointsFor', 'pointsAgainst', 'rosterId']
  if (!scoringSettings || typeof scoringSettings !== 'object') return fallback
  const rules = scoringSettings.rules
  if (rules && typeof rules === 'object') {
    const order = (rules as Record<string, unknown>).standingsTiebreakerOrder
    if (Array.isArray(order) && order.length > 0) {
      const parsed = order
        .map((x) => (typeof x === 'string' ? (x as StandingsTiebreakerKey) : null))
        .filter((x): x is StandingsTiebreakerKey =>
          x === 'wins' || x === 'pointsFor' || x === 'pointsAgainst' || x === 'rosterId',
        )
      if (parsed.length) return parsed
    }
  }
  return fallback
}

export function getPlayoffSeedingRule(
  playoffSettings: { seedingRule?: string } | null | undefined,
  leaguePlayoffSeeding: string | null | undefined,
): 'default' | 'points_only' | 'division_winners_first' {
  const raw = String(playoffSettings?.seedingRule ?? leaguePlayoffSeeding ?? 'default').toLowerCase()
  if (raw.includes('point') && raw.includes('only')) return 'points_only'
  if (raw.includes('division')) return 'division_winners_first'
  return 'default'
}
