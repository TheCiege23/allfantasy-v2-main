import 'server-only'

/**
 * Weekly side contests (./sideContests.ts): the league's view — every member sees the winners and the
 * prize money; a commissioner also gets the switches. Read from the stored final scores each time.
 */
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import {
  CONTEST_KINDS,
  prizeTotals,
  readSideContests,
  weeklyResults,
  type ContestWinner,
  type NamedWinner,
  type SideContestsView,
} from './sideContests'

export type SideContestsReadResult = ({ ok: true } & SideContestsView) | { ok: false; status: 401 | 403 | 404 }

export async function readSideContestsView(leagueId: string, userId: string | null | undefined): Promise<SideContestsReadResult> {
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return { ok: false, status: membership.status as 401 | 403 | 404 }
  const role = await getLeagueRole(leagueId, userId!)
  const canEdit = role === 'commissioner' || role === 'co_commissioner'

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
  if (!league) return { ok: false, status: 404 }
  const config = readSideContests(league.settings)
  const empty = { ok: true as const, canEdit, config, season: null, weeks: [], totals: [] }
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return { ...empty, native: false }
  if (!CONTEST_KINDS.some((k) => config[k].enabled)) return { ...empty, native: true }

  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true, season: true } })
  if (!season) return { ...empty, native: true }
  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id },
    select: { id: true, week: true, type: true, status: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, isMedianMatchup: true },
  })
  const results = weeklyResults(matchups, config)
  const totals = prizeTotals(results)

  const rosterIds = [...new Set(matchups.flatMap((m) => [m.homeRosterId, m.awayRosterId].filter((id): id is string => Boolean(id))))]
  const rosters = rosterIds.length
    ? await prisma.redraftRoster.findMany({ where: { id: { in: rosterIds }, leagueId }, select: { id: true, teamName: true, ownerName: true } })
    : []
  const names = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'Team']))
  const nameOf = (id: string) => names.get(id) ?? 'Team'
  const named = (w: ContestWinner): NamedWinner => ({
    ...w,
    teamName: nameOf(w.rosterId),
    ...(w.opponentRosterId ? { opponentName: nameOf(w.opponentRosterId) } : {}),
  })

  return {
    ok: true,
    native: true,
    canEdit,
    config,
    season: season.season,
    weeks: [...results].reverse().map((w) => ({
      week: w.week,
      contests: Object.fromEntries(Object.entries(w.contests).map(([k, list]) => [k, list!.map(named)])),
    })),
    totals: totals.map((t) => ({ ...t, teamName: nameOf(t.rosterId) })),
  }
}
