import 'server-only'

import { effectiveFantasyPoints } from '@/lib/ai-tools-start-sit/effectiveProjection'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { NormalizePlayerInput } from '@/lib/sports-data-normalization'
import type { SportsPlayerRowInput } from '@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles'
import { resolveNormalizedPlayerSportsProfiles } from '@/lib/sports-data-normalization'
import { findSportsPlayerByLeagueId } from '@/lib/player-identity/findSportsPlayerByLeagueId'

export type BenchCandidate = { id: string; name: string; position: string }

/**
 * Uses the same normalized projection path as Start/Sit (`resolveNormalizedPlayerSportsProfiles` +
 * `effectiveFantasyPoints`), scoped to league scoring when context resolves.
 */
export async function pickBestBenchReplacementForAutoCoach(args: {
  userId: string
  leagueId: string
  sport: string
  playerOut: BenchCandidate
  benchCandidates: BenchCandidate[]
}): Promise<{
  pick: BenchCandidate | null
  playerOutProjection: number | null
  bestBenchProjection: number | null
  expectedPointsDelta: number | null
  decisionNotes: string
  confidence: number
}> {
  const sport = normalizeToSupportedSport(args.sport)
  const sk = String(sport)

  if (args.benchCandidates.length === 0) {
    return {
      pick: null,
      playerOutProjection: null,
      bestBenchProjection: null,
      expectedPointsDelta: null,
      decisionNotes: 'no_bench_candidates',
      confidence: 0,
    }
  }

  const ctx = await resolveNormalizedLeagueContext({ leagueId: args.leagueId, userId: args.userId })
  const leagueScoring = ctx.ok && ctx.context ? ctx.context.scoring : null

  async function toInput(b: BenchCandidate): Promise<NormalizePlayerInput> {
    // `b.id` is a roster id, i.e. a Sleeper id; see findSportsPlayerByLeagueId for why that must
    // not be matched against `externalId`.
    const sp = await findSportsPlayerByLeagueId(sk, b.id)
    const rec =
      sp &&
      (await prisma.sportsPlayerRecord.findFirst({
        where: { sport: sk, name: { equals: sp.name, mode: 'insensitive' } },
      }))
    const row: SportsPlayerRowInput | null = rec
      ? {
          externalId: rec.id,
          name: rec.name,
          position: rec.position,
          team: rec.team,
          injuryStatus: rec.injuryStatus ?? undefined,
          projections: rec.projections,
          stats: rec.stats,
        }
      : sp
        ? {
            externalId: sp.externalId,
            name: sp.name,
            position: sp.position,
            team: sp.team,
            injuryStatus: sp.status ?? undefined,
            projections: null,
            stats: null,
          }
        : null

    return {
      name: sp?.name ?? b.name,
      rosterPlayerId: b.id,
      sportsPlayerRow: row,
    }
  }

  const outIn = await toInput(args.playerOut)
  const benchIns = await Promise.all(args.benchCandidates.map(toInput))
  const players: NormalizePlayerInput[] = [outIn, ...benchIns]

  const batch = await resolveNormalizedPlayerSportsProfiles({
    prisma,
    sport,
    players,
    leagueScoring,
    includeClearSportsProjections: false,
  })

  const outPts = effectiveFantasyPoints(batch.players[0])
  let bestIdx = -1
  let bestPts = -1e9
  for (let i = 1; i < batch.players.length; i++) {
    const pts = effectiveFantasyPoints(batch.players[i])
    const v = pts ?? -1e9
    if (v > bestPts) {
      bestPts = v
      bestIdx = i - 1
    }
  }

  if (bestIdx < 0) {
    return {
      pick: null,
      playerOutProjection: outPts,
      bestBenchProjection: null,
      expectedPointsDelta: null,
      decisionNotes: batch.batchDataGaps.join('; ') || 'no_projection_order',
      confidence: 40,
    }
  }

  const pick = args.benchCandidates[bestIdx] ?? null
  const bestBenchProj = effectiveFantasyPoints(batch.players[bestIdx + 1])
  const delta =
    outPts != null && bestBenchProj != null ? bestBenchProj - outPts : bestBenchProj != null ? bestBenchProj : null

  const confidence = Math.round(
    Math.min(98, Math.max(55, 60 + (delta != null && delta > 0 ? Math.min(20, delta * 4) : 0))),
  )

  return {
    pick,
    playerOutProjection: outPts,
    bestBenchProjection: bestBenchProj,
    expectedPointsDelta: delta,
    decisionNotes: [
      batch.batchDataGaps.join('; '),
      ...(batch.players[bestIdx + 1]?.projection?.basisNotes ?? []).slice(0, 2),
    ]
      .filter(Boolean)
      .join(' · '),
    confidence,
  }
}
