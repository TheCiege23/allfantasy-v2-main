/**
 * Write the completed claims and drops in a Fantrax "Transaction History → Claim/Drop" export into an imported
 * Fantrax league's transaction history.
 *
 * 🛑 UNTIL NOW A FANTRAX ADD OR DROP WAS ONLY EVER INFERRED. Fantrax's public API has no transactions endpoint
 * (contracts/fantrax/GAPS.md F-13), so a refresh compares two rosters and stores what changed as `inferred`: it
 * cannot tell a waiver claim from a free-agent pickup, sees nothing made and undone between two refreshes, and
 * stamps the refresh's time. This export is Fantrax's own record: who, which team, the winning bid and when.
 *
 * Reads Postgres only (the league, its teams, the player registry) and writes `TransactionFact` through
 * `persistProviderTransactionFacts`, keyed on the row's content, so the same export read twice writes nothing
 * the second time. Every row is written `completed`. A row whose team or player cannot be placed is refused and
 * reported, never written half-known.
 *
 * ⚠ NOT THE LEAGUE'S WHOLE HISTORY. The one captured export of an 11-week season started in week 10 (GAPS
 * F-19), for a reason not yet known. Nothing here may describe an import as complete history.
 *
 * ⚠ THE INFERRED ROWS ARE LEFT IN PLACE. A move this file confirms may also sit in the table as `inferred`.
 */
import { isSupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
import { persistProviderTransactionFacts, type ProviderTransactionFactInput } from '@/lib/league-import/persistProviderTransactionFacts'
import { parseFantraxClaimDropCsv, type FantraxCsvClaimDrop } from './fantraxClaimDropCsv'
import type { FantraxCsvSkip } from './fantraxTradeHistoryCsv'
import { playerIndex, seasonForFantraxTrade, teamIndex } from './fantraxTradeHistoryPlan'

/** Generous for a CSV of claims (78 rows are ~8 KB); stops a stray upload. */
export const FANTRAX_CLAIM_DROP_CSV_MAX_BYTES = 2_000_000

export type FantraxRefusedClaimDrop = { dateText: string; team: string; playerName: string; reason: string }

export type FantraxClaimDropImportResult =
  | {
      ok: true
      /**
       * Moves in the file that were placed (a known team and a uniquely matched player) and sent to the store.
       * A move already stored from an earlier read is left as it is, so this is not a count of NEW rows.
       */
      placed: number
      claims: number
      drops: number
      refused: FantraxRefusedClaimDrop[]
      skippedLines: FantraxCsvSkip[]
    }
  | { ok: false; status: 400 | 404 | 409; error: string }

/** A claim Fantrax recorded with a bid went through waivers; one with no bid needed none. */
export function claimDropFactType(move: Pick<FantraxCsvClaimDrop, 'kind' | 'bid'>): 'waiver' | 'free_agent' | 'drop' {
  if (move.kind === 'drop') return 'drop'
  return move.bid != null ? 'waiver' : 'free_agent'
}

export async function importFantraxClaimDropHistory(args: { leagueId: string; csvText: string }): Promise<FantraxClaimDropImportResult> {
  if (args.csvText.length > FANTRAX_CLAIM_DROP_CSV_MAX_BYTES) return { ok: false, status: 400, error: 'The file is too large for a claim/drop history export.' }
  const league = await prisma.league.findUnique({
    where: { id: args.leagueId },
    select: { platform: true, platformLeagueId: true, sport: true },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (String(league.platform ?? '').toLowerCase() !== 'fantrax' || !league.platformLeagueId) {
    return { ok: false, status: 409, error: 'This is not an imported Fantrax league.' }
  }
  const sport = league.sport
  if (!isSupportedSport(sport)) return { ok: false, status: 409, error: 'Unsupported league sport.' }

  const parsed = parseFantraxClaimDropCsv(args.csvText)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }

  const [teams, identities] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId: args.leagueId }, select: { externalId: true, teamName: true, platformUserId: true } }),
    prisma.playerIdentityMap.findMany({
      where: { sport, fantraxId: { not: null } },
      select: { fantraxId: true, canonicalName: true, currentTeam: true, position: true },
    }),
  ])
  const teamOf = teamIndex(teams)
  const playerOf = playerIndex(identities.flatMap((row) => (row.fantraxId ? [{ ...row, fantraxId: row.fantraxId }] : [])), sport)

  const rows: ProviderTransactionFactInput[] = []
  const refused: FantraxRefusedClaimDrop[] = []
  let claims = 0
  let drops = 0
  for (const move of parsed.moves) {
    const refuse = (reason: string) => refused.push({ dateText: move.dateText, team: move.team, playerName: move.playerName, reason })
    const team = teamOf(move.team)
    if (typeof team === 'string') { refuse(team); continue }
    const player = playerOf(move.playerName, move.proTeam, move.position)
    if (typeof player !== 'string') { refuse(player.problem); continue }
    const upstreamTransactionId = `fantrax-csv:claim-drop:${move.id}`
    rows.push({
      provider: 'fantrax',
      upstreamTransactionId,
      entryIndex: 0,
      leagueId: args.leagueId,
      sport,
      type: claimDropFactType(move),
      playerId: player,
      rosterId: team.externalId,
      managerId: team.platformUserId ?? null,
      season: seasonForFantraxTrade(sport, move.date),
      weekOrPeriod: move.week,
      occurredAt: move.date,
      lifecycleStage: 'completed',
      payload: {
        status: 'completed',
        direction: move.kind === 'drop' ? 'dropped' : 'obtained',
        providerTransactionId: upstreamTransactionId,
        source: 'fantrax_transaction_history',
        playerName: move.playerName,
        proTeam: move.proTeam,
        position: move.position,
        teamName: move.team,
        bid: move.bid,
        dateText: move.dateText,
      },
    })
    if (move.kind === 'drop') drops += 1
    else claims += 1
  }

  if (rows.length) await persistProviderTransactionFacts(rows)
  return { ok: true, placed: rows.length, claims, drops, refused, skippedLines: parsed.skipped }
}
