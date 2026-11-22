import 'server-only'

import { prisma } from '@/lib/prisma'
import { backfillTransactionFactsFromTradeHistory } from '@/lib/psychological-profiles/TransactionFactBackfill'
import { ingestSleeperTradeFacts, type SleeperTradeIngestResult } from '@/lib/psychological-profiles/SleeperTradeFactIngest'

/**
 * Keeps NEW Sleeper trades landing in `dw_transaction_facts` after a league's import (re-score build item 10,
 * 2026-11-19).
 *
 * 🛑 THIS USED TO BE A SIDE EFFECT OF THE PERSONALITY-PROFILE ROTATION, AND RETIRING THAT ROTATION WOULD HAVE
 * STOPPED IT SILENTLY. `refreshStaleLeagueProfiles` opened with two "enrichment" steps — normalise
 * `LeagueTradeHistory` into trade facts, then pull each picked league's trades from Sleeper — before profiling
 * anyone. Those two steps were the ONLY scheduled writer of Sleeper trades after import:
 * `SleeperHistoricalTransactionSyncService` runs once, at import, and the activity-ingest cron writes a
 * different table. Trade Center's league history, Competitive Edge, the manager record, partner history and
 * decision receipts all read `transactionFact`. Removing the profile phase without this would have frozen
 * every Sleeper league's trade list at its import date — no error, no red test, just stale facts that look
 * current.
 *
 * WHAT CHANGED BESIDES THE SPLIT: the ORDER. The profile rotation picked the leagues whose profiles were
 * stalest; with no profiles there is nothing to be stale. A trade-fact timestamp is no substitute — a league
 * with no trades would sort first forever and wedge the head of the line (the orphan wedge
 * `refreshStaleLeagueProfiles` already records). So this rotation is STATELESS: Sleeper leagues sorted by id,
 * and each 6-hour slot takes the next `perTick` of them, wrapping. Every league is revisited every
 * ceil(n / perTick) slots; a missed tick skips one slice for one lap and nothing is wedged. The Sleeper read
 * itself is incremental (season completion gate + week checkpoint), so a revisit of an unchanged league
 * costs one or two calls.
 */

/** The `?intel=1` tick fires every six hours (`cron-schedule.json`); one slot per fire. */
export const SLEEPER_TRADE_FACT_SLOT_MS = 6 * 60 * 60 * 1000
export const SLEEPER_TRADE_FACT_LEAGUES_PER_TICK = 24

/** The slice of `sortedIds` that slot number `slot` covers: `perTick` ids from `slot * perTick`, wrapping. */
export function rotationSlice(sortedIds: readonly string[], perTick: number, slot: number): string[] {
  const n = sortedIds.length
  if (n === 0 || perTick <= 0) return []
  if (perTick >= n) return [...sortedIds]
  const start = (((slot % n) * (perTick % n)) % n + n) % n
  const out: string[] = []
  for (let i = 0; i < perTick; i++) out.push(sortedIds[(start + i) % n]!)
  return out
}

export type SleeperTradeFactRotationResult = {
  sleeperLeagues: number
  picked: number
  slot: number
  historyFactsWritten: number | null
  ingest: SleeperTradeIngestResult | null
  errors: string[]
}

export async function rotateSleeperTradeFacts(input?: {
  perTick?: number
  now?: number
}): Promise<SleeperTradeFactRotationResult> {
  const perTick = input?.perTick ?? SLEEPER_TRADE_FACT_LEAGUES_PER_TICK
  const slot = Math.floor((input?.now ?? Date.now()) / SLEEPER_TRADE_FACT_SLOT_MS)
  const rows = await prisma.league.findMany({
    where: { platform: { equals: 'sleeper', mode: 'insensitive' }, platformLeagueId: { not: '' } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const picked = rotationSlice(
    rows.map((r) => r.id),
    perTick,
    slot,
  )
  const result: SleeperTradeFactRotationResult = {
    sleeperLeagues: rows.length,
    picked: picked.length,
    slot,
    historyFactsWritten: null,
    ingest: null,
    errors: [],
  }
  if (picked.length === 0) return result

  // Both steps take the cap explicitly: each applies its OWN default (the ingest's is 25), and omitting it
  // would silently truncate a larger slice — the trap `refreshStaleLeagueProfiles` already records.
  try {
    const backfill = await backfillTransactionFactsFromTradeHistory({ leagueIds: picked, maxLeagues: picked.length })
    result.historyFactsWritten = backfill.factsWritten
  } catch (err) {
    result.errors.push(`history backfill: ${err instanceof Error ? err.message.slice(0, 120) : 'failed'}`)
  }
  // ONE batched call, never one per league: the ingest resets a module-level rate-limit counter on entry.
  try {
    result.ingest = await ingestSleeperTradeFacts({ leagueIds: picked, maxLeagues: picked.length })
  } catch (err) {
    result.errors.push(`sleeper ingest: ${err instanceof Error ? err.message.slice(0, 120) : 'failed'}`)
  }
  return result
}
