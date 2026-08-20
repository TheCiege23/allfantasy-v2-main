import 'server-only'

import type { AppPrismaClient } from '@/lib/sports-data-normalization/appPrismaClient'
import { resolveNormalizedPlayerSportsProfiles } from '@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles'
import type { NormalizedScoringRules } from '@/lib/league-context-engine/types'
import type { SupportedSport } from '@/lib/sport-scope'
import { effectiveFantasyPoints, collectProjectionNotes } from '@/lib/projection-engine'
import { buildNameIndex, findVerified } from '@/lib/player-match/verifiedNameMatch'
import type { TradeConsolePlayerLine } from './types'

/**
 * Merge league-scored projections, injury/news, weather, and trend hints onto trade lines (real DB rows only).
 */
export async function enrichTradeConsolePlayerLines(args: {
  prisma: AppPrismaClient
  sport: SupportedSport
  leagueScoring: NormalizedScoringRules | null | undefined
  lines: TradeConsolePlayerLine[]
}): Promise<TradeConsolePlayerLine[]> {
  const playable = args.lines.filter(
    (line) =>
      line.pricedSource !== 'pick' &&
      line.pricedSource !== 'faab' &&
      Boolean(line.playerId?.trim()),
  )
  if (playable.length === 0) return args.lines

  const rows = await args.prisma.sportsPlayerRecord.findMany({
    where: { id: { in: playable.map((p) => p.playerId!) } },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))

  const players = playable
    .map((line) => {
      const row = byId.get(line.playerId!)
      if (!row) return null
      return {
        name: row.name,
        rosterPlayerId: line.playerId!,
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

  if (players.length === 0) return args.lines

  const batch = await resolveNormalizedPlayerSportsProfiles({
    prisma: args.prisma,
    sport: args.sport,
    players,
    leagueScoring: args.leagueScoring ?? null,
    includeClearSportsProjections: players.length <= 28,
  })

  // Slice 15 (wrong-row joins): this keyed purely on lowercased NAME while
  // `row` (fetched by id) carries position and team. A name collision bound
  // one athlete's projection, weather and injury summary onto another.
  // Position/team are now required to disambiguate, and an ambiguous
  // collision produces NO enrichment rather than the wrong player's numbers.
  const profileIndex = buildNameIndex(
    batch.players.map((p) => ({
      name: p.player.name,
      position: p.player.position?.code ?? null,
      // `player.team` is a NormalizedTeamRef ({externalId, abbrev, name}), not a
      // string. Passing the object made normalizeToken() stringify it to
      // "[OBJECT OBJECT]" for every row, so team narrowing could never match —
      // collisions that position alone could not split fell through to
      // `ambiguous` and produced no enrichment at all.
      team: p.player.team?.abbrev ?? null,
      profile: p,
    })),
  )
  const enrichByKey = new Map<string, Partial<TradeConsolePlayerLine>>()

  for (const line of playable) {
    const row = byId.get(line.playerId!)
    if (!row) continue
    const prof = findVerified(profileIndex, {
      name: row.name,
      position: row.position ?? line.position ?? null,
      team: row.team ?? line.team ?? null,
    })?.profile
    const eff = effectiveFantasyPoints(prof)
    const notes = collectProjectionNotes(prof)
    const key = `${line.playerId}|${line.name.toLowerCase()}`
    enrichByKey.set(key, {
      effectiveProjection: eff,
      projectionNotes: notes.length ? notes : undefined,
      injuryNewsSummary: prof?.injuryNewsLayer?.playerNewsSummary ?? null,
      weatherSummary: prof?.projection.weatherSummary ?? null,
      weatherRiskLevel: prof?.projection.weatherRiskLevel ?? null,
      trendHint: prof?.trendUsage?.trendHint ?? null,
      rollingFppg: prof?.trendUsage?.rollingFppg ?? null,
    })
  }

  return args.lines.map((line) => {
    const key = `${line.playerId}|${line.name.toLowerCase()}`
    const extra = enrichByKey.get(key)
    return extra ? { ...line, ...extra } : line
  })
}

export function sumEffectiveProjections(lines: TradeConsolePlayerLine[]): number | null {
  const vals = lines
    .map((l) => l.effectiveProjection)
    .filter((v): v is number => v != null && Number.isFinite(v))
  if (vals.length === 0) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10
}
