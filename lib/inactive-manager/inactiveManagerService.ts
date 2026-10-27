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
import { startersOnBye } from '@/lib/league/native/lineupMoves'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { DRAFT_AS_ME_FEATURE, DRAFT_AS_ME_SETTING } from '@/lib/draft-room/draftAsMeAutopick'
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
): Promise<{ native: boolean; autopilotEntitled: boolean; draftAsMe: boolean; teams: InactiveManagerTeam[] }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true, userId: true } })
  if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') return { native: false, autopilotEntitled: false, draftAsMe: false, teams: [] }
  const managed = readManagedLineups(league.settings)
  const health = await getLeagueManagerHealth(leagueId)
  const suggested = new Set(suggestInactiveTeams(health.rows, managed))
  return {
    native: true,
    autopilotEntitled: await autopilotEntitled(league.userId),
    draftAsMe: settingsObject(league.settings)[DRAFT_AS_ME_SETTING] !== false,
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

export const DRAFT_AS_ME_ACTION = 'draft_as_me.set'

/**
 * Commissioner or co-commissioner: switch draft as me (lib/draft-room/draftAsMe.ts) on or off for the
 * league. It is on by default for a league on AF Commissioner; switching it ON needs that plan,
 * switching it off never does. Stored as `League.settings.draft_as_me`.
 */
export async function setDraftAsMe(leagueId: string, userId: string, on: unknown): Promise<{ ok: true; on: boolean } | { ok: false; status: number; error: string }> {
  if (!(await isElevatedCommissioner(leagueId, userId))) return { ok: false, status: 403, error: 'Forbidden' }
  if (typeof on !== 'boolean') return { ok: false, status: 400, error: 'Say whether to turn it on.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if (on) {
    let entitled = false
    try {
      entitled = Boolean((await new EntitlementResolver().resolveForUser(league.userId, DRAFT_AS_ME_FEATURE)).hasAccess)
    } catch {
      entitled = false
    }
    if (!entitled) return { ok: false, status: 402, error: 'Draft as me is part of the AF Commissioner plan.' }
  }
  let changed = false
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const settings = settingsObject(row?.settings)
    if ((settings[DRAFT_AS_ME_SETTING] !== false) === on) return
    changed = true
    await tx.league.update({ where: { id: leagueId }, data: { settings: { ...settings, [DRAFT_AS_ME_SETTING]: on } as Prisma.InputJsonValue } })
  })
  if (changed) await logAction({ leagueId, userId, actionType: DRAFT_AS_ME_ACTION, entityType: 'league', entityId: leagueId, metadata: { on } })
  return { ok: true, on }
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
          const byeFacts: Record<string, { byeWeek: number | null }> = {}
          for (const p of rows.map(serializeUnifiedPlayerForApi)) {
            players[p.id] = { position: p.position, projectedPoints: p.projectedPoints }
            byeFacts[p.id] = { byeWeek: p.product?.byeWeek ?? p.nflRedraftGameContext?.byeWeek ?? null }
          }
          // The lineup screen's own bye test: a starter whose bye week is this week.
          const onBye = new Set(startersOnBye(Object.keys(byeFacts), (id) => byeFacts[id], week))
          const locked = new Set(lock.lockedPlayerIds)
          const plan = planBestLineup({ slots, playerData: roster.playerData, players, isLocked: (id) => locked.has(id), onBye: (id) => onBye.has(id) })
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

export const AUTOPILOT_CLAIM_ACTION = 'chimmy_autopilot.claim'

export type AutopilotWaiverRunResult = {
  leagues: number
  teams: number
  claims: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

/**
 * Hourly, beside the lineups: each team on Chimmy autopilot claims a free agent for a starting slot
 * nobody healthy on its roster can fill (./autopilotWaivers.ts), in its style. Claims go through the
 * waiver wire's own `createClaim` — every league rule, window and limit applies — and a team that
 * already has a claim pending on a player does not claim him again. A league whose owner no longer
 * holds AF Commissioner is skipped, not switched off: the commissioner decides that.
 */
export async function runAutopilotWaivers(opts?: { limit?: number; deadline?: number }): Promise<AutopilotWaiverRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: AutopilotWaiverRunResult = { leagues: 0, teams: 0, claims: 0, skipped: {}, failures: [] }
  const skip = (reason: string, n = 1) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + n)
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings ? ${AF_MANAGED_LINEUPS_KEY} AND settings -> ${AF_MANAGED_LINEUPS_KEY} <> '{}'::jsonb
    ORDER BY id LIMIT ${Math.max(1, Math.min(opts?.limit ?? DEFAULT_LEAGUE_LIMIT, 100))}`

  const { planAutopilotWaivers } = await import('./autopilotWaivers')
  const { createClaim, getClaimsByRoster } = await import('@/lib/waiver-wire/claim-service')
  const { buildLineupListsFromPlayerData } = await import('@/lib/league/lineup-swap')
  const { assertLifecycleActionAllowed } = await import('@/server/services/leagueLifecycleService')
  const { assertRosterTransactionsAllowed } = await import('@/lib/roster-legality/rosterTransactionGates')

  for (const { id: leagueId } of ids) {
    if (Date.now() >= deadline) break
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId } })
      if (!league) continue
      const managed = readManagedLineups(league.settings)
      const autopilot = autopilotRosterIds(managed)
      if (autopilot.length === 0) continue
      result.leagues += 1
      const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
      const reason =
        resolveWriteAuthority(league.platform) !== 'NATIVE'
          ? 'not_native'
          : !['active', 'in_season'].includes(status)
            ? 'not_in_season'
            : league.lockAllMoves
              ? 'moves_locked'
              : !(await autopilotEntitled(league.userId))
                ? 'not_entitled'
                : null
      if (reason) {
        skip(reason, autopilot.length)
        continue
      }
      const sport = String(league.sport ?? 'NFL')
      const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
      const slots = resolveLineupStarterSlots(league as never, template)
      const benchCapacity = template ? template.slots.reduce((sum, s) => sum + (s.benchCount ?? 0), 0) || null : null
      const pool = (await getNormalizedPlayerData({ surface: 'waivers', leagueId, limit: 300 })).map(serializeUnifiedPlayerForApi)
      const freeAgents = pool.map((p) => ({ id: p.id, position: p.position, projectedPoints: p.projectedPoints, injuryStatus: p.injuryStatus, yearsExp: p.product?.yearsExp ?? null }))

      for (const rosterId of autopilot) {
        if (Date.now() >= deadline) break
        result.teams += 1
        try {
          const roster = await prisma.roster.findFirst({ where: { id: rosterId, leagueId } })
          if (!roster?.platformUserId) {
            skip('no_roster')
            continue
          }
          // The claims route's own gates, minus the "can this user see the league" check an abandoned
          // team's `orphan-…` seat cannot pass: league phase, locks, pauses and roster legality.
          const lifecycle = await assertLifecycleActionAllowed(leagueId, 'waiver_claim_submit', roster.platformUserId, { isElevatedCommissioner: false })
          if (!lifecycle.ok) {
            skip('waivers_not_open')
            continue
          }
          const legality = await assertRosterTransactionsAllowed({ leagueId, rosterIds: [rosterId], userId: roster.platformUserId, kind: 'waiver_claim' })
          if (!legality.ok) {
            skip(`roster_${legality.code.toLowerCase()}`)
            continue
          }
          const lists = buildLineupListsFromPlayerData(roster.playerData, slots.length)
          const rows = await getNormalizedPlayerData({ surface: 'roster', leagueId, userId: roster.platformUserId, limit: 200 })
          const players: Record<string, { id: string; position: string | null; projectedPoints: number | null; injuryStatus: string | null; yearsExp: number | null }> = {}
          for (const p of rows.map(serializeUnifiedPlayerForApi)) {
            players[p.id] = { id: p.id, position: p.position, projectedPoints: p.projectedPoints, injuryStatus: p.injuryStatus, yearsExp: p.product?.yearsExp ?? null }
          }
          const pending = ((await getClaimsByRoster(rosterId, 'pending')) as Array<{ addPlayerId: string }>).map((c) => String(c.addPlayerId))
          const style = managed[rosterId]!.autopilot!.style
          const plan = planAutopilotWaivers({ style, slots, starters: lists.starters, bench: lists.bench, players, freeAgents, benchCapacity, pendingAddIds: pending })
          if (plan.claims.length === 0) {
            skip(plan.unfilled.length ? 'no_fitting_free_agent' : 'no_holes')
            continue
          }
          for (const c of plan.claims) {
            try {
              await createClaim(leagueId, rosterId, {
                addPlayerId: c.addPlayerId,
                dropPlayerId: c.dropPlayerId,
                faabBid: null,
                userId: roster.platformUserId,
                metadata: { source: 'chimmy_autopilot', style, slot: c.slot },
              })
              result.claims += 1
              await logAction({
                leagueId,
                userId: managed[rosterId]!.autopilot!.byUserId,
                actionType: AUTOPILOT_CLAIM_ACTION,
                entityType: 'roster',
                entityId: rosterId,
                metadata: { rosterId, style, slot: c.slot, addPlayerId: c.addPlayerId, dropPlayerId: c.dropPlayerId },
              })
            } catch {
              // A league rule said no (waivers closed, roster full, a hold on the player): normal, not a fault.
              skip('claim_refused')
            }
          }
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
