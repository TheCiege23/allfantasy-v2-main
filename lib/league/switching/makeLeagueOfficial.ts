/**
 * "Make it official" for a switching league: the head commissioner makes AllFantasy the official league
 * MID-SEASON. From here AllFantasy scores every game (rule 3), keeps every record, and settles waivers and
 * trades for the teams that switched; the teams that have not switched keep copying in from the old platform.
 *
 * IN SEASON ONLY (owner, 2026-11-27). In the offseason the in-place "Switch to AllFantasy"
 * (lib/league/convertImportedLeagueInPlace.ts) is the way, and it also finishes a switching league for good.
 * One of the two is offered at a time.
 *
 * What it does, in order:
 *   1. Refuses, writing nothing, when the league is not an import in season, or when AllFantasy has no scoring
 *      for it (a mid-season switch must not quietly change how the season is scored).
 *   2. Saves the platform's roster layout when the commissioner has not saved one here, and the waiver and draft
 *      settings rows, the same way the in-place switch does. Harmless on a league that stays imported.
 *   3. Copies the rest of the platform's regular-season schedule into AllFantasy's, weeks already played as final
 *      (takeOverSchedule.ts). This must happen before the stamp: an official league's screens read that schedule.
 *   4. One transaction: the scoring the league plays by (the platform's NFL rules converted, unless a commissioner
 *      saved their own here), the `switching.official` stamp, the commissioner's own team(s) switched, and the
 *      league's invite link when it has none.
 *
 * Running it again on an official league changes nothing and returns the invite link.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { listHeldTeams } from '@/lib/league/viewerTeams'
import { importedNflScoring } from '@/lib/league-creation/canonical/importedNflScoring'
import { importedNflSettings } from '@/lib/league-creation/canonical/importedScoringSettings'
import { inviteMaxUsesFor } from '@/lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { planImportedRosterLayout, savedInAllFantasy, sportScoringStore } from '@/lib/league/nativeScaffolding'
import { writeLeagueRosterConfig } from '@/lib/roster-engine/UnifiedRosterConfigService'
import { bootstrapLeagueWaiverSettings } from '@/lib/waiver-defaults/LeagueWaiverBootstrapService'
import { ensureLeagueSettingsRow } from '@/lib/draft-defaults/ensureLeagueSettingsRow'
import { sourcePlatformLabel } from '@/lib/league/write-authority'
import { copyPlatformScheduleToAllFantasy } from './takeOverSchedule'
import { isOfficialOnAllFantasy, withOfficial, withTeamSwitched, type SwitchStamp } from './switchingLeague'

export type MakeOfficialResult =
  | {
      ok: true
      alreadyOfficial: boolean
      invitePath: string | null
      /** How the league is scored from now on. */
      scoring: 'converted' | 'kept_af'
      matchupsCreated: number
      weeksFinal: number
      switchedTeams: number
    }
  | { ok: false; reason: string }

const IN_SEASON = new Set(['in_season', 'playoffs'])

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** True while a league's season is being played: the phase "Make it official" is offered in. */
export function isSeasonInProgress(league: { status?: string | null; lifecycleState?: string | null }): boolean {
  const status = String(league.status ?? '').toLowerCase()
  const lifecycle = String(league.lifecycleState ?? '').toLowerCase()
  return status !== 'complete' && (IN_SEASON.has(status) || IN_SEASON.has(lifecycle))
}

/**
 * The scoring the league plays by once official, or why there is none. A store a commissioner saved here wins;
 * otherwise NFL converts the platform's rules. Any other sport needs its scoring saved in AllFantasy first:
 * falling to AllFantasy's defaults mid-season would re-score the rest of the season by different rules.
 */
export function planOfficialScoring(
  league: { sport: string; settings: unknown },
  userId: string,
): { ok: true; scoring: 'converted' | 'kept_af'; patch: Record<string, unknown> } | { ok: false; reason: string } {
  const settings = record(league.settings)
  const sport = String(league.sport).toUpperCase()
  if (savedInAllFantasy(sportScoringStore(settings, sport))) return { ok: true, scoring: 'kept_af', patch: {} }
  if (sport === 'NFL') {
    const nfl = importedNflScoring(settings)
    if (nfl) return { ok: true, scoring: 'converted', patch: importedNflSettings(settings, nfl, userId) }
    return { ok: false, reason: "We can't read this league's scoring rules. Save your scoring in League settings first, then try again." }
  }
  return { ok: false, reason: 'Save your scoring in League settings first, so the rest of the season is scored the way your league expects.' }
}

export async function makeLeagueOfficial(
  args: { leagueId: string; userId: string; now?: Date },
  db: PrismaClient = defaultPrisma,
): Promise<MakeOfficialResult> {
  const { leagueId, userId } = args
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, platform: true, platformLeagueId: true, status: true, lifecycleState: true, settings: true, leagueType: true, taxiSlots: true, irSlots: true },
  })
  if (!league) return { ok: false, reason: 'League not found.' }
  if (isNativePlatform(league.platform)) return { ok: false, reason: 'This league already runs on AllFantasy.' }

  const existingInvite = () => db.leagueInvite.findFirst({ where: { leagueId, isActive: true }, select: { token: true } })
  if (isOfficialOnAllFantasy(league.settings)) {
    const invite = await existingInvite()
    return { ok: true, alreadyOfficial: true, invitePath: invite ? `/join/${invite.token}` : null, scoring: 'kept_af', matchupsCreated: 0, weeksFinal: 0, switchedTeams: 0 }
  }
  if (!isSeasonInProgress(league)) {
    return { ok: false, reason: 'The season is not being played right now. Use Switch to AllFantasy instead.' }
  }

  const scoring = planOfficialScoring({ sport: String(league.sport), settings: league.settings }, userId)
  if (!scoring.ok) return scoring

  // The commissioner's own team(s) switch with the league.
  const held = await listHeldTeams(leagueId, userId)
  const heldRosters = held.length
    ? await db.roster.findMany({ where: { id: { in: held.map((t) => t.rosterId) }, leagueId }, select: { playerData: true } })
    : []
  const externalIds = heldRosters.map((r) => String(record(r.playerData).source_team_id ?? '')).filter(Boolean)
  const teams = externalIds.length
    ? await db.leagueTeam.findMany({ where: { leagueId, externalId: { in: externalIds } }, select: { id: true } })
    : []
  if (teams.length === 0) {
    const where = sourcePlatformLabel(league.platform) ?? 'the other platform'
    return { ok: false, reason: `Claim your own team first. Your team is the first to switch, and we can't find it in this league on ${where}.` }
  }

  const current = league.platformLeagueId ? await resolveCurrentWeekForLeague(league.platformLeagueId).catch(() => null) : null
  if (!current?.week) return { ok: false, reason: "We can't tell which week your league is in yet. Try again after the next sync." }

  // Settings rows the engines read, written the way the in-place switch writes them.
  const layout = planImportedRosterLayout({ sport: String(league.sport), platform: String(league.platform), leagueType: league.leagueType, settings: league.settings, taxiSlots: league.taxiSlots, irSlots: league.irSlots })
  if (layout.kind === 'unreadable') return { ok: false, reason: `We can't read this league's roster spots. ${layout.reason}` }
  if (layout.kind === 'mapped') {
    await writeLeagueRosterConfig(leagueId, { templateKey: 'custom', slots: layout.slots }, { userId, auditAction: 'import' })
  }
  await bootstrapLeagueWaiverSettings(leagueId)
  await ensureLeagueSettingsRow(leagueId)

  const schedule = await copyPlatformScheduleToAllFantasy(leagueId, { currentWeek: current.week })
  if (!schedule.ok) return schedule

  const stamp: SwitchStamp = { at: (args.now ?? new Date()).toISOString(), byUserId: userId }
  const { invitePath, switchedTeams } = await db.$transaction(async (tx) => {
    // Re-read inside the transaction: the roster writer and a sync may both have touched `settings` since.
    const fresh = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    let state = withOfficial(fresh?.settings, stamp)
    for (const team of teams) state = withTeamSwitched({ ...record(fresh?.settings), switching: state }, team.id, stamp)
    await tx.league.update({ where: { id: leagueId }, data: { settings: { ...record(fresh?.settings), ...scoring.patch, switching: state } as never } })

    const active = await tx.leagueInvite.findFirst({ where: { leagueId, isActive: true }, select: { token: true } })
    const switchedTeams = Object.keys(state.teams).length
    if (active) return { invitePath: `/join/${active.token}`, switchedTeams }
    const seats = await tx.leagueTeam.count({ where: { leagueId } })
    const invite = await tx.leagueInvite.create({
      data: { leagueId, createdBy: userId, createdByRole: 'commissioner', maxUses: inviteMaxUsesFor(seats) },
      select: { token: true },
    })
    return { invitePath: `/join/${invite.token}`, switchedTeams }
  })

  return {
    ok: true,
    alreadyOfficial: false,
    invitePath,
    scoring: scoring.scoring,
    matchupsCreated: schedule.matchupsCreated,
    weeksFinal: schedule.weeksFinal,
    switchedTeams,
  }
}
