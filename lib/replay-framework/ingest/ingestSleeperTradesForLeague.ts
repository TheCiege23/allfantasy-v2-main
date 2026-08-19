/**
 * Decision OS Replay Framework — manually invokable Sleeper trade ingestion
 * for a single league. Per docs/SLEEPER_TRADE_REPLAY_ARCHITECTURE_ADR.md and
 * this phase's explicit scope: NOT wired to any route, cron, or scheduler.
 * Calling code (a future, separately-approved script) is responsible for
 * invoking this per league it wants to ingest.
 *
 * Reuses lib/sleeper-client.ts's existing readers (getAllLeagueTrades()
 * already loops weeks and filters to type='trade' — nothing new was built
 * for that step) rather than duplicating Sleeper API access.
 */
import {
  getAllLeagueTrades,
  getAllPlayers,
  getLeagueInfo,
  getLeagueRosters,
  getLeagueUsers,
} from '@/lib/sleeper-client'
import { fetchFantasyCalcValues } from '@/lib/fantasycalc'
import { normalizeSleeperTrade } from '../normalize/sleeperTradeNormalizer'
import { runTradeBacktest } from '../backtest/tradeBacktestExecutor'
import { upsertBacktestResult, upsertReplayImport } from '../writer'

export interface IngestSleeperTradesResult {
  leagueId: string
  tradesFound: number
  replaysWritten: number
  backtestsWritten: number
  errors: Array<{ transactionId: string; error: string }>
}

export async function ingestSleeperTradesForLeague(
  sleeperLeagueId: string,
  ingestSourceUserId: string,
  totalWeeks = 18,
): Promise<IngestSleeperTradesResult> {
  const league = await getLeagueInfo(sleeperLeagueId)
  if (!league) {
    return { leagueId: sleeperLeagueId, tradesFound: 0, replaysWritten: 0, backtestsWritten: 0, errors: [{ transactionId: '', error: 'league not found' }] }
  }

  const [rosters, users, players, trades] = await Promise.all([
    getLeagueRosters(sleeperLeagueId),
    getLeagueUsers(sleeperLeagueId),
    getAllPlayers(),
    getAllLeagueTrades(sleeperLeagueId, totalWeeks),
  ])

  const isDynasty = league.settings?.type === 2 || league.settings?.type === 1
  const numQb = (league.roster_positions ?? []).filter((p) => p === 'QB' || p === 'SUPER_FLEX').length
  const fcPlayers = await fetchFantasyCalcValues({
    isDynasty,
    numQbs: numQb >= 2 ? 2 : 1,
    numTeams: league.total_rosters || 12,
    ppr: 1,
  })

  let replaysWritten = 0
  let backtestsWritten = 0
  const errors: Array<{ transactionId: string; error: string }> = []

  for (const tx of trades) {
    try {
      const normalized = normalizeSleeperTrade({
        transaction: tx,
        league,
        rosters,
        users,
        players: players as any,
        fcPlayers,
        ingestSourceUserId,
        providerWeek: null, // caller-agnostic — the same trade can appear in multiple week buckets during backfill; real week is derivable from `proposedAt` if ever needed
      })

      const replayId = await upsertReplayImport(normalized)
      replaysWritten++

      const backtestInput = await runTradeBacktest({
        replayId,
        season: normalized.season,
        payload: normalized.payload as any,
        isSuperFlex: normalized.isSuperFlex ?? false,
        providerStatus: normalized.providerStatus,
        resolvedAt: normalized.resolvedAt,
        rosterPositions: league.roster_positions,
      })
      await upsertBacktestResult(backtestInput)
      backtestsWritten++
    } catch (err) {
      errors.push({ transactionId: tx.transaction_id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    leagueId: sleeperLeagueId,
    tradesFound: trades.length,
    replaysWritten,
    backtestsWritten,
    errors,
  }
}
