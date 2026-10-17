/**
 * Rolling Insights season rows for ONE player, looked up by name.
 *
 * `player_season_stats` (source `rolling_insights`) is keyed on RI's own player id, and callers
 * here hold only a name. A name is not an identity — measured on production 2026-10-11:
 *
 *     38 NFL names map to 79 distinct RI player ids
 *     "Byron Young"   7859 (LB, LAR) and 7785 (DT, PHI) — their seasons interleaved by year
 *     "Lamar Jackson" 3416 (QB, BAL) and 5888 (the Falcons CB) — 2020 and 2022 appeared twice
 *
 * The old readers took every row matching the name, `orderBy season desc`, and let `rows[0]`
 * supply the team, position and RI id used downstream. So one panel could show the linebacker's
 * 2025 above the defensive tackle's 2024, and a QB's comparison could carry a cornerback's
 * tackle line under the same season label.
 *
 * ⚠ THE SEASON ROW'S OWN position/team ARE NOT AN IDENTITY. RI id 5888's season rows are stamped
 * "QB, BAL" while its tackles say otherwise; `SportsPlayer` (source `rolling_insights`,
 * `externalId` = the RI id) says CB, Atlanta. So a collision is resolved against `SportsPlayer`
 * first, and the season row's labels are only the fallback for an id it does not carry.
 *
 * Rules (the `lib/core-app/playerFinder.ts` shared-name guard, applied to RI ids):
 *   one RI id behind the name  → that player.
 *   several                    → the hint's position/team must single one out
 *                                (`resolveVerifiedMatch`), else REFUSE — an empty history is a
 *                                gap; another man's history is a false statement.
 *
 * And ONE ROW PER SEASON for the chosen id: rows are unique on (id, season, seasonType), so a
 * postseason row would otherwise print a second "2024". Regular season wins.
 */

import { prisma } from '@/lib/prisma'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export interface RiSeasonRow {
  playerId: string
  season: string
  seasonType?: string | null
  gamesPlayed: number | null
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  position: string | null
  team: string | null
  stats: unknown
}

export type RiSeasonResolution = 'unique_id' | 'verified' | 'ambiguous' | 'not_found'

export interface RiSeasonRowsResult {
  rows: RiSeasonRow[]
  rollingInsightsPlayerId: string | null
  position: string | null
  team: string | null
  resolution: RiSeasonResolution
  /** How many RI ids answered to the name before verification. */
  candidateIds: number
}

const EMPTY = (resolution: RiSeasonResolution, candidateIds: number): RiSeasonRowsResult => ({
  rows: [],
  rollingInsightsPlayerId: null,
  position: null,
  team: null,
  resolution,
  candidateIds,
})

function teamKey(team: string | null | undefined): string | null {
  const t = String(team ?? '').trim()
  return t ? normalizeTeamAbbrev(t) : null
}

/** Regular season first, then any other type; one row per season, newest first. */
function onePerSeason(rows: RiSeasonRow[], limit: number): RiSeasonRow[] {
  const bySeason = new Map<string, RiSeasonRow>()
  for (const r of rows) {
    const prev = bySeason.get(r.season)
    if (!prev) {
      bySeason.set(r.season, r)
      continue
    }
    const prevRegular = (prev.seasonType ?? 'regular') === 'regular'
    const curRegular = (r.seasonType ?? 'regular') === 'regular'
    if (!prevRegular && curRegular) bySeason.set(r.season, r)
  }
  return [...bySeason.values()]
    .sort((a, b) => (a.season < b.season ? 1 : a.season > b.season ? -1 : 0))
    .slice(0, limit)
}

export async function loadRiSeasonRowsForName(args: {
  name: string
  sport: string
  /** Verifying context from the caller. Without it a shared name is refused. */
  position?: string | null
  team?: string | null
  limit: number
}): Promise<RiSeasonRowsResult> {
  const name = args.name.trim()
  if (!name) return EMPTY('not_found', 0)

  const raw = (await prisma.playerSeasonStats.findMany({
    where: {
      sport: args.sport,
      playerName: { equals: name, mode: 'insensitive' },
      source: 'rolling_insights',
    },
    orderBy: { season: 'desc' },
    // Several ids and season types share the cap, so read wide and narrow after binding.
    take: Math.max(args.limit * 6, 30),
    select: {
      playerId: true,
      season: true,
      seasonType: true,
      gamesPlayed: true,
      fantasyPoints: true,
      fantasyPointsPerGame: true,
      position: true,
      team: true,
      stats: true,
    },
  })) as RiSeasonRow[]

  if (!raw || raw.length === 0) return EMPTY('not_found', 0)

  const byId = new Map<string, RiSeasonRow[]>()
  for (const r of raw) {
    const id = String(r.playerId ?? '')
    const bucket = byId.get(id)
    if (bucket) bucket.push(r)
    else byId.set(id, [r])
  }

  let chosenId: string
  let resolution: RiSeasonResolution
  let identityPosition: string | null = null
  let identityTeam: string | null = null

  if (byId.size === 1) {
    chosenId = [...byId.keys()][0]!
    resolution = 'unique_id'
  } else {
    const ids = [...byId.keys()].filter(Boolean)
    const identities = (await prisma.sportsPlayer
      .findMany({
        where: { sport: args.sport, source: 'rolling_insights', externalId: { in: ids } },
        select: { externalId: true, position: true, team: true },
      })
      .catch(() => [])) as Array<{ externalId: string; position: string | null; team: string | null }>
    const identityById = new Map(identities.map((i) => [i.externalId, i]))

    const candidates = [...byId.entries()].map(([id, rows]) => {
      const ident = identityById.get(id)
      return {
        id,
        name,
        position: (ident?.position ?? rows[0]?.position ?? null)?.toUpperCase() ?? null,
        team: teamKey(ident?.team ?? rows[0]?.team ?? null),
      }
    })
    const match = resolveVerifiedMatch(buildNameIndex(candidates), {
      name,
      position: args.position ? args.position.toUpperCase() : null,
      team: teamKey(args.team),
    })
    if (!match.match) return EMPTY('ambiguous', byId.size)
    chosenId = match.match.id
    resolution = 'verified'
    identityPosition = match.match.position
    identityTeam = match.match.team
  }

  const rows = onePerSeason(byId.get(chosenId) ?? [], args.limit)
  return {
    rows,
    rollingInsightsPlayerId: chosenId || null,
    position: identityPosition ?? rows[0]?.position ?? null,
    team: identityTeam ?? rows[0]?.team ?? null,
    resolution,
    candidateIds: byId.size,
  }
}
