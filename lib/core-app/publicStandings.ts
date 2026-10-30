import 'server-only'

import { prisma } from '@/lib/prisma'
import { leagueDisplayName } from './leagueHome'
import { isScored, resolveCurrentWeekFrom } from './currentWeek'
import { leagueHasMedianGame, medianGameRecords } from './medianGame'
import { readPlayoffFormat } from './outlookFormat'

/**
 * Public league standings — the one indexable surface in the 38a suite.
 *
 * ⚠ EVERY OTHER SCREEN IN THIS SUITE IS `noindex`. This is the exception, and
 * it exists because a standings table is the one thing about a league that is
 * genuinely worth a public URL: a league-mates' link, a share into a group
 * chat, a bookmark that does not require signing in.
 *
 * ── Opt-in, and it is not a formality ────────────────────────────────────
 *
 * `/league/*` is auth-gated and always has been. A league's name and its team
 * names are USER-AUTHORED and frequently personal — inside jokes, real names,
 * things nobody wrote expecting an audience outside twelve people. Publishing
 * them by default would not be an SEO win, it would be publishing private
 * writing without asking.
 *
 * So the default is private and there is no code path that publishes without an
 * explicit `settings.publicStandings === true`, set by a commissioner through
 * the existing commissioner-gated PATCH. No new column, no migration, no new
 * API route: `executeLeagueSettingsPatch` already shallow-merges into
 * `League.settings` behind `requireCommissionerRole`.
 *
 * ⚠ A LEAGUE THAT HAS NOT OPTED IN RETURNS null, AND THE PAGE RENDERS 404 —
 * NOT 403. A 403 confirms that a league with that id exists, which is itself a
 * disclosure to anyone enumerating ids. "Not found" is the only answer that
 * leaks nothing.
 *
 * ⚠ AND IT PUBLISHES TEAM NAMES, NOT PEOPLE. `ownerName` is deliberately not
 * read here. It is often a real name, and a commissioner opting a league in is
 * agreeing to publish the standings — not to publish their members' identities.
 */

export type PublicStandingRow = {
  rank: number
  /** Team name only. Never the owner's name. */
  name: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  average: number | null
}

export type PublicStandingsData = {
  leagueName: string
  season: number
  week: number
  seasonComplete: boolean
  teams: PublicStandingRow[]
  /** Weeks with at least one scored row — zero never publishes. */
  scoredWeeks: number
  updatedAt: Date | null
}

function isOptedIn(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  return (settings as Record<string, unknown>).publicStandings === true
}

/**
 * Null for every reason a page should 404: no league, not opted in, no platform
 * id, nothing scored. The caller cannot tell these apart, which is the point —
 * distinguishing them in the response would leak which leagues exist.
 */
export async function getPublicLeagueStandings(
  leagueId: string,
): Promise<PublicStandingsData | null> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: {
        name: true,
        settings: true,
        platformLeagueId: true,
        lastSyncedAt: true,
      },
    })
    .catch(() => null)

  if (!league || !isOptedIn(league.settings) || !league.platformLeagueId) return null

  const [rows, teams] = await Promise.all([
    prisma.weeklyMatchup
      .findMany({
        where: { leagueId: league.platformLeagueId },
        select: {
          seasonYear: true,
          week: true,
          rosterId: true,
          pointsFor: true,
          pointsAgainst: true,
          matchupId: true,
        },
      })
      .catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        // ⚠ `ownerName` is NOT selected. See the header — publishing standings
        // is not consent to publish who the managers are.
        // The platform's own record is read only to tell a median-game league (see medianGame.ts).
        select: { externalId: true, teamName: true, wins: true, losses: true, ties: true },
      })
      .catch(() => []),
  ])

  if (rows.length === 0) return null

  const resolved = resolveCurrentWeekFrom(rows)

  /*
   * The same refusal the signed-in board makes, and it matters more here: an
   * unplayed season publishes twelve teams tied on zero to the open web, where
   * it would also be what a search engine indexes and caches.
   */
  if (!resolved || resolved.scoredWeeks === 0) return null

  const seasonRows = rows.filter((r) => r.seasonYear === resolved.season && isScored(r))

  const nameByRoster = new Map<string, string>()
  for (const t of teams) {
    const label = t.teamName?.trim()
    if (t.externalId && label) nameByRoster.set(t.externalId, label)
  }

  const totals = new Map<string, { pf: number; games: number; wins: number; losses: number; ties: number }>()
  const totalOf = (rosterId: string) => {
    const acc = totals.get(rosterId) ?? { pf: 0, games: 0, wins: 0, losses: 0, ties: 0 }
    totals.set(rosterId, acc)
    return acc
  }
  for (const r of seasonRows) {
    const acc = totalOf(r.rosterId)
    acc.pf += r.pointsFor
    acc.games += 1
  }

  /*
   * 🛑 RESULTS COME FROM PAIRED SCORES, NEVER FROM `WeeklyMatchup.win` — the signed-in board's rule
   * (standingsModel.ts). The writer stores a tie as `win = 0` for both sides, which this table used to
   * publish as two losses, and stored `win = 1` for any unpaired roster that scored, which published a
   * league with no head-to-head pairing as every team 1-0. A matchup that is not exactly two rows has
   * no result.
   */
  const pairs = new Map<string, typeof seasonRows>()
  for (const r of seasonRows) {
    if (r.matchupId == null) continue
    const key = `${r.week}|${r.matchupId}`
    const pair = pairs.get(key)
    if (pair) pair.push(r)
    else pairs.set(key, [r])
  }
  for (const pair of pairs.values()) {
    if (pair.length !== 2) continue
    const [a, b] = pair
    if (a.pointsFor === b.pointsFor) {
      totalOf(a.rosterId).ties += 1
      totalOf(b.rosterId).ties += 1
      continue
    }
    const [win, loss] = a.pointsFor > b.pointsFor ? [a, b] : [b, a]
    totalOf(win.rosterId).wins += 1
    totalOf(loss.rosterId).losses += 1
  }

  /* Sleeper's median game is in the platform's record, so it is in this one (see medianGame.ts). */
  const reportedGames = teams.reduce(
    (max, t) => Math.max(max, (Number(t.wins) || 0) + (Number(t.losses) || 0) + (Number(t.ties) || 0)),
    0,
  )
  // Regular season only: the median game is not a playoff game.
  const regularEnd = readPlayoffFormat(league.settings, totals.size, null).regularSeasonEndWeek
  const regularRows = seasonRows.filter((r) => regularEnd == null || r.week <= regularEnd)
  const weeksDone = new Set(regularRows.map((r) => r.week)).size
  if (leagueHasMedianGame(league.settings, reportedGames > 0 ? { maxGames: reportedGames, weeksDone } : null)) {
    for (const [rosterId, rec] of medianGameRecords(regularRows)) {
      const acc = totalOf(rosterId)
      acc.wins += rec.wins
      acc.losses += rec.losses
      acc.ties += rec.ties
    }
  }

  const ordered = [...totals.entries()].sort((a, b) => b[1].pf - a[1].pf)

  const teamRows: PublicStandingRow[] = ordered.map(([rosterId, t], i) => ({
    rank: i + 1,
    /*
     * A roster with no ingested team name publishes as "Team 4", never as an
     * empty cell and never as the owner. The number is real information — it is
     * that roster's slot — and an unnamed team is a gap in what the platform
     * published, not something to invent around.
     */
    name: nameByRoster.get(rosterId) ?? `Team ${rosterId}`,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: t.pf,
    average: t.games > 0 ? t.pf / t.games : null,
  }))

  return {
    leagueName: leagueDisplayName(league.name),
    season: resolved.season,
    week: resolved.week,
    seasonComplete: resolved.seasonComplete,
    teams: teamRows,
    scoredWeeks: resolved.scoredWeeks,
    updatedAt: league.lastSyncedAt ?? null,
  }
}
