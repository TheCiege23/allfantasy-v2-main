/**
 * Historical Draft Loader — Draft Shadow Backtest, Phase 8.
 *
 * Loads real, completed DraftSession rows and samples a bounded number of
 * real DraftPick rows from each (round > 1 only — round 1 has no prior picks
 * in the same session to build a meaningful "roster so far"/need context
 * from). Each sample carries just the pick's own identity (session, overall,
 * round, roster, real player); DraftBacktestRunner.ts does the actual
 * point-in-time context reconstruction, since that needs the shared
 * assembleEngineInputFromPicks() core plus real ADP/pool/template reads.
 */

import { prisma } from '@/lib/prisma'
import { IMPORT_PROVIDERS } from '@/lib/league-import/types'
import type { HistoricalDraftLoadResult, HistoricalDraftPickSample, SkippedDraftPickSample } from './types'

const IMPORT_PROVIDER_SET = new Set<string>(IMPORT_PROVIDERS)

function isRecognizedPlatform(platform: string): boolean {
  return platform === 'native' || IMPORT_PROVIDER_SET.has(platform)
}

export interface LoadHistoricalDraftPickSamplesOptions {
  /** Max completed DraftSession rows to consider. Defaults to 20. */
  maxSessions?: number
  /** Max picks sampled per session (spaced roughly evenly across round > 1 picks). Defaults to 10. */
  maxPicksPerSession?: number
}

export async function loadHistoricalDraftPickSamples(
  options: LoadHistoricalDraftPickSamplesOptions = {}
): Promise<HistoricalDraftLoadResult> {
  const maxSessions = options.maxSessions ?? 20
  const maxPicksPerSession = options.maxPicksPerSession ?? 10

  const samples: HistoricalDraftPickSample[] = []
  const skipped: SkippedDraftPickSample[] = []
  let totalCandidates = 0

  const sessions = await prisma.draftSession.findMany({
    where: { status: 'completed' },
    orderBy: { completedAt: 'desc' },
    take: maxSessions,
    select: { id: true, leagueId: true, completedAt: true },
  })

  for (const session of sessions) {
    const league = await prisma.league.findUnique({ where: { id: session.leagueId }, select: { platform: true } })
    if (!league) {
      skipped.push({ sessionId: session.id, overall: null, reason: 'league_not_found' })
      continue
    }
    if (!isRecognizedPlatform(league.platform)) {
      skipped.push({ sessionId: session.id, overall: null, reason: `unrecognized_platform:${league.platform}` })
      continue
    }

    const picks = await prisma.draftPick.findMany({
      where: { sessionId: session.id },
      orderBy: { overall: 'asc' },
      select: { overall: true, round: true, rosterId: true, position: true, playerName: true, playerId: true },
    })

    const candidatePicks = picks.filter((p) => (p.round ?? 1) > 1)
    totalCandidates += candidatePicks.length

    if (candidatePicks.length === 0) {
      skipped.push({ sessionId: session.id, overall: null, reason: 'no_round2_plus_picks' })
      continue
    }

    const step = Math.max(1, Math.floor(candidatePicks.length / maxPicksPerSession))
    let takenForSession = 0
    for (let i = 0; i < candidatePicks.length && takenForSession < maxPicksPerSession; i += step) {
      const pick = candidatePicks[i]
      if (!pick.playerName || !pick.rosterId) {
        skipped.push({ sessionId: session.id, overall: pick.overall, reason: 'missing_pick_fields' })
        continue
      }
      samples.push({
        sessionId: session.id,
        leagueId: session.leagueId,
        platform: league.platform,
        overall: pick.overall,
        round: pick.round ?? 1,
        rosterId: pick.rosterId,
        realPlayerId: pick.playerId ?? null,
        realPlayerName: pick.playerName,
        realPosition: pick.position ?? '',
      })
      takenForSession += 1
    }
  }

  return { samples, skipped, totalCandidates }
}
