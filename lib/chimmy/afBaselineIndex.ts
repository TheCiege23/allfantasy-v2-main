import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { projectionCoverageFor } from '@/lib/projections/projectionCoverage'

/**
 * AllFantasy's season-long PER-GAME projection for one sport, indexed by player name — the ranking
 * basis Chimmy uses outside the NFL, where no weekly feed exists (lib/projections/projectionCoverage.ts).
 *
 * ── 🛑 WHAT THIS NUMBER IS, AND WHAT EVERY SURFACE USING IT MUST SAY ──────────────────────────
 * `AFProjectionSnapshot.afProjection` is points PER GAME in AllFantasy's standard scoring for the
 * sport, computed from real stat lines. It is NOT re-scored under a league's own rules (no component
 * line exists to re-score outside the NFL) and it knows nothing about this week's or today's games.
 * The standing decision is to refuse a generic number under a "your league" label, so every block
 * built on this names the basis in words: "AllFantasy standard per-game projection".
 *
 * ── MATCHED BY NAME, THROUGH THE ONE NORMALISER ───────────────────────────────────────────────
 * Outside the NFL the roster id space and the projection id space are not joined anywhere we can
 * verify, so rows are matched on `normalizePlayerName` + sport. Two players who normalise alike are
 * AMBIGUOUS and get no number — a price on the wrong man is worse than none.
 */

const SPORT_ALIASES: Record<string, string[]> = {
  NCAAB: ['NCAAB', 'NCAABB'],
  NCAAF: ['NCAAF', 'NCAAFB'],
}

export type BaselineRow = { name: string; position: string | null; perGame: number }

export type BaselineIndex = {
  sport: string
  season: number | null
  /** normalised name → the one row, or null when two different players share it. */
  byName: Map<string, BaselineRow | null>
}

export function baselineAvailable(sport: string): boolean {
  return projectionCoverageFor(sport).seasonLongAvailable
}

export async function loadBaselineIndex(sportRaw: string): Promise<BaselineIndex> {
  const sport = String(sportRaw ?? '').trim().toUpperCase()
  const empty: BaselineIndex = { sport, season: null, byName: new Map() }
  if (!baselineAvailable(sport)) return empty
  const sports = SPORT_ALIASES[sport] ?? [sport]

  const newest = await prisma.aFProjectionSnapshot
    .findFirst({ where: { sport: { in: sports } }, orderBy: { season: 'desc' }, select: { season: true } })
    .catch(() => null)
  if (!newest) return empty

  const rows = await prisma.aFProjectionSnapshot
    .findMany({
      where: { sport: { in: sports }, season: newest.season, week: null },
      select: { playerId: true, playerName: true, position: true, afProjection: true, computedAt: true },
      orderBy: { computedAt: 'desc' },
      take: 20_000,
    })
    .catch(() => [] as Array<{ playerId: string; playerName: string; position: string; afProjection: number; computedAt: Date }>)

  const byName = new Map<string, BaselineRow | null>()
  const ownerOf = new Map<string, string>()
  for (const r of rows) {
    const key = normalizePlayerName(r.playerName)
    if (!key || !Number.isFinite(r.afProjection)) continue
    const owner = ownerOf.get(key)
    if (owner === undefined) {
      ownerOf.set(key, r.playerId)
      byName.set(key, { name: r.playerName, position: r.position ?? null, perGame: Math.round(r.afProjection * 10) / 10 })
    } else if (owner !== r.playerId) {
      /* Two different players, one name: nobody gets a number. Newest-first means the kept row is current. */
      byName.set(key, null)
    }
  }
  return { sport, season: newest.season, byName }
}

export function baselineFor(index: BaselineIndex, name: string | null | undefined): BaselineRow | null {
  if (!name) return null
  return index.byName.get(normalizePlayerName(name)) ?? null
}

export const BASELINE_BASIS =
  "AllFantasy's standard per-game projection for this sport (season-long, from real stat lines) — NOT re-scored under this league's own rules, and blind to this week's or today's schedule"
