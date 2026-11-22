import { isRosterManagedBy, rosterManagerKey } from '@/lib/league/rosterManager'
import { resolveViewingRoster } from '@/lib/league/viewerTeams'
import 'server-only'

/**
 * "Auto-switch injured starters" (./autoSwitchInjured.ts): the commissioner's switch, the owner's way to
 * turn it off, and the hourly run that applies it.
 *
 * Leagues played on AllFantasy with weekly lineups only — the same set the bye bench serves, for the same
 * reasons (`autoBenchByeLeagueBlock`): AllFantasy cannot set a lineup on an imported league's provider.
 * A team that inactive manager mode or Chimmy autopilot runs is left to that run, which already benches
 * a player who is out.
 *
 * Every swap is a system save through the lineup engine on the owner's behalf, with the starters the
 * run read as the expected lineup (a manager who saves at the same moment wins), and an audit row. The
 * owner is told what moved, and is told when the commissioner switches it on.
 */
import { prisma } from '@/lib/prisma'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { logAction } from '@/server/services/auditService'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { getPlayerGameLockStateForAutoCoach } from '@/lib/autocoach/playerGameLock'
import type { LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import { readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { autoBenchByeLeagueBlock } from './autoBenchByeService'
import {
  AUTO_SWITCH_INJURED_KEY,
  autoSwitchInjuredFor,
  inSwitchWindow,
  parseAutoSwitchInput,
  planAutoSwitchInjured,
  statusMeetsLevel,
  withAutoSwitchInjured,
  type AutoSwitchInjuredSetting,
  type AutoSwitchLevel,
  type AutoSwitchTiming,
} from './autoSwitchInjured'

export const AUTO_SWITCH_ON_ACTION = 'auto_switch_injured.on'
export const AUTO_SWITCH_OFF_ACTION = 'auto_switch_injured.off'
export const AUTO_SWITCH_APPLIED_ACTION = 'auto_switch_injured.applied'
/** The team owner's plan this needs, at run time (owner decision 2026-11-18). */
export const AUTO_SWITCH_FEATURE = 'pro_autocoach' as const

const LEVEL_WORDS: Record<AutoSwitchLevel, string> = { out: 'is ruled out', doubtful: 'is doubtful or worse', questionable: 'is questionable or worse' }
const TIMING_WORDS: Record<AutoSwitchTiming, string> = { pregame_90: 'in the 90 minutes before his game', night_before: 'from 8pm Eastern the night before his game' }

export async function ownerHasAutoSwitchPlan(ownerUserId: string | null | undefined): Promise<boolean> {
  if (!ownerUserId) return false
  try {
    return Boolean((await new EntitlementResolver().resolveForUser(ownerUserId, AUTO_SWITCH_FEATURE)).hasAccess)
  } catch {
    return false
  }
}

const leagueSelect = { id: true, name: true, platform: true, sport: true, settings: true, leagueType: true, bestBallMode: true } as const

export type AutoSwitchTeamView = { rosterId: string; setting: AutoSwitchInjuredSetting | null; ownerHasPro: boolean }

/** Commissioner view: the switch for every team, and whether each owner's plan lets it run. */
export async function readAutoSwitchForLeague(leagueId: string): Promise<{ available: boolean; reason?: string; teams: AutoSwitchTeamView[] }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: leagueSelect })
  if (!league) return { available: false, reason: 'no_league', teams: [] }
  const block = autoBenchByeLeagueBlock(league)
  if (block) return { available: false, reason: block, teams: [] }
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, settings: true, platformUserId: true }, orderBy: { id: 'asc' } })
  const teams = await Promise.all(
    rosters.map(async (r) => ({
      rosterId: r.id,
      setting: autoSwitchInjuredFor(r.settings, r.platformUserId),
      ownerHasPro: await ownerHasAutoSwitchPlan(r.platformUserId),
    })),
  )
  return { available: true, teams }
}

/** The owner's view of their own team: is it on, and who switched it on. */
export async function readMyAutoSwitch(leagueId: string, userId: string, rosterId?: string | null): Promise<{ rosterId: string | null; setting: AutoSwitchInjuredSetting | null; ownerHasPro: boolean }> {
  // With several teams: the named one when it is theirs, else their first (lib/league/viewerTeams.ts).
  const viewing = await resolveViewingRoster(leagueId, userId, rosterId, { allowCoOwner: false })
  const roster = viewing
    ? await prisma.roster.findFirst({ where: { id: viewing.rosterId, leagueId }, select: { id: true, settings: true, platformUserId: true } })
    : null
  if (!roster) return { rosterId: null, setting: null, ownerHasPro: false }
  const setting = autoSwitchInjuredFor(roster.settings, roster.platformUserId)
  return { rosterId: roster.id, setting, ownerHasPro: setting ? await ownerHasAutoSwitchPlan(userId) : false }
}

export type AutoSwitchSetResult = { ok: true; setting: AutoSwitchInjuredSetting | null } | { ok: false; status: number; error: string }

/**
 * Set the switch for one team. A commissioner or co-commissioner may turn it on, change it, or turn it
 * off. The team's owner may only turn it off. Written under the roster row lock, so a concurrent change
 * to the team's other settings is not lost.
 */
export async function setAutoSwitchInjured(leagueId: string, actorUserId: string, rosterId: unknown, input: unknown): Promise<AutoSwitchSetResult> {
  if (typeof rosterId !== 'string' || !rosterId) return { ok: false, status: 400, error: 'Name a team.' }
  const parsed = parseAutoSwitchInput(input)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: leagueSelect })
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (autoBenchByeLeagueBlock(league)) return { ok: false, status: 409, error: 'AllFantasy can only switch lineups in leagues it runs with weekly lineups.' }
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true, platformUserId: true, managerUserId: true } })
  if (!roster) return { ok: false, status: 404, error: 'That team is not in this league.' }

  const commissioner = await isElevatedCommissioner(leagueId, actorUserId)
  const isOwner = isRosterManagedBy(roster, actorUserId)
  if (!commissioner && !(isOwner && !parsed.on)) {
    return { ok: false, status: 403, error: isOwner ? 'Only the commissioner can turn this on. You can turn it off.' : 'Commissioner only.' }
  }
  if (parsed.on && !roster.platformUserId) return { ok: false, status: 409, error: 'This team has no manager to run it for.' }

  const before = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM rosters WHERE id = ${rosterId} FOR UPDATE`
    const row = await tx.roster.findUnique({ where: { id: rosterId }, select: { settings: true, platformUserId: true } })
    const prior = autoSwitchInjuredFor(row?.settings, row?.platformUserId)
    const value: AutoSwitchInjuredSetting | null = parsed.on
      ? { on: true, level: parsed.level, timing: parsed.timing, byUserId: actorUserId, ownerUserId: row?.platformUserId ?? '', since: prior?.since ?? new Date().toISOString() }
      : null
    await tx.roster.update({ where: { id: rosterId }, data: { settings: withAutoSwitchInjured(row?.settings, value) as object } })
    return { prior, value }
  })

  const changed = JSON.stringify(before.prior && { ...before.prior, byUserId: '' }) !== JSON.stringify(before.value && { ...before.value, byUserId: '' })
  if (changed) {
    await logAction({
      leagueId,
      userId: actorUserId,
      actionType: parsed.on ? AUTO_SWITCH_ON_ACTION : AUTO_SWITCH_OFF_ACTION,
      entityType: 'roster',
      entityId: rosterId,
      metadata: { rosterId, level: parsed.level, timing: parsed.timing, byOwner: isOwner && !commissioner },
    }).catch(() => {})
  }
  // The manager is told when the commissioner switches it on or changes it (owner decision 2026-11-18).
  const managerId = rosterManagerKey(roster)
  if (changed && before.value && managerId && managerId !== actorUserId) {
    await dispatchNotification({
      userIds: [managerId],
      category: 'autocoach',
      type: 'auto_switch_injured_on',
      title: `Auto-switch injured starters is on · ${league.name ?? 'your league'}`,
      body: `Your commissioner turned it on for your team: a starter who ${LEVEL_WORDS[before.value.level]} is swapped for your best healthy bench player ${TIMING_WORDS[before.value.timing]}. You can turn it off on your Team tab.`,
      severity: 'low',
      leagueId,
      actionHref: `/league/${leagueId}?tab=team`,
      actionLabel: 'View team',
      dedupePrefix: `auto-switch-injured-on:${rosterId}:${before.value.level}:${before.value.timing}`,
      meta: { leagueId, rosterId },
    }).catch(() => {})
  }
  return { ok: true, setting: before.value }
}

export type AutoSwitchRunResult = {
  teams: number
  swapped: number
  unchanged: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

/** Hourly: for each team with the switch on, swap any injured starter who is inside his window. */
export async function runAutoSwitchInjured(opts?: { limit?: number; deadline?: number; now?: () => Date }): Promise<AutoSwitchRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 20_000
  const clock = opts?.now ?? (() => new Date())
  const result: AutoSwitchRunResult = { teams: 0, swapped: 0, unchanged: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  const teams = await prisma.$queryRaw<Array<{ id: string; leagueId: string }>>`
    SELECT id, "leagueId" FROM rosters
    WHERE settings -> ${AUTO_SWITCH_INJURED_KEY} ->> 'on' = 'true'
    ORDER BY "leagueId", id LIMIT ${Math.max(1, Math.min(opts?.limit ?? 200, 1000))}`

  const leagueCache = new Map<string, Awaited<ReturnType<typeof loadLeague>>>()
  for (const { id: rosterId, leagueId } of teams) {
    if (Date.now() >= deadline) break
    result.teams += 1
    try {
      if (!leagueCache.has(leagueId)) leagueCache.set(leagueId, await loadLeague(leagueId))
      const ctx = leagueCache.get(leagueId)
      if (!ctx || 'skip' in ctx) {
        skip((ctx && 'skip' in ctx ? ctx.skip : null) ?? 'no_league')
        continue
      }
      const { league, week, season, slots, managed } = ctx
      if (managed.has(rosterId)) {
        skip('managed_by_autopilot')
        continue
      }
      const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId } })
      const setting = autoSwitchInjuredFor(roster?.settings, roster?.platformUserId)
      if (!roster?.platformUserId || !setting) {
        skip('new_owner_or_off')
        continue
      }
      if (!(await ownerHasAutoSwitchPlan(roster.platformUserId))) {
        skip('owner_not_pro')
        continue
      }
      const now = clock()
      const lock = await resolveFullLineupLockContext({
        leagueId,
        rosterId,
        sport: String(league.sport ?? 'NFL'),
        leagueVariant: league.leagueVariant as string | null,
        settings: league.settings,
        leagueWeek: week,
        editingWeek: week,
        season,
        now,
        playerData: roster.playerData,
        lockAllMoves: league.lockAllMoves,
        lifecycleState: league.lifecycleState,
      })
      if (lock.locked) {
        skip('lineup_locked')
        continue
      }
      const rows = await getNormalizedPlayerData({ surface: 'roster', leagueId, userId: roster.platformUserId, limit: 200 })
      const players: Record<string, LineupPlayerInfo> = {}
      const facts: Record<string, { name: string; status: string | null; team: string | null }> = {}
      for (const p of rows.map(serializeUnifiedPlayerForApi)) {
        players[p.id] = { position: p.position, projectedPoints: p.projectedPoints }
        facts[p.id] = { name: p.name ?? p.id, status: p.injuryStatus ?? null, team: p.team ?? null }
      }
      const injured = (id: string) => statusMeetsLevel(facts[id]?.status, setting.level)

      // Kickoff per pro team, read once per team abbreviation. Unknown schedule ⇒ never due.
      const kickoffs = new Map<string, Date | null>()
      const kickoffFor = async (team: string | null): Promise<Date | null> => {
        const key = (team ?? '').toUpperCase()
        if (!key) return null
        if (!kickoffs.has(key)) {
          const g = await getPlayerGameLockStateForAutoCoach({ sport: String(league.sport ?? 'NFL'), teamAbbr: key, leagueSeason: season, leagueSettings: league.settings, nowUtc: now })
          kickoffs.set(key, g.scheduleKnown && !g.lockedBecauseGameStarted ? g.nextKickoffUtc : null)
        }
        return kickoffs.get(key) ?? null
      }
      const due = new Set<string>()
      for (const id of Object.keys(facts)) {
        if (!injured(id)) continue
        if (inSwitchWindow(await kickoffFor(facts[id]!.team), now, setting.timing)) due.add(id)
      }

      const locked = new Set(lock.lockedPlayerIds)
      const plan = planAutoSwitchInjured({ slots, playerData: roster.playerData, players, isLocked: (id) => locked.has(id), injured, due: (id) => due.has(id) })
      if (plan.kind === 'skip') {
        if (plan.reason === 'already_best' || plan.reason === 'no_injured_starters') result.unchanged += 1
        else skip(plan.reason)
        continue
      }
      const pd = roster.playerData && typeof roster.playerData === 'object' ? (roster.playerData as Record<string, unknown>) : {}
      const said = plan.changes.map((c) => {
        const out = c.out ? `${facts[c.out]?.name ?? c.out} (${facts[c.out]?.status ?? 'injured'})` : 'empty'
        return `${out} → ${facts[c.in]?.name ?? c.in} at ${c.slot}`
      })
      const auditId = `auto-switch-injured:${JSON.stringify([leagueId, rosterId, season, week, plan.changes.map((c) => c.in)])}`
      const saved = await persistRosterLineupWithEngine({
        leagueId,
        rosterId,
        actorUserId: roster.platformUserId,
        expectedOwnerUserId: roster.platformUserId,
        season,
        week,
        source: 'system',
        nextPlayerData: plan.nextPlayerData,
        ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
        automationAudit: {
          id: auditId,
          action: AUTO_SWITCH_APPLIED_ACTION,
          message: `Auto-switched an injured starter (commissioner setting, ${setting.level} or worse): ${said.join('; ')}.`,
          metadata: { season, week, level: setting.level, timing: setting.timing, changes: plan.changes },
        },
      })
      if (!saved.ok) {
        skip(`save_refused:${saved.status ?? 'error'}`)
        continue
      }
      result.swapped += 1
      await dispatchNotification({
        userIds: [roster.platformUserId],
        category: 'autocoach',
        type: 'auto_switch_injured',
        title: `Injured starter switched · ${league.name ?? 'your league'}`,
        body: said.join('; '),
        severity: 'medium',
        leagueId,
        actionHref: `/league/${leagueId}?tab=team`,
        actionLabel: 'View lineup',
        dedupePrefix: auditId,
        meta: { leagueId, rosterId, week },
      }).catch(() => {})
    } catch (e) {
      result.failures.push({ leagueId, rosterId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

async function loadLeague(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return null
  const block = autoBenchByeLeagueBlock(league)
  if (block) return { skip: block }
  const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
  if (!['active', 'in_season'].includes(status)) return { skip: 'not_in_season' }
  if (league.lockAllMoves) return { skip: 'moves_locked' }
  const week = leagueWeekFromSettings(league.settings)
  if (week == null || !league.season) return { skip: 'no_week' }
  const sport = String(league.sport ?? 'NFL')
  const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
  return {
    league,
    week,
    season: league.season,
    slots: resolveLineupStarterSlots(league as never, template),
    managed: new Set(Object.keys(readManagedLineups(league.settings))),
  }
}
