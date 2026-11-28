/**
 * A manager switches their own team in a switching league to AllFantasy.
 *
 * Any time (decided 2026-11-26): before the league is official the switch is practice only, and the old
 * platform's next copy still overwrites the team; once the league is official, AllFantasy runs the team from the
 * moment it switches (lineups, waivers, trades with other switched teams), and the copy leaves it alone.
 *
 * Idempotent: the first switch stands. A team switches for good; there is no switching back.
 */
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { resolveActingRoster } from '@/lib/league/viewerTeams'
import { hasTeamSwitched, isOfficialOnAllFantasy, withTeamSwitched } from './switchingLeague'

export type SwitchTeamResult =
  | { ok: true; alreadySwitched: boolean; leagueOfficial: boolean; teamName: string }
  | { ok: false; status: number; reason: string }

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export async function switchTeamToAllFantasy(args: {
  leagueId: string
  userId: string
  /** The team the request names, when the manager holds several. */
  rosterId?: string | null
  now?: Date
}): Promise<SwitchTeamResult> {
  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { platform: true, settings: true } })
  if (!league) return { ok: false, status: 404, reason: 'League not found.' }
  if (isNativePlatform(league.platform)) return { ok: false, status: 409, reason: 'This league already runs on AllFantasy.' }

  const acting = await resolveActingRoster(args.leagueId, args.userId, args.rosterId ?? null, { allowCoOwner: false })
  if (!acting.ok) return { ok: false, status: acting.status, reason: acting.message }
  const roster = await prisma.roster.findFirst({ where: { id: acting.rosterId, leagueId: args.leagueId }, select: { playerData: true } })
  const externalId = String(record(roster?.playerData).source_team_id ?? '')
  const team = externalId
    ? await prisma.leagueTeam.findFirst({ where: { leagueId: args.leagueId, externalId }, select: { id: true, teamName: true } })
    : null
  if (!team) return { ok: false, status: 404, reason: "We can't find your team in this league yet. Try again after the next sync." }
  const teamName = team.teamName?.trim() || 'Your team'

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.league.findUnique({ where: { id: args.leagueId }, select: { settings: true } })
    const leagueOfficial = isOfficialOnAllFantasy(fresh?.settings)
    if (hasTeamSwitched(fresh?.settings, team.id)) return { ok: true as const, alreadySwitched: true, leagueOfficial, teamName }
    const state = withTeamSwitched(fresh?.settings, team.id, { at: (args.now ?? new Date()).toISOString(), byUserId: args.userId })
    await tx.league.update({ where: { id: args.leagueId }, data: { settings: { ...record(fresh?.settings), switching: state } as never } })
    return { ok: true as const, alreadySwitched: false, leagueOfficial, teamName }
  })
}
