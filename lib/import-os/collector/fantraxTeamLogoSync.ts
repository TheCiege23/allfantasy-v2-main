import { prisma } from '@/lib/prisma'
import { fantraxLogoUrl, withStoredFantraxTeamLogos, type StoredFantraxTeamLogo } from '@/lib/league-import/fantrax/fantraxSnapshotHistory'
import { teamIndex } from '@/lib/league-import/fantrax/fantraxTradeHistoryPlan'
import { commissionersFantraxLeague } from './fantraxTransactionSync'

/**
 * Fantrax team logos through the browser connector (tools/fantrax-browser-connector).
 *
 * 🛑 EVERY FANTRAX TEAM SHOWED A LETTER, NOT A PICTURE. Measured on production 2026-10-30: 0 of 209
 * Fantrax `LeagueTeam` rows had an `avatarUrl` (ESPN 106 of 106). Fantrax's public API sends no picture
 * field (contracts/fantrax/GAPS.md F-14). The logged-in site does: its `getFantasyTeams` request lists
 * every team with a logo on Fantrax's image server (F-20). The connector reads that list with the
 * commissioner's own Fantrax login and posts it here. This module never calls Fantrax.
 *
 * ⚠ SAVED IN TWO PLACES, ON PURPOSE. A scheduled refresh writes only a team's record, never its
 * picture, so the logo is written straight onto the team row and stays there. It is also kept on the
 * league snapshot, where a fresh import of the league reads it (`FantraxLeagueFetchService`).
 */
const SOURCE_ID = /^[a-z0-9]{8,32}$/
/** Fantrax leagues run to the 30s of teams; anything far past that is not a team list. */
export const FANTRAX_TEAM_LOGO_LIMIT = 100

export type FantraxTeamLogoInput = { id?: unknown; name?: unknown; logoUrl?: unknown }

/** What the connector needs: the league's name and the one address its team list comes from. */
export async function fantraxTeamLogoContext(userId: string, leagueId: string) {
  const { leagueName, sourceLeagueId } = await commissionersFantraxLeague(userId, leagueId)
  if (!SOURCE_ID.test(sourceLeagueId)) throw new Error('League unavailable')
  return {
    leagueId,
    leagueName,
    mode: 'browser-session' as const,
    requestUrl: `https://www.fantrax.com/fxpa/req?leagueId=${sourceLeagueId}`,
    refUrl: `https://www.fantrax.com/fantasy/league/${sourceLeagueId}/home`,
  }
}

export type FantraxTeamLogoSyncResult = {
  /** Teams in the list the connector sent. */
  listed: number
  /** Team rows whose picture was set or changed. */
  saved: number
  /** Team rows that already had this picture. */
  unchanged: number
  /** Teams in the list that match no team in this league, by name. */
  unmatched: string[]
  /** Teams whose logo address was not an image on Fantrax's image server, and was not saved. */
  refused: number
}

export async function importFantraxTeamLogos(
  userId: string,
  input: { leagueId: string; teams: readonly FantraxTeamLogoInput[] },
): Promise<FantraxTeamLogoSyncResult> {
  const { snapshotId } = await commissionersFantraxLeague(userId, input.leagueId)
  if (!Array.isArray(input.teams) || input.teams.length === 0 || input.teams.length > FANTRAX_TEAM_LOGO_LIMIT) throw new Error('Invalid team list')

  const logos: StoredFantraxTeamLogo[] = []
  let refused = 0
  for (const team of input.teams) {
    const teamId = typeof team?.id === 'string' ? team.id.trim() : ''
    const teamName = typeof team?.name === 'string' ? team.name.trim().slice(0, 120) : ''
    const logoUrl = fantraxLogoUrl(team?.logoUrl)
    if (!SOURCE_ID.test(teamId) || !teamName || !logoUrl) { refused += 1; continue }
    logos.push({ teamId, teamName, logoUrl })
  }

  const rows = await prisma.leagueTeam.findMany({
    where: { leagueId: input.leagueId },
    select: { id: true, externalId: true, teamName: true, platformUserId: true, avatarUrl: true },
  })
  // The same name rule the trade and claim importers use: the exact name, then the name without its "#12 " prefix.
  const teamOf = teamIndex(rows)
  const rowByExternalId = new Map(rows.map((row) => [row.externalId, row]))

  let saved = 0
  let unchanged = 0
  const unmatched: string[] = []
  const taken = new Set<string>()
  for (const logo of logos) {
    const hit = teamOf(logo.teamName ?? '')
    const row = typeof hit === 'string' ? undefined : rowByExternalId.get(hit.externalId)
    // Two listed teams resolving to one row means a name is not unique enough; the second is left alone.
    if (!row || taken.has(row.id)) { unmatched.push(logo.teamName ?? logo.teamId); continue }
    taken.add(row.id)
    if (row.avatarUrl === logo.logoUrl) { unchanged += 1; continue }
    await prisma.leagueTeam.update({ where: { id: row.id }, data: { avatarUrl: logo.logoUrl } })
    saved += 1
  }

  if (logos.length) {
    const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: snapshotId }, select: { transactions: true } })
    await prisma.fantraxLeague.update({
      where: { id: snapshotId },
      data: { transactions: withStoredFantraxTeamLogos(snapshot?.transactions ?? null, logos, new Date().toISOString()) as object },
    })
  }

  return { listed: input.teams.length, saved, unchanged, unmatched, refused }
}
