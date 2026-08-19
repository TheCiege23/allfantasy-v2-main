/**
 * Draft Shadow Backtest Runner — Phase 8.
 *
 * Unlike Trade OS's and Waiver OS's backtest runners (which call the live
 * shadow entry point unchanged), this runner reconstructs a genuine
 * POINT-IN-TIME DraftDecisionContext for each historical sample — picks are
 * strictly ordered by `overall`, so "every DraftPick with overall < N" is a
 * faithful historical snapshot of that pick, not an approximation. It then
 * calls evaluateDraftShadowFromContext() (DraftShadowService.ts) directly,
 * reusing 100% of the real KG/divergence/evidence assembly logic.
 *
 * ADP values are still today's snapshot, not point-in-time — readAllFantasyAdp
 * has no historical versioning (confirmed during the Phase 8 audit) — see
 * backtest/README.md for the honest accounting of what is and isn't a
 * faithful replay.
 */

import { prisma } from '@/lib/prisma'
import { readAllFantasyAdpForLeague } from '@/lib/adp/readSnapshotForLeague'
import { getRosterTemplate } from '@/lib/multi-sport/RosterTemplateService'
import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import { assembleEngineInputFromPicks, playerKey, resolveLeagueScoringFlags, extractKeeperLockedPlayers, resolveAuctionContext, type DraftDecisionContext } from '@/lib/shared-services/draft/DraftContextAssembler'
import { isIdpLeague } from '@/lib/idp'
import { evaluateDraftShadowFromContext } from '@/lib/shared-services/draft/DraftShadowService'
import { defaultDraftShadowResultStore, type DraftShadowResultStore } from '@/lib/shared-services/draft/DraftShadowResultStore'
import type { LeagueSport } from '@prisma/client'
import type { DraftBacktestRunSummary, HistoricalDraftPickSample } from './types'

export interface DraftBacktestRunOptions {
  /** Injectable for tests; defaults to the process-wide shadow log (same default as evaluateDraftShadow). */
  resultStore?: DraftShadowResultStore
  onSampleError?: (sample: HistoricalDraftPickSample, error: unknown) => void
}

async function buildHistoricalContext(sample: HistoricalDraftPickSample): Promise<DraftDecisionContext> {
  const [league, session, targetRoster] = await Promise.all([
    prisma.league.findUnique({
      where: { id: sample.leagueId },
      select: { sport: true, platform: true, isDynasty: true, settings: true, starters: true },
    }),
    prisma.draftSession.findUnique({
      where: { id: sample.sessionId },
      select: {
        teamCount: true,
        status: true,
        draftType: true,
        devyConfig: true,
        keeperSelections: true,
        auctionBudgetPerTeam: true,
        auctionBudgets: true,
        slotOrder: true,
      },
    }),
    prisma.roster.findUnique({ where: { id: sample.rosterId }, select: { platformUserId: true } }),
  ])

  if (!league) throw new Error(`League not found: ${sample.leagueId}`)
  if (!session) throw new Error(`DraftSession not found: ${sample.sessionId}`)
  if (!targetRoster) throw new Error(`Roster not found: ${sample.rosterId}`)

  const picksBefore = await prisma.draftPick.findMany({
    where: { sessionId: sample.sessionId, overall: { lt: sample.overall } },
    select: { rosterId: true, position: true, team: true, byeWeek: true, playerName: true },
  })

  const { isSF, is2QB, scoringFormat, tePremiumValue } = resolveLeagueScoringFlags(league.settings, league.starters)
  const rosterFormatType = (await isIdpLeague(sample.leagueId)) ? 'IDP' : 'standard'

  const [adpResult, template, pool] = await Promise.all([
    readAllFantasyAdpForLeague(sample.leagueId),
    getRosterTemplate(league.sport, rosterFormatType, sample.leagueId),
    getPlayerPoolForLeague(sample.leagueId, league.sport as LeagueSport, { limit: 800 }).catch(() => []),
  ])

  const poolByKey = new Map(pool.map((p) => [playerKey(p.full_name, p.position), p]))
  const rosterSlots = template.slots.flatMap((slot) => Array(Math.max(0, slot.starterCount)).fill(slot.slotName))
  const totalTeams = session.teamCount ?? Math.max(1, new Set(picksBefore.map((p) => p.rosterId)).size || 1)

  const keeperLockedPlayers = extractKeeperLockedPlayers(session.keeperSelections)
  const targetRosterPickCount = picksBefore.filter((p) => p.rosterId === sample.rosterId).length
  const auctionContext = resolveAuctionContext(session, sample.rosterId, rosterSlots, targetRosterPickCount)

  const assembled = assembleEngineInputFromPicks({
    picksSoFar: picksBefore,
    targetRosterId: sample.rosterId,
    adpEntries: adpResult.entries,
    poolByKey,
    rosterSlots,
    round: sample.round,
    pick: sample.overall,
    totalTeams,
    sport: league.sport,
    isDynasty: league.isDynasty,
    isSF,
    is2QB,
    scoringFormat,
    tePremiumValue,
    keeperLockedPlayers,
    auctionContext,
    mode: 'needs',
  })

  return {
    leagueId: sample.leagueId,
    rosterId: sample.rosterId,
    sessionId: sample.sessionId,
    platform: league.platform,
    sport: league.sport,
    isDynasty: league.isDynasty,
    isSF,
    is2QB,
    round: sample.round,
    pick: sample.overall,
    totalTeams,
    status: session.status,
    draftType: session.draftType ?? null,
    isDevy: Boolean(session.devyConfig),
    managerKey: targetRoster.platformUserId ?? null,
    assembledAt: new Date().toISOString(),
    engineInput: assembled.engineInput,
    playerIdByKey: assembled.playerIdByKey,
    dataCompleteness: {
      availablePoolSize: assembled.dataCompleteness.availablePoolSize,
      adpSampleTotal: adpResult.totalDrafts,
      rosterPickCount: assembled.dataCompleteness.rosterPickCount,
      unresolvedPlayerIdCount: assembled.dataCompleteness.unresolvedPlayerIdCount,
    },
  }
}

export async function runDraftShadowBacktest(
  samples: HistoricalDraftPickSample[],
  options: DraftBacktestRunOptions = {}
): Promise<DraftBacktestRunSummary> {
  const resultStore = options.resultStore ?? defaultDraftShadowResultStore
  const evaluations: DraftBacktestRunSummary['evaluations'] = []
  const failures: DraftBacktestRunSummary['failures'] = []
  const pairs: DraftBacktestRunSummary['pairs'] = []

  for (const sample of samples) {
    try {
      const ctx = await buildHistoricalContext(sample)
      const evaluation = await evaluateDraftShadowFromContext(ctx, resultStore)
      evaluations.push(evaluation)
      pairs.push({ sample, evaluation })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ sessionId: sample.sessionId, overall: sample.overall, error: message })
      options.onSampleError?.(sample, err)
    }
  }

  return {
    totalSamples: samples.length,
    evaluatedCount: evaluations.length,
    failedCount: failures.length,
    failures,
    evaluations,
    pairs,
  }
}
