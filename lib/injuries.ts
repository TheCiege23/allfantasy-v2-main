import 'server-only'

import type { SupportedSport } from '@/lib/sport-scope'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'

export type InjuryRecord = {
  playerName: string
  team: string
  status: string
  bodyPart: string | null
  notes: string | null
  sport: string
  reportDate: Date
}

/**
 * Cache-only injury lookup, routed through the canonical injury read port.
 *
 * This used to query injury_report_records first — commented as the "primary
 * normalized table" — and fall through to sports_injuries, the "legacy" one,
 * only when the primary returned nothing. Both labels are now backwards.
 *
 * injury_report_records was orphaned when the cron moved to
 * syncRollingInsightsInjuriesToDb, which writes sports_injuries. Its only
 * remaining writer is a lazy fallback that fires when the table is EMPTY, and it
 * has not been empty since April, so it froze at 2026-04-28 while still being
 * consulted first. Measured 108 days stale in production.
 *
 * The port is TTL-respected, keeps one row per player with the freshest source
 * winning, and reports staleness rather than hiding it. Stale rows are dropped:
 * an injury designation is a claim about whether someone plays, and a wrong one
 * is worse than none.
 */
export async function getInjuries(
  sport: SupportedSport | string,
  options?: { team?: string; limit?: number }
): Promise<InjuryRecord[]> {
  const limit = options?.limit ?? 50
  try {
    const list = await listInjuryFacts({
      sport: String(sport),
      team: options?.team ?? null,
      limit,
    })
    return (list.facts ?? [])
      .filter((f) => !f.stale)
      .map((f) => ({
        playerName: f.playerName,
        team: f.team || 'FA',
        // Null means no designation was stated, NOT healthy.
        status: f.status ?? 'no designation stated',
        bodyPart: f.type ?? null,
        notes: f.description ?? null,
        sport: String(sport).toUpperCase(),
        reportDate: f.date ?? f.fetchedAt,
      }))
  } catch {
    return []
  }
}

/** Get injuries for a specific player by name. */
export async function getPlayerInjury(playerName: string, sport: string): Promise<InjuryRecord | null> {
  const all = await getInjuries(sport, { limit: 500 })
  return all.find((r) => r.playerName.toLowerCase() === playerName.toLowerCase()) ?? null
}
