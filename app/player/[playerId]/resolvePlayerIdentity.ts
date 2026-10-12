import type { PlayerIdentityMap } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { foldInjuryTeam } from '@/lib/injuries/matchInjuryRows'
import { buildNameIndex, resolveVerifiedMatch, type NameMatchReason } from '@/lib/player-match/verifiedNameMatch'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

/**
 * Resolve `/player/[playerId]` to ONE `PlayerIdentityMap` row, for both `generateMetadata` and the page.
 *
 * 🛑 THE OLD LOOKUP WAS `findFirst({ OR: [{ id }, { sleeperId }, { normalizedName: slug }] })` — no sport,
 * no order, no position or team — so a name slug bound to whichever namesake Postgres returned first.
 * Measured on production 2026-10-12: `justin-jefferson` rendered the NCAAF DL from Eastern Michigan and
 * `cam-ward` the NHL goalie. The NFL alone holds two Justin Jeffersons (WR MIN, LB CLE).
 *
 * So, in order:
 *  1. `id`, then `sleeperId` — exact keys, and they win outright; a name hit can no longer outrank them.
 *  2. The name slug, scoped to ONE sport (`?sport=`, default NFL). For NFL, rows carrying a `sleeperId`
 *     are preferred: 72 NFL name/position/team groups are a Sleeper-keyed row plus a keyless duplicate.
 *  3. Rows that agree on name, position and team are one athlete ingested twice (NBA Jon Elmore has 11),
 *     so they collapse; anything still plural must be narrowed by `?position=` / `?team=` through
 *     `resolveVerifiedMatch`, or the lookup is REFUSED (`ambiguous`) rather than guessed.
 */

export interface PlayerPageLookup {
  sport: string
  position: string | null
  team: string | null
}

export type PlayerPageResolution = {
  identity: PlayerIdentityMap | null
  reason: 'id' | 'sleeper_id' | NameMatchReason
}

type SearchParams = Record<string, string | string[] | undefined> | undefined

function firstParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  const trimmed = v?.trim()
  return trimmed ? trimmed : null
}

export function readPlayerPageLookup(searchParams: SearchParams): PlayerPageLookup {
  return {
    sport: normalizeToSupportedSport(firstParam(searchParams?.sport)),
    position: firstParam(searchParams?.position),
    team: firstParam(searchParams?.team),
  }
}

export async function resolvePlayerPageIdentity(
  playerId: string,
  lookup: PlayerPageLookup,
): Promise<PlayerPageResolution> {
  const byId = await prisma.playerIdentityMap.findFirst({ where: { id: playerId } }).catch(() => null)
  if (byId) return { identity: byId, reason: 'id' }
  const bySleeper = await prisma.playerIdentityMap.findFirst({ where: { sleeperId: playerId } }).catch(() => null)
  if (bySleeper) return { identity: bySleeper, reason: 'sleeper_id' }

  const name = playerId.toLowerCase().replace(/-/g, ' ')
  const rows = await prisma.playerIdentityMap
    .findMany({ where: { sport: lookup.sport, normalizedName: name }, orderBy: { id: 'asc' }, take: 50 })
    .catch(() => [] as PlayerIdentityMap[])

  let pool = rows
  if (lookup.sport === 'NFL') {
    const keyed = rows.filter((r) => r.sleeperId)
    if (keyed.length > 0) pool = keyed
  }
  const seen = new Set<string>()
  const distinct = pool.filter((r) => {
    const key = `${(r.position ?? '').trim().toUpperCase()}|${(r.currentTeam ?? '').trim().toUpperCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Every row already matched `name` in SQL, so each is indexed under it rather than re-keyed from its
  // canonicalName — the point here is the position/team verification, not a second name comparison.
  // Teams are folded on both sides: injury alerts carry "Minnesota Vikings" where identity rows say "MIN".
  const index = buildNameIndex(
    distinct.map((row) => ({ name, position: row.position, team: foldInjuryTeam(row.currentTeam, lookup.sport), row })),
  )
  const result = resolveVerifiedMatch(index, {
    name,
    position: lookup.position,
    team: foldInjuryTeam(lookup.team, lookup.sport),
  })
  return { identity: result.match?.row ?? null, reason: result.reason }
}
