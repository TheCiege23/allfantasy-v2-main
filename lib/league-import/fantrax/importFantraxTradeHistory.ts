/**
 * Write the completed trades in a Fantrax "Transaction History → Trade" export into an imported Fantrax NFL league's
 * `LeagueTrade` rows, where the Trade Center lists and grades them.
 *
 * Reads Postgres only (the league, its teams, the player registry) and writes through `persistTradesForSeason`, the
 * same upsert every provider's trades use — keyed on the trade's content-derived id, so uploading the same export
 * again rewrites the same rows and never duplicates one.
 *
 * NFL only: the player rule is the NFL Fantrax linker's. Other sports are refused rather than matched by a rule
 * that was not written for them.
 */
import { prisma } from '@/lib/prisma'
import { persistTradesForSeason } from '@/lib/dynasty-import/normalize-historical'
import { parseFantraxTradeHistoryCsv, type FantraxCsvSkip } from './fantraxTradeHistoryCsv'
import { planFantraxTradeHistoryImport, type FantraxRefusedTrade } from './fantraxTradeHistoryPlan'

/** Generous for a CSV of trades (the sample is ~2 KB for four trades); stops a stray upload. */
export const FANTRAX_TRADE_CSV_MAX_BYTES = 1_000_000

export type FantraxTradeHistoryImportResult =
  | {
      ok: true
      /** Trades written (each is two `LeagueTrade` rows, one per side). */
      imported: number
      rowsWritten: number
      refused: FantraxRefusedTrade[]
      /** Lines of the file that were not a readable trade row. */
      skippedLines: FantraxCsvSkip[]
    }
  | { ok: false; status: 400 | 404 | 409; error: string }

export async function importFantraxTradeHistory(args: { leagueId: string; csvText: string }): Promise<FantraxTradeHistoryImportResult> {
  if (args.csvText.length > FANTRAX_TRADE_CSV_MAX_BYTES) return { ok: false, status: 400, error: 'The file is too large for a trade history export.' }
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { platform: true, platformLeagueId: true, sport: true },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (String(league.platform ?? '').toLowerCase() !== 'fantrax' || !league.platformLeagueId) {
    return { ok: false, status: 409, error: 'This is not an imported Fantrax league.' }
  }
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') {
    return { ok: false, status: 409, error: 'Trade history upload is available for Fantrax NFL leagues only.' }
  }

  const parsed = parseFantraxTradeHistoryCsv(args.csvText)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }

  const [teams, identities] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId: args.leagueId }, select: { externalId: true, teamName: true, platformUserId: true } }),
    prisma.playerIdentityMap.findMany({
      where: { sport: 'NFL', fantraxId: { not: null } },
      select: { fantraxId: true, canonicalName: true, currentTeam: true, position: true },
    }),
  ])
  const plan = planFantraxTradeHistoryImport({
    trades: parsed.trades,
    teams,
    identities: identities.flatMap((row) => (row.fantraxId ? [{ ...row, fantraxId: row.fantraxId }] : [])),
  })

  const bySeason = new Map<number, typeof plan.ready>()
  for (const t of plan.ready) bySeason.set(t.fact.season, [...(bySeason.get(t.fact.season) ?? []), t])
  let rowsWritten = 0
  for (const [season, trades] of bySeason) {
    rowsWritten += await persistTradesForSeason(
      league.platformLeagueId,
      season,
      trades.map((t) => t.fact),
      plan.rosterIdToOwner,
      'fantrax',
      'nfl',
    )
  }
  return { ok: true, imported: plan.ready.length, rowsWritten, refused: plan.refused, skippedLines: parsed.skipped }
}
