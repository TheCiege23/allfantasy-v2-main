import { prisma } from '@/lib/prisma'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { importFantraxTradeHistory, type FantraxTradeHistoryImportResult } from '@/lib/league-import/fantrax/importFantraxTradeHistory'
import { importFantraxClaimDropHistory, type FantraxClaimDropImportResult } from '@/lib/league-import/fantrax/importFantraxClaimDropHistory'

/**
 * Fantrax "Transaction History" through the browser connector (tools/fantrax-browser-connector).
 *
 * Fantrax's public API has no transactions endpoint; completed trades, claims and drops are on the logged-in
 * website, behind a "Download all as CSV" button (contracts/fantrax/GAPS.md F-19). The connector downloads
 * those files with the commissioner's own Fantrax login and posts the text here. This module never calls
 * Fantrax: it builds the two addresses for the connector to fetch, and reads what the connector sends back.
 */
export const FANTRAX_TRANSACTION_VIEWS = ['TRADE', 'CLAIM_DROP'] as const
export type FantraxTransactionView = (typeof FANTRAX_TRANSACTION_VIEWS)[number]

/**
 * The captured download request (fixtures/2026-transaction-history-download.json), with only the league and
 * the tab varying.
 *
 * ⚠ ONLY `view=CLAIM_DROP` WAS CAPTURED. `view=TRADE` is the same button on the neighbouring tab and is
 * assumed to take the same parameters. The connector checks the columns of what comes back and refuses a
 * file that is not the export it asked for, so a wrong assumption fails closed.
 */
export function fantraxTransactionDownloadUrl(sourceLeagueId: string, view: FantraxTransactionView): string {
  if (!/^[a-z0-9]{8,32}$/.test(sourceLeagueId)) throw new Error('Download contract unavailable')
  const query = new URLSearchParams({
    leagueId: sourceLeagueId,
    pageNumber: '1',
    team: 'ALL',
    positionOrGroup: 'ALL',
    view,
    adminMode: 'false',
    includeDeleted: 'false',
    executedOnly: 'true',
  })
  return `https://www.fantrax.com/fxpa/downloadTransactionHistory?${query}`
}

async function commissionersFantraxLeague(userId: string, leagueId: string) {
  // Commissioner only, as the trade-history upload is: these rows become the league's record for every member.
  if (!(await canCommissionerAct(leagueId, userId, 'league'))) throw new Error('League unavailable')
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, platform: true, platformLeagueId: true } })
  if (String(league?.platform ?? '').toLowerCase() !== 'fantrax' || !league?.platformLeagueId) throw new Error('League unavailable')
  const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: league.platformLeagueId }, select: { sourceLeagueId: true } })
  if (!snapshot?.sourceLeagueId) throw new Error('League unavailable')
  return { leagueName: league.name ?? 'Fantrax league', sourceLeagueId: snapshot.sourceLeagueId }
}

/** What the connector needs to fetch: the league's name and one download address per tab. */
export async function fantraxTransactionContext(userId: string, leagueId: string) {
  const { leagueName, sourceLeagueId } = await commissionersFantraxLeague(userId, leagueId)
  return {
    leagueId,
    leagueName,
    mode: 'browser-session' as const,
    downloads: FANTRAX_TRANSACTION_VIEWS.map((view) => ({ view, url: fantraxTransactionDownloadUrl(sourceLeagueId, view) })),
  }
}

export type FantraxTransactionSyncResult = {
  trades: FantraxTradeHistoryImportResult | null
  claimDrops: FantraxClaimDropImportResult | null
}

/**
 * Read the exports the connector downloaded. Each file is imported on its own: a Trade file that cannot be
 * read does not stop the Claim/Drop file, and each result says what happened to its own file.
 */
export async function importFantraxTransactionExports(
  userId: string,
  input: { leagueId: string; trades?: string | null; claimDrops?: string | null },
): Promise<FantraxTransactionSyncResult> {
  await commissionersFantraxLeague(userId, input.leagueId)
  const trades = input.trades ? await importFantraxTradeHistory({ leagueId: input.leagueId, csvText: input.trades }) : null
  const claimDrops = input.claimDrops ? await importFantraxClaimDropHistory({ leagueId: input.leagueId, csvText: input.claimDrops }) : null
  return { trades, claimDrops }
}
