import 'server-only'

import { prisma } from '@/lib/prisma'
import { findRosterForTeam, rosterPlayerIds } from '@/lib/leagues/rosterForTeam'
import { leagueDisplayName, type SectionState } from './leagueHome'

/**
 * Every league you are in — the inventory the new dashboard does not have.
 *
 * ⚠ THIS IS THE BLOCKER THAT MATTERED MOST IN THE CUTOVER LEDGER. `/core` home is
 * an issues-and-deadlines queue: it takes a league COUNT, not a list. `/dashboard`
 * renders every league with detail and a modal. Redirecting one to the other
 * without this would leave a user with eight leagues no way to see them — the
 * screen would be strictly better at "what needs me now" and would have silently
 * deleted "what do I have".
 *
 * ⚠ THE ROSTER JOIN USES ALL THREE CANDIDATES, and that is not optional. Matching
 * only on LeagueTeam.platformUserId and externalId found a roster for 38 of 106
 * claimed teams; adding the caller's own User uuid takes it to 93, because
 * Roster.platformUserId sometimes holds our uuid rather than the platform's id.
 * Same predicate as myTeam.ts and playerImpact.ts — deliberately, so the three
 * surfaces cannot disagree about which team is yours.
 */

export type PortfolioLeague = {
  leagueId: string
  leagueName: string
  platform: string
  sport: string
  season: string | null
  /** Your team in this league, when we can resolve it. */
  team: {
    name: string
    record: string | null
    rank: number | null
    teamCount: number | null
  } | null
  /** True when you commission this league. */
  isCommissioner: boolean
  /** Roster size we hold, or null when no roster is imported. */
  rosterCount: number | null
  /**
   * The league's artwork, when the platform gave us one.
   *
   * ⚠ `avatarUrl`, NOT `logoUrl`. Measured on production: `logoUrl` is null on
   * all 115 leagues and has never been written, while `avatarUrl` is populated
   * on 48. Reading the empty column is why no league art has ever appeared.
   *
   * Null for the other 67, which is a real state and NOT an error — those
   * leagues have no avatar on the platform either, so the row falls back to a
   * monogram rather than a broken image.
   */
  avatarUrl: string | null
}

export type PortfolioData = {
  leagues: SectionState<PortfolioLeague[]>
  commissionedCount: number
}

type CollapseKey = {
  platformLeagueId: string | null
  season: number | null
  importedByMe: boolean
}

/**
 * One row per REAL league, not per import of it.
 *
 * ⚠ THE SAME LEAGUE APPEARS ONCE PER MANAGER WHO IMPORTED IT. `leagues.userId`
 * is the IMPORTER, so KBFL exists twice — once from its commissioner and once
 * from a co-manager — and a user who is in both copies saw two identical KBFL
 * rows. It is NOT a repeated import: same user + same platformLeagueId occurs
 * ZERO times in production. The importer upserts correctly; the LIST was
 * counting views of one league as separate leagues.
 *
 * ⚠ COLLAPSE ON THE PROVIDER'S ID, NEVER ON THE NAME. `platformLeagueId` is
 * Sleeper's own id, so equal ids ARE the same league by definition — while two
 * leagues can share a name and be genuinely different. The season is in the key
 * because some providers reuse one league id across years, and merging those
 * would silently hide a whole season.
 *
 * Prefer the copy the reader imported themselves; failing that, whichever has a
 * roster behind it, since the other is a view they cannot act on.
 */
function collapseSameRealLeague(
  rows: PortfolioLeague[],
  keys: CollapseKey[],
): PortfolioLeague[] {
  const byPlatform = new Map<string, number>()
  const kept: PortfolioLeague[] = []
  const keptKeys: CollapseKey[] = []

  rows.forEach((row, i) => {
    const key = keys[i]
    /* No provider id means no evidence two rows are the same thing. */
    if (!key?.platformLeagueId) {
      kept.push(row)
      keptKeys.push(key)
      return
    }
    const id = `${key.platformLeagueId}::${key.season ?? ''}`
    const at = byPlatform.get(id)
    if (at === undefined) {
      byPlatform.set(id, kept.length)
      kept.push(row)
      keptKeys.push(key)
      return
    }

    const heldKey = keptKeys[at]
    const held = kept[at]
    const preferIncoming =
      (key.importedByMe && !heldKey.importedByMe) ||
      (key.importedByMe === heldKey.importedByMe &&
        held.rosterCount == null &&
        row.rosterCount != null)

    if (preferIncoming) {
      kept[at] = row
      keptKeys[at] = key
    }
  })

  return kept
}

function recordOf(t: { wins: number; losses: number; ties: number } | null): string | null {
  if (!t) return null
  if (t.wins === 0 && t.losses === 0 && t.ties === 0) return null
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`
}

export async function getPortfolio(userId: string): Promise<PortfolioData> {
  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId },
    select: {
      leagueId: true,
      teamName: true,
      ownerName: true,
      wins: true,
      losses: true,
      ties: true,
      currentRank: true,
      platformUserId: true,
      externalId: true,
      isCommissioner: true,
      league: {
        select: {
          id: true,
          name: true,
          platform: true,
          sport: true,
          season: true,
          avatarUrl: true,
          platformLeagueId: true,
          userId: true,
        },
      },
    },
  })

  if (teams.length === 0) {
    return {
      leagues: {
        available: false,
        reason: 'no leagues claimed to your account yet — import one to get started',
      },
      commissionedCount: 0,
    }
  }

  const leagueIds = [...new Set(teams.map((t) => t.leagueId))]
  const counts = await prisma.leagueTeam.groupBy({
    by: ['leagueId'],
    where: { leagueId: { in: leagueIds } },
    _count: { _all: true },
  })
  const teamCountBy = new Map(counts.map((c) => [c.leagueId, c._count._all]))

  const out: PortfolioLeague[] = []
  /* Parallel to `out`; kept off PortfolioLeague so the public shape is unchanged. */
  const collapseKeys: CollapseKey[] = []
  for (const t of teams) {
    /*
     * ⚠ MATCHING ON `Roster.platformUserId` FINDS ALMOST NOBODY. Measured on
     * production: of 98 claimed teams it reaches 13. `Roster.platformUserId`
     * holds the RESOLVED AllFantasy id once a manager links their account,
     * while `LeagueTeam.platformUserId` keeps the raw platform id — so this
     * lookup silently missed every linked manager, and got worse as more people
     * linked. `findRosterForTeam` tries the durable `source_manager_id` first
     * and falls back to the direct column, reaching 96 of 98.
     */
    const roster = t.platformUserId
      ? await findRosterForTeam(t.leagueId, t.platformUserId)
      : null

    /*
     * ⚠ NULL WHEN NO ROSTER IS IMPORTED, NOT 0. Zero would read as an empty team
     * the user needs to fix; null means we never received one, which is an import
     * problem and a different sentence entirely.
     */
    let rosterCount: number | null = null
    if (roster) {
      const ids = rosterPlayerIds(roster.playerData)
      rosterCount = ids ? ids.length : 0
    }

    out.push({
      leagueId: t.leagueId,
      leagueName: leagueDisplayName(t.league?.name ?? null),
      avatarUrl: t.league?.avatarUrl ?? null,
      platform: String(t.league?.platform ?? 'manual').toLowerCase(),
      sport: String(t.league?.sport ?? 'NFL'),
      season: t.league?.season != null ? String(t.league.season) : null,
      team: t.teamName
        ? {
            name: t.teamName,
            record: recordOf({ wins: t.wins, losses: t.losses, ties: t.ties }),
            rank: t.currentRank ?? null,
            teamCount: teamCountBy.get(t.leagueId) ?? null,
          }
        : null,
      isCommissioner: Boolean(t.isCommissioner),
      rosterCount,
    })
    collapseKeys.push({
      platformLeagueId: t.league?.platformLeagueId ?? null,
      season: t.league?.season ?? null,
      importedByMe: t.league?.userId === userId,
    })
  }

  const deduped = collapseSameRealLeague(out, collapseKeys)

  /*
   * Commissioned leagues first — running a league carries obligations that being
   * in one does not, so those rows are the ones a person is accountable for.
   * Then alphabetical, which is stable across refreshes; sorting by "recent
   * activity" would reshuffle the list under the reader between visits.
   */
  deduped.sort((a, b) => {
    if (a.isCommissioner !== b.isCommissioner) return a.isCommissioner ? -1 : 1
    return a.leagueName.localeCompare(b.leagueName)
  })

  return {
    leagues: { available: true, data: deduped },
    commissionedCount: deduped.filter((l) => l.isCommissioner).length,
  }
}
