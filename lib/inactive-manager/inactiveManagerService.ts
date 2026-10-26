import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { logAction } from '@/server/services/auditService'
import { getLeagueManagerHealth } from '@/lib/commissioner-hub/managerHealth'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import {
  AF_MANAGED_LINEUPS_KEY,
  autopilotRosterIds,
  DEFAULT_AUTOPILOT_STYLE,
  isAutopilotStyle,
  planBestLineup,
  readManagedLineups,
  suggestInactiveTeams,
  type ManagedLineup,
  type ManagedLineups,
} from './inactiveManagerMode'

/**
 * Inactive manager mode (./inactiveManagerMode.ts): the commissioner's view and switch, the owner's
 * return, and the hourly run that sets each managed team's best lineup.
 */

export const ON_ACTION = 'inactive_manager_mode.on'
export const OFF_ACTION = 'inactive_manager_mode.off'
export const ENDED_ACTION = 'inactive_manager_mode.ended'
export const AUTOPILOT_ON_ACTION = 'chimmy_autopilot.on'
export const AUTOPILOT_OFF_ACTION = 'chimmy_autopilot.off'
export const AUTOPILOT_FEATURE = 'commissioner_chimmy_autopilot' as const

/** Chimmy autopilot is on the AF Commissioner plan — the LEAGUE OWNER's, as with the other commissioner tools. */
export async function autopilotEntitled(leagueOwnerUserId: string | null | undefined): Promise<boolean> {
  if (!leagueOwnerUserId) return false
  try {
    return Boolean((await new EntitlementResolver().resolveForUser(leagueOwnerUserId, AUTOPILOT_FEATURE)).hasAccess)
  } catch {
    return false
  }
}

const settingsObject = (s: unknown) => (s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, unknown>) : {})

/** Rewrite the managed map under the league row lock, so two switches and an owner's return cannot interleave. */
async function updateManaged(leagueId: string, change: (current: ManagedLineups) => ManagedLineups | null): Promise<ManagedLineups | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return null
    const settings = settingsObject(league.settings)
    const next = change(readManagedLineups(settings))
    if (!next) return null
    const written = { ...settings }
    if (Object.keys(next).length) written[AF_MANAGED_LINEUPS_KEY] = next
    else delete written[AF_MANAGED_LINEUPS_KEY]
    await tx.league.update({ where: { id: leagueId }, data: { settings: written as Prisma.InputJsonValue } })
    return next
  })
}

export type InactiveManagerTeam = {
  rosterId: string
  teamName: string | null
  managerName: string | null
  status: 'active' | 'at_risk' | 'inactive' | 'unknown'
  lastActionAt: string | null
  managed: ManagedLineup | null
  suggested: boolean
}

export async function readInactiveManagerView(
  leagueId: string,
): Promise<{ native: boolean; autopilotEntitled: boolean; teams: InactiveManagerTeam[] }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true, userId: true } })
  if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') return { native: false, autopilotEntitled: false, teams: [] }
  const managed = readManagedLineups(league.settings)
  const health = await getLeagueManagerHealth(leagueId)
  const suggested = new Set(suggestInactiveTeams(health.rows, managed))
  return {
    native: true,
    autopilotEntitled: await autopilotEntitled(league.userId),
    teams: health.rows.map((r) => ({
      rosterId: r.rosterId,
      teamName: r.teamName,
      managerName: r.managerName,
      status: r.status,
      lastActionAt: r.lastActionAt,
      managed: managed[r.rosterId] ?? null,
      suggested: suggested.has(r.rosterId),
    })),
  }
}

export type SwitchResult = { ok: true; managed: boolean } | { ok: false; status: number; error: string }

/** Commissioner or co-commissioner: start or stop AllFantasy setting one team's lineup. */
export async function setInactiveManagerMode(leagueId: string, userId: string, rosterId: unknown, on: unknown): Promise<SwitchResult> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403, error: 'Forbidden' }
  if (typeof rosterId !== 'string' || !rosterId || typeof on !== 'boolean') return { ok: false, status: 400, error: 'Name a team and whether to turn it on.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return { ok: false, status: 409, error: 'AllFantasy can only set lineups in leagues it runs.' }
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true } })
  if (!roster) return { ok: false, status: 404, error: 'That team is not in this league.' }

  let changed = false
  await updateManaged(leagueId, (current) => {
    if (Boolean(current[rosterId]) === on) return null
    changed = true
    const next = { ...current }
    if (on) next[rosterId] = { since: new Date().toISOString(), byUserId: userId }
    else delete next[rosterId]
    return next
  })
  if (changed) {
    await logAction({ leagueId, userId, actionType: on ? ON_ACTION : OFF_ACTION, entityType: 'roster', entityId: rosterId, metadata: { rosterId } })
  }
  return { ok: true, managed: on }
}

/**
 * Commissioner or co-commissioner, on the league owner's AF Commissioner plan: hand a team to Chimmy
 * autopilot in a style, change the style, or (`style: null`) take autopilot off. Turning it on also
 * turns on inactive manager mode for the team; turning it off leaves lineup management running, which
 * is free and is switched off on its own.
 */
export async function setChimmyAutopilot(leagueId: string, userId: string, rosterId: unknown, style: unknown): Promise<SwitchResult & { style?: string | null }> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403, error: 'Forbidden' }
  if (typeof rosterId !== 'string' || !rosterId) return { ok: false, status: 400, error: 'Name a team.' }
  const nextStyle = style === null ? null : isAutopilotStyle(style) ? style : style === undefined ? DEFAULT_AUTOPILOT_STYLE : undefined
  if (nextStyle === undefined) return { ok: false, status: 400, error: 'Choose a style: dynasty_owner, win_now or rebuild.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, userId: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return { ok: false, status: 409, error: 'Chimmy can only run teams in leagues AllFantasy runs.' }
  if (nextStyle !== null && !(await autopilotEntitled(league.userId))) {
    return { ok: false, status: 402, error: 'Chimmy autopilot is part of the AF Commissioner plan.' }
  }
  const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId }, select: { id: true } })
  if (!roster) return { ok: false, status: 404, error: 'That team is not in this league.' }

  let changed = false
  const now = new Date().toISOString()
  await updateManaged(leagueId, (current) => {
    const entry = current[rosterId]
    if (nextStyle === null) {
      if (!entry?.autopilot) return null
      changed = true
      const { autopilot: _off, ...rest } = entry
      return { ...current, [rosterId]: rest }
    }
    if (entry?.autopilot?.style === nextStyle) return null
    changed = true
    const base = entry ?? { since: now, byUserId: userId }
    return { ...current, [rosterId]: { ...base, autopilot: { style: nextStyle, since: entry?.autopilot?.since ?? now, byUserId: userId } } }
  })
  if (changed) {
    await logAction({
      leagueId,
      userId,
      actionType: nextStyle === null ? AUTOPILOT_OFF_ACTION : AUTOPILOT_ON_ACTION,
      entityType: 'roster',
      entityId: rosterId,
      metadata: { rosterId, style: nextStyle },
    })
  }
  return { ok: true, managed: true, style: nextStyle }
}

/**
 * Whether the team owned by `ownerId` in this league is on Chimmy autopilot. Trade offers to it are
 * refused: nobody is there to weigh them, and an unattended team is exactly the one a lopsided offer
 * would target. Redraft rosters carry the owner's id; the managed map is keyed by `Roster.id`, so the
 * owner is the join (an abandoned team's owner is its `orphan-…` seat id).
 */
export async function isOwnerOnAutopilot(leagueId: string, ownerId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const ids = autopilotRosterIds(readManagedLineups(league?.settings))
  if (ids.length === 0) return false
  const hit = await prisma.roster.findFirst({ where: { leagueId, id: { in: ids }, platformUserId: ownerId }, select: { id: true } })
  return Boolean(hit)
}

/**
 * The owner saved a lineup of their own: they are back, and AllFantasy stops. Called after an OWNER's
 * save only (`source: 'user_save'` by the roster's owner) — never after AllFantasy's own system save or a
 * commissioner override. Best-effort: a failure here must not fail the owner's save.
 */
export async function endInactiveManagerModeOnOwnerSave(leagueId: string, rosterId: string, ownerUserId: string): Promise<boolean> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!readManagedLineups(league?.settings)[rosterId]) return false
  let ended = false
  await updateManaged(leagueId, (current) => {
    if (!current[rosterId]) return null
    ended = true
    const next = { ...current }
    delete next[rosterId]
    return next
  })
  if (ended) {
    await logAction({
      leagueId,
      userId: ownerUserId,
      actionType: ENDED_ACTION,
      entityType: 'roster',
      entityId: rosterId,
      metadata: { rosterId, reason: 'owner_saved_lineup' },
    })
  }
  return ended
}

export type InactiveLineupRunResult = {
  leagues: number
  teams: number
  set: number
  unchanged: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

const DEFAULT_LEAGUE_LIMIT = 20

/**
 * Hourly: set each managed team's projected-best lineup among players whose games have not started.
 * Repeating through the week keeps it current as injuries and projections move; a run that finds the
 * lineup already best writes nothing.
 */
export async function runInactiveManagerLineups(opts?: { limit?: number; deadline?: number }): Promise<InactiveLineupRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: InactiveLineupRunResult = { leagues: 0, teams: 0, set: 0, unchanged: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings ? ${AF_MANAGED_LINEUPS_KEY} AND settings -> ${AF_MANAGED_LINEUPS_KEY} <> '{}'::jsonb
    ORDER BY id LIMIT ${Math.max(1, Math.min(opts?.limit ?? DEFAULT_LEAGUE_LIMIT, 100))}`

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId } })
      if (!league) continue
      const managed = Object.keys(readManagedLineups(league.settings))
      const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
      const week = leagueWeekFromSettings(league.settings)
      const season = league.season
      const reason =
        resolveWriteAuthority(league.platform) !== 'NATIVE'
          ? 'not_native'
          : league.bestBallMode || automaticLineup(league.leagueType, league.settings)
            ? 'automatic_lineups'
            : !['active', 'in_season'].includes(status)
              ? 'not_in_season'
              : league.lockAllMoves
                ? 'moves_locked'
                : week == null || !season
                  ? 'no_week'
                  : null
      if (reason) {
        for (const _ of managed) skip(reason)
        continue
      }
      const sport = String(league.sport ?? 'NFL')
      const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
      const slots = resolveLineupStarterSlots(league as never, template)

      for (const rosterId of managed) {
        if (Date.now() >= deadline) break
        result.teams += 1
        try {
          const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId } })
          if (!roster?.platformUserId) {
            skip('no_roster')
            continue
          }
          const lock = await resolveFullLineupLockContext({
            leagueId,
            rosterId,
            sport,
            leagueVariant: league.leagueVariant as string | null,
            settings: league.settings,
            leagueWeek: week!,
            editingWeek: week!,
            season: season!,
            now: new Date(),
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
          for (const p of rows.map(serializeUnifiedPlayerForApi)) players[p.id] = { position: p.position, projectedPoints: p.projectedPoints }
          const locked = new Set(lock.lockedPlayerIds)
          const plan = planBestLineup({ slots, playerData: roster.playerData, players, isLocked: (id) => locked.has(id) })
          if (plan.kind === 'skip') {
            if (plan.reason === 'already_best') result.unchanged += 1
            else skip(plan.reason)
            continue
          }
          const pd = settingsObject(roster.playerData)
          const saved = await persistRosterLineupWithEngine({
            leagueId,
            rosterId,
            actorUserId: roster.platformUserId,
            expectedOwnerUserId: roster.platformUserId,
            season: season!,
            week: week!,
            source: 'system',
            nextPlayerData: plan.nextPlayerData,
            ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
            automationAudit: {
              id: `inactive-manager-lineup:${JSON.stringify([leagueId, rosterId, season, week, Date.now()])}`,
              action: 'inactive_manager.lineup_set',
              message: `AllFantasy set the best lineup while the manager is away: ${plan.changes.map((c) => `${c.slot} ${c.out ?? 'empty'} → ${c.in}`).join('; ')}.`,
              metadata: { season, week, changes: plan.changes },
            },
          })
          if (saved.ok) result.set += 1
          else skip(`save_refused:${saved.status ?? 'error'}`)
        } catch (e) {
          result.failures.push({ leagueId, rosterId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
