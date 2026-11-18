/**
 * Attach a Fantrax trade-history export to a league that was imported live.
 *
 * The live import reads everything it can from Fantrax's API, and the API does
 * not publish future picks past round 4 (see `fantraxPickTrades.ts`). This is how
 * the later rounds get in: the user exports their league's trade history and the
 * pick trades in it are kept beside the snapshot, for the importer to read.
 *
 * ⚠ ONLY THE CALLER'S OWN SNAPSHOT. The lookup is `sourceLeagueId` AND
 * `appUserId`, so a league id alone — which is not a secret — never lets one
 * account write onto another's import. No matching row is reported as not found,
 * the same answer a league that does not exist gets.
 *
 * ⚠ STORED UNDER ITS OWN KEY. `FantraxLeague.transactions` also holds the
 * CSV-era groups (`claims`, `drops`, `trades`…) that the importer turns into
 * transaction history. Pick trades go in `pickTrades`, which that reader does not
 * look at, so attaching an export cannot inject rows into a league's transaction
 * history as a side effect.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import {
  mergeFantraxPickTrades,
  parseFantraxTradeCsv,
  readStoredFantraxPickTrades,
} from './fantraxPickTrades'

/** Trade exports are small (one line per traded asset). Anything far past that is not one. */
export const FANTRAX_TRADE_CSV_MAX_BYTES = 2 * 1024 * 1024

export type AttachFantraxTradeCsvResult =
  | {
      ok: true
      /** Pick-trade rows read from this file. */
      pickTradesInFile: number
      /** How many of those were not already on file. */
      added: number
      /** Total on file for the league after this upload. */
      stored: number
      /** Rows that say "Draft Pick" but could not be read. */
      unreadablePickRows: number
      /** Team names in the file that match no team in the league — those picks cannot be placed. */
      unknownTeams: string[]
      /** Rounds the file's pick trades cover, so the caller can say what was gained. */
      rounds: number[]
    }
  | { ok: false; code: 'not_a_trade_export' | 'too_large' | 'league_not_found'; error: string }

const normalise = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export async function attachFantraxTradeCsv(args: {
  appUserId: string
  sourceLeagueId: string
  csv: string
}): Promise<AttachFantraxTradeCsvResult> {
  if (Buffer.byteLength(args.csv ?? '', 'utf8') > FANTRAX_TRADE_CSV_MAX_BYTES) {
    return { ok: false, code: 'too_large', error: 'That file is too large to be a Fantrax trade history export.' }
  }
  const parsed = parseFantraxTradeCsv(args.csv)
  if (!parsed.recognised) {
    return {
      ok: false,
      code: 'not_a_trade_export',
      error:
        'That does not look like a Fantrax trade history export. On Fantrax, open Transactions, History, Trades, then download the CSV.',
    }
  }

  const snapshots = await prisma.fantraxLeague.findMany({
    where: { sourceLeagueId: args.sourceLeagueId, appUserId: args.appUserId },
    select: { id: true, transactions: true, standings: true },
  })
  if (snapshots.length === 0) {
    return {
      ok: false,
      code: 'league_not_found',
      error: 'Import this Fantrax league first, then add its trade history.',
    }
  }

  let added = 0
  let stored = 0
  const knownTeams = new Set<string>()
  for (const snapshot of snapshots) {
    for (const row of Array.isArray(snapshot.standings) ? snapshot.standings : []) {
      const team = (row as { team?: unknown } | null)?.team
      if (typeof team === 'string' && team.trim()) knownTeams.add(normalise(team))
    }
    const existing = readStoredFantraxPickTrades(snapshot.transactions)
    const merged = mergeFantraxPickTrades(existing, parsed.pickTrades)
    added = Math.max(added, merged.length - existing.length)
    stored = Math.max(stored, merged.length)
    const base =
      snapshot.transactions && typeof snapshot.transactions === 'object' && !Array.isArray(snapshot.transactions)
        ? (snapshot.transactions as Record<string, unknown>)
        : {}
    await prisma.fantraxLeague.update({
      where: { id: snapshot.id },
      data: {
        transactions: {
          ...base,
          pickTrades: merged,
          pickTradesUploadedAt: new Date().toISOString(),
        } as unknown as object,
      },
    })
  }

  const namesInFile = new Set<string>()
  for (const trade of parsed.pickTrades) {
    namesInFile.add(trade.originalTeam)
    namesInFile.add(trade.fromTeam)
    namesInFile.add(trade.toTeam)
  }

  return {
    ok: true,
    pickTradesInFile: parsed.pickTrades.length,
    added,
    stored,
    unreadablePickRows: parsed.unreadablePickRows,
    unknownTeams: [...namesInFile].filter((name) => !knownTeams.has(normalise(name))).sort(),
    rounds: [...new Set(parsed.pickTrades.map((t) => t.round))].sort((a, b) => a - b),
  }
}
