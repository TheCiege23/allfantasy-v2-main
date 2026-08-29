import 'server-only'

import type { AppPrismaClient } from '@/lib/sports-data-normalization/appPrismaClient'
import { resolveNormalizedPlayerSportsProfiles } from '@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles'
import { buildNameIndex } from '@/lib/player-identity/nameIndex'
import type { NormalizedScoringRules } from '@/lib/league-context-engine/types'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { effectiveFantasyPoints, collectProjectionNotes } from '@/lib/projection-engine'
import type { InjuryPlayerIntelRow } from './types'

export type InjuryProjectionSlice = {
  effectiveProjection: number | null
  projectionNotes: string[]
  injuryNewsSummary: string | null
}

/**
 * League-scored weekly projection + news stack for injured players (real DB rows only).
 */
export async function enrichInjuryRowsWithLeagueProjections(args: {
  prisma: AppPrismaClient
  leagueScoring: NormalizedScoringRules | null | undefined
  rows: InjuryPlayerIntelRow[]
}): Promise<Map<string, InjuryProjectionSlice>> {
  const out = new Map<string, InjuryProjectionSlice>()
  if (!args.leagueScoring) return out

  const seen = new Set<string>()
  const pairs: Array<{ sport: string; name: string }> = []
  for (const r of args.rows.slice(0, 32)) {
    const k = `${r.sport}:${r.name.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    pairs.push({ sport: String(r.sport), name: r.name })
  }
  if (pairs.length === 0) return out

  const recs = await args.prisma.sportsPlayerRecord.findMany({
    where: {
      OR: pairs.map((u) => ({
        sport: u.sport,
        name: { equals: u.name, mode: 'insensitive' as const },
      })),
    },
  })
  if (recs.length === 0) return out

  const bySport = new Map<
    SupportedSport,
    Array<{
      name: string
      rosterPlayerId: string
      sportsPlayerRow: {
        name: string
        position: string
        team: string | null
        injuryStatus: string | null
        projections: unknown
        stats: unknown
        externalId: string
      }
    }>
  >()

  for (const row of recs) {
    const sp = normalizeToSupportedSport(String(row.sport))
    const entry = {
      name: row.name,
      rosterPlayerId: row.id,
      sportsPlayerRow: {
        name: row.name,
        position: row.position,
        team: row.team,
        injuryStatus: row.injuryStatus,
        projections: row.projections,
        stats: row.stats,
        externalId: row.id,
      },
    }
    const arr = bySport.get(sp) ?? []
    arr.push(entry)
    bySport.set(sp, arr)
  }

  for (const [sport, group] of bySport) {
    if (group.length === 0) continue
    const batch = await resolveNormalizedPlayerSportsProfiles({
      prisma: args.prisma,
      sport,
      players: group,
      leagueScoring: args.leagueScoring,
      includeClearSportsProjections: group.length <= 20,
    })
    // A shared name in the batch must not hand one player another's projection.
    const profByName = buildNameIndex(batch.players, (x) => x.player.name.toLowerCase())
    for (const p of group) {
      const prof = profByName.get(p.name.toLowerCase())
      const eff = effectiveFantasyPoints(prof)
      const notes = collectProjectionNotes(prof)
      out.set(`${sport}:${p.name.toLowerCase()}`, {
        effectiveProjection: eff,
        projectionNotes: notes,
        injuryNewsSummary: prof?.injuryNewsLayer?.playerNewsSummary ?? null,
      })
    }
  }

  return out
}
