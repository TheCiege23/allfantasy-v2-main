import 'server-only'

import type { AppPrismaClient } from '@/lib/sports-data-normalization/appPrismaClient'
import { resolveNormalizedPlayerSportsProfiles } from '@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles'
import type { NormalizedScoringRules } from '@/lib/league-context-engine/types'
import type { SupportedSport } from '@/lib/sport-scope'
import { effectiveFantasyPoints, collectProjectionNotes } from '@/lib/projection-engine'
import { buildNameIndex, findVerified } from '@/lib/player-match/verifiedNameMatch'

export type WaiverProjectionSlice = {
  effectiveProjection: number | null
  weatherSummary: string | null
  weatherRiskLevel: string | null
  injuryNewsSummary: string | null
  projectionNotes: string[]
}

/**
 * Batch normalized sports profiles for waiver candidates (real DB rows only).
 */
export async function enrichWaiverCandidatesWithProjections(args: {
  prisma: AppPrismaClient
  sport: SupportedSport
  leagueScoring: NormalizedScoringRules | null | undefined
  items: Array<{
    playerId: string
    name: string
    recordId: string | null
  }>
}): Promise<Map<string, WaiverProjectionSlice>> {
  const out = new Map<string, WaiverProjectionSlice>()
  const withRec = args.items.filter((x): x is typeof x & { recordId: string } => Boolean(x.recordId))
  if (withRec.length === 0) return out

  const rows = await args.prisma.sportsPlayerRecord.findMany({
    where: { id: { in: withRec.map((x) => x.recordId) } },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const players = withRec
    .map((x) => {
      const row = byId.get(x.recordId)
      if (!row) return null
      return {
        name: row.name,
        rosterPlayerId: x.playerId,
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
    })
    .filter((x): x is NonNullable<typeof x> => x != null)

  if (players.length === 0) return out

  const batch = await resolveNormalizedPlayerSportsProfiles({
    prisma: args.prisma,
    sport: args.sport,
    players,
    leagueScoring: args.leagueScoring ?? null,
    includeClearSportsProjections: players.length <= 36,
  })

  // Slice 15 (wrong-row joins): keyed on lowercased NAME alone while `row`
  // (fetched by id) carries position and team. A name collision attached
  // another athlete's projection/weather/news to this waiver candidate.
  const profileIndex = buildNameIndex(
    batch.players.map((p) => ({
      name: p.player.name,
      position: p.player.position?.code ?? null,
      // NormalizedTeamRef is an object ({externalId, abbrev, name}) — passing it
      // whole stringified to "[OBJECT OBJECT]" for every row, so team narrowing
      // never matched and ambiguous collisions produced no enrichment.
      team: p.player.team?.abbrev ?? null,
      profile: p,
    })),
  )
  for (const x of withRec) {
    const row = byId.get(x.recordId)
    if (!row) continue
    const prof = findVerified(profileIndex, {
      name: row.name,
      position: row.position ?? null,
      team: row.team ?? null,
    })?.profile
    const eff = effectiveFantasyPoints(prof)
    const notes = collectProjectionNotes(prof)
    out.set(x.playerId, {
      effectiveProjection: eff,
      weatherSummary: prof?.projection.weatherSummary ?? null,
      weatherRiskLevel: prof?.projection.weatherRiskLevel ?? null,
      injuryNewsSummary: prof?.injuryNewsLayer?.playerNewsSummary ?? null,
      projectionNotes: notes,
    })
  }

  return out
}
