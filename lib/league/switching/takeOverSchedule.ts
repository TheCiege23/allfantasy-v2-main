/**
 * Rule 3 of a switching league: once official, AllFantasy's scoring is official. Decided 2026-11-27: it
 * takes over AT "Make it official", mid-season, rather than next season.
 *
 * An imported league has no AllFantasy schedule. Its weekly scores live in `WeeklyMatchup` (keyed by the
 * platform's league id) and its records in `LeagueTeam`, both copied from the platform, and AllFantasy's
 * scoring engines skip it. So taking over starts here: copy the platform's regular-season schedule into
 * `RedraftMatchup`, with the weeks already played carried over as final at the platform's scores, so the
 * standings continue from where they were. From the current week on, AllFantasy scores every game.
 *
 * Called by "Make it official" (step 4) BEFORE the league is stamped official, and refuses rather than
 * guess when the platform's schedule cannot be copied as it is. Idempotent: a season that already has an
 * AllFantasy schedule is left alone.
 *
 * Playoff weeks are not copied. AllFantasy's playoff runtime builds the bracket from the standings, as it
 * does for a native league.
 */
import { prisma } from '@/lib/prisma'

export type ScheduleTakeoverResult =
  | { ok: true; alreadyTaken: boolean; matchupsCreated: number; weeksFinal: number }
  | { ok: false; reason: string }

type Pair = { week: number; home: { rosterId: string; points: number }; away: { rosterId: string; points: number } }

function sourceTeamIdOf(playerData: unknown): string {
  const r = playerData && typeof playerData === 'object' ? (playerData as Record<string, unknown>) : {}
  return String(r.source_team_id ?? '')
}

/**
 * The platform's weekly rows paired into games. Pure, so the pairing rules are tested on their own:
 * two rows sharing a week and matchup id are one game; a lone row is a bye and is skipped; anything else
 * (three teams on one matchup id, a league that plays several games a week) is refused.
 */
export function pairPlatformWeeks(
  rows: ReadonlyArray<{ week: number; rosterId: string; matchupId: number | null; game: number; pointsFor: number }>,
): { ok: true; pairs: Pair[] } | { ok: false; reason: string } {
  if (rows.some((r) => r.game > 1)) {
    return { ok: false, reason: 'This league plays several games a week, which AllFantasy cannot take over yet.' }
  }
  const groups = new Map<string, typeof rows[number][]>()
  for (const r of rows) {
    if (r.matchupId == null) continue
    const key = `${r.week}:${r.matchupId}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const pairs: Pair[] = []
  for (const [key, group] of groups) {
    if (group.length === 1) continue
    if (group.length > 2) return { ok: false, reason: `Week ${key.split(':')[0]} has a game with more than two teams.` }
    const [a, b] = [...group].sort((x, y) => x.rosterId.localeCompare(y.rosterId, 'en', { numeric: true }))
    pairs.push({ week: a.week, home: { rosterId: a.rosterId, points: a.pointsFor }, away: { rosterId: b.rosterId, points: b.pointsFor } })
  }
  pairs.sort((x, y) => x.week - y.week || x.home.rosterId.localeCompare(y.home.rosterId, 'en', { numeric: true }))
  return { ok: true, pairs }
}

/**
 * @param currentWeek the week being played now. Earlier weeks are copied as final; this week and later are
 *   scheduled, and AllFantasy scores them.
 */
export async function copyPlatformScheduleToAllFantasy(
  leagueId: string,
  opts: { currentWeek: number },
): Promise<ScheduleTakeoverResult> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platformLeagueId: true, season: true } })
  if (!league?.platformLeagueId) return { ok: false, reason: 'This league has no platform schedule to copy.' }
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId, ...(league.season ? { season: league.season } : {}) },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, playoffStartWeek: true },
  })
  if (!season) return { ok: false, reason: "This league's season is not set up on AllFantasy yet." }

  const existing = await prisma.redraftMatchup.count({ where: { seasonId: season.id } })
  if (existing > 0) return { ok: true, alreadyTaken: true, matchupsCreated: 0, weeksFinal: 0 }

  const rows = await prisma.weeklyMatchup.findMany({
    where: { leagueId: league.platformLeagueId, seasonYear: season.season, week: { lt: season.playoffStartWeek } },
    select: { week: true, rosterId: true, matchupId: true, game: true, pointsFor: true },
  })
  if (rows.length === 0) return { ok: false, reason: "The platform's schedule has not been copied in yet. Try again after the next sync." }
  const paired = pairPlatformWeeks(rows)
  if (!paired.ok) return paired

  const rosters = await prisma.roster.findMany({
    where: { leagueId, redraftRosterId: { not: null } },
    select: { redraftRosterId: true, playerData: true },
  })
  const redraftRosterOf = new Map(rosters.map((r) => [sourceTeamIdOf(r.playerData), r.redraftRosterId as string]))
  const unlinked = [...new Set(paired.pairs.flatMap((p) => [p.home.rosterId, p.away.rosterId]))].filter((id) => !redraftRosterOf.has(id))
  if (unlinked.length > 0) {
    return { ok: false, reason: `${unlinked.length} team${unlinked.length === 1 ? ' is' : 's are'} not linked to an AllFantasy team yet.` }
  }

  const finalWeeks = new Set<number>()
  const data = paired.pairs.map((p) => {
    const final = p.week < opts.currentWeek
    if (final) finalWeeks.add(p.week)
    return {
      seasonId: season.id,
      leagueId,
      week: p.week,
      homeRosterId: redraftRosterOf.get(p.home.rosterId) as string,
      awayRosterId: redraftRosterOf.get(p.away.rosterId) as string,
      homeScore: final ? p.home.points : 0,
      awayScore: final ? p.away.points : 0,
      status: final ? 'final' : 'scheduled',
    }
  })

  const wrote = await prisma.$transaction(async (tx) => {
    // Re-checked inside the transaction so two concurrent takeovers cannot both write a schedule.
    if ((await tx.redraftMatchup.count({ where: { seasonId: season.id } })) > 0) return false
    await tx.redraftMatchup.createMany({ data })
    await tx.redraftSeason.update({ where: { id: season.id }, data: { currentWeek: Math.max(1, opts.currentWeek) } })
    return true
  })
  if (!wrote) return { ok: true, alreadyTaken: true, matchupsCreated: 0, weeksFinal: 0 }
  return { ok: true, alreadyTaken: false, matchupsCreated: data.length, weeksFinal: finalWeeks.size }
}
