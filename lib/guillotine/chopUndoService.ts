import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'

import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { copyGenericFaabToRedraft } from '@/lib/league/faabMirror'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { resolveRedraftRosterIds } from '@/lib/league-runtime/reconcileRosterRedraftLinks'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { resolveRecipients } from '@/lib/notifications/resolveAppUserIds'
import { prisma } from '@/lib/prisma'
import { claimedPlayerIds } from './choppedReleases'
import {
  CHOP_UNDO_BLOCKER_MESSAGES,
  chopUndoBlockers,
  faabResetReturnPlan,
  faabReturnPlan,
  validateChopInstead,
  type ChopUndoBlocker,
} from './chopUndo'
import { runElimination } from './GuillotineEliminationEngine'
import { appendEvent } from './GuillotineEventLog'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { isImportedLeague } from './importedLeagueGuard'
import { releaseNativeChoppedPlayers } from './nativeChopRelease'
import { resolveRosterDisplayNames } from './rosterDisplayNames'

/**
 * Undo a chop (./chopUndo.ts holds the rules and the list of what a chop writes).
 *
 * The undo itself is ONE transaction, re-checked inside it, run under the same automation locks the weekly chop
 * takes for that week and the next, so a score sync cannot chop while a team is half restored. "Chop this team
 * instead" then runs the real chop engine for the same week with the commissioner's pick, so the new chop is
 * recorded, released, audited and announced exactly like any other.
 */

type Db = Prisma.TransactionClient | typeof prisma

/** How long before the engine's choppedAt the native release can have dropped the players (the driver's clock). */
const RELEASE_WINDOW_MS = 30 * 60 * 1000

/** Thrown inside the undo transaction to roll it back with a message the commissioner can read. */
class UndoRefused extends Error {}

export type ChopUndoTeam = { rosterId: string; name: string; points: number | null }

export type ChopUndoState = {
  week: number | null
  chopped: ChopUndoTeam[]
  /** Teams that played that week and are still alive: who could be chopped instead. */
  alive: ChopUndoTeam[]
  /** Teams a stat correction says should have gone that week, when it said so. */
  correctionSuggests: string[]
  blockers: Array<{ code: ChopUndoBlocker; message: string }>
}

type ChopContext = {
  leagueId: string
  importedLeague: boolean
  gSeason: { id: string; season: number; status: string; isInFinalStage: boolean; currentScoringPeriod: number; redraftSeasonId: string | null; createdAt: Date } | null
  week: number | null
  choppedAt: Date | null
  choppedRosterIds: string[]
  redraftByEngine: Map<string, string>
  releases: Array<{ eliminatedRosterId: string; playerId: string }>
}

async function loadContext(leagueId: string, db: Db = prisma): Promise<ChopContext> {
  const importedLeague = await isImportedLeague(leagueId)
  const gSeason = await db.guillotineSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, season: true, status: true, isInFinalStage: true, currentScoringPeriod: true, redraftSeasonId: true, createdAt: true },
  })
  const states = gSeason
    ? await db.guillotineRosterState.findMany({
        where: { leagueId, choppedAt: { not: null, gte: gSeason.createdAt }, choppedInPeriod: { not: null } },
        select: { rosterId: true, choppedAt: true, choppedInPeriod: true },
      })
    : []
  const week = states.length ? Math.max(...states.map((s) => s.choppedInPeriod!)) : null
  const latest = states.filter((s) => s.choppedInPeriod === week)
  const choppedRosterIds = latest.map((s) => s.rosterId)
  const choppedAt = latest.length ? new Date(Math.min(...latest.map((s) => s.choppedAt!.getTime()))) : null
  const redraftByEngine = choppedRosterIds.length
    ? await resolveRedraftRosterIds(leagueId, choppedRosterIds).catch(() => new Map<string, string>())
    : new Map<string, string>()
  const releases =
    week != null && redraftByEngine.size
      ? await db.guillotineWaiverRelease.findMany({
          where: { leagueId, scoringPeriod: week, eliminatedRosterId: { in: [...redraftByEngine.values()] } },
          select: { eliminatedRosterId: true, playerId: true },
        })
      : []
  return { leagueId, importedLeague, gSeason, week, choppedAt, choppedRosterIds, redraftByEngine, releases }
}

async function blockersFor(ctx: ChopContext, db: Db = prisma): Promise<ChopUndoBlocker[]> {
  const { gSeason, week, choppedAt } = ctx
  const redraftIds = [...ctx.redraftByEngine.values()]
  const [laterChop, claimsProcessed, claimed, droppedByTeam, faabEvent, faabReset] = await Promise.all([
    gSeason && week != null
      ? db.guillotineElimination.findFirst({ where: { seasonId: gSeason.id, scoringPeriod: { gt: week } }, select: { scoringPeriod: true } })
      : null,
    gSeason?.redraftSeasonId && choppedAt
      ? db.redraftWaiverClaim.count({ where: { seasonId: gSeason.redraftSeasonId, processedAt: { gt: choppedAt } } })
      : 0,
    ctx.releases.length ? claimedPlayerIds(ctx.leagueId, ctx.releases.map((r) => r.playerId), db as typeof prisma) : new Set<string>(),
    // Players dropped AT the chop (the release runs just before the engine stamps choppedAt), not a manager's
    // ordinary drops earlier in the season.
    redraftIds.length && choppedAt
      ? db.redraftRosterPlayer.groupBy({
          by: ['rosterId'],
          where: { rosterId: { in: redraftIds }, droppedAt: { gte: new Date(choppedAt.getTime() - RELEASE_WINDOW_MS) } },
          _count: { _all: true },
        })
      : [],
    week != null ? findFaabSplit(ctx.leagueId, week, choppedAt, db) : null,
    week != null ? findFaabReset(ctx.leagueId, week, choppedAt, db) : null,
  ])
  const listed = new Set(ctx.releases.map((r) => r.eliminatedRosterId))
  const teamsWithoutReleaseRecord = (droppedByTeam as Array<{ rosterId: string }>).filter((row) => !listed.has(row.rosterId)).length
  return chopUndoBlockers({
    importedLeague: ctx.importedLeague,
    week,
    latestRecordedWeek: Math.max(gSeason?.currentScoringPeriod ?? 0, laterChop?.scoringPeriod ?? 0),
    seasonComplete: gSeason?.status === 'complete',
    inFinalStage: gSeason?.isInFinalStage === true,
    claimsProcessedSinceChop: claimsProcessed,
    claimedReleasedPlayers: claimed.size,
    teamsWithoutReleaseRecord,
    unmatchedTeams: ctx.choppedRosterIds.filter((id) => !ctx.redraftByEngine.has(id)).length,
    faabSplitWithoutShares: faabReturnPlan(faabEvent, ctx.choppedRosterIds) == null,
    faabResetWithoutChanges: faabResetReturnPlan(faabReset?.metadata ?? null) == null,
  })
}

/** The week's "FAAB after a chop" event (./faabAfterChop.ts), written in the chop's own run. */
async function findFaabReset(leagueId: string, week: number, choppedAt: Date | null, db: Db) {
  if (!choppedAt) return null
  const row = await db.guillotineEventLog.findFirst({
    where: { leagueId, eventType: 'faab_after_chop', createdAt: { gte: new Date(choppedAt.getTime() - 60_000) }, metadata: { path: ['weekOrPeriod'], equals: week } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, metadata: true },
  })
  if (!row) return null
  const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {}
  return { id: row.id, metadata }
}

/** The week's payout event, with `__eventId` (this row's id) for the undo that removes a payout's marker. */
type FaabPayoutEvent = { shares?: unknown; taken?: unknown; pool?: unknown; key?: unknown; __eventId: string }

async function findFaabSplit(leagueId: string, week: number, choppedAt: Date | null, db: Db): Promise<FaabPayoutEvent | null> {
  if (!choppedAt) return null
  const row = await db.guillotineEventLog.findFirst({
    where: { leagueId, eventType: 'faab_split', createdAt: { gte: new Date(choppedAt.getTime() - 60_000) }, metadata: { path: ['weekOrPeriod'], equals: week } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, metadata: true },
  })
  if (!(row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata))) return null
  const m = row.metadata as Record<string, unknown>
  return { shares: m.shares, taken: m.taken, pool: m.pool, key: m.key, __eventId: row.id }
}

/** What the commissioner's Undo card shows. */
export async function loadChopUndoState(leagueId: string): Promise<ChopUndoState> {
  const ctx = await loadContext(leagueId)
  const blockers = await blockersFor(ctx)
  const week = ctx.week
  const scores =
    week != null
      ? await prisma.guillotinePeriodScore.findMany({
          where: { leagueId, weekOrPeriod: week, ...(ctx.gSeason ? { season: ctx.gSeason.season } : {}) },
          select: { rosterId: true, periodPoints: true },
        })
      : []
  const stillChopped = new Set(
    (await prisma.guillotineRosterState.findMany({ where: { leagueId, choppedAt: { not: null } }, select: { rosterId: true } })).map((r) => r.rosterId),
  )
  const aliveIds = scores.map((s) => s.rosterId).filter((id) => !stillChopped.has(id))
  const names = await resolveRosterDisplayNames(leagueId, [...ctx.choppedRosterIds, ...aliveIds])
  const team = (rosterId: string, i: number): ChopUndoTeam => {
    const s = scores.find((row) => row.rosterId === rosterId)
    return { rosterId, name: names.get(rosterId) ?? `Team ${i + 1}`, points: s ? Math.round(s.periodPoints * 100) / 100 : null }
  }
  const correction =
    week != null && ctx.choppedAt
      ? await prisma.guillotineEventLog.findFirst({
          where: { leagueId, eventType: 'stat_correction', createdAt: { gte: ctx.choppedAt }, metadata: { path: ['week'], equals: week } },
          orderBy: { createdAt: 'desc' },
          select: { metadata: true },
        })
      : null
  const m = (correction?.metadata ?? {}) as Record<string, unknown>
  const correctionSuggests =
    m.chopDisputed === true && Array.isArray(m.wouldHaveChoppedRosterIds)
      ? m.wouldHaveChoppedRosterIds.filter((id): id is string => typeof id === 'string' && aliveIds.includes(id))
      : []
  return {
    week,
    chopped: ctx.choppedRosterIds.map(team),
    alive: aliveIds.map(team).sort((a, b) => (a.points ?? 0) - (b.points ?? 0)),
    correctionSuggests,
    blockers: blockers.map((code) => ({ code, message: CHOP_UNDO_BLOCKER_MESSAGES[code] })),
  }
}

export type UndoChopResult =
  | { ok: true; week: number; restoredRosterIds: string[]; choppedInsteadRosterIds: string[]; playersRestored: number; claimsDenied: number }
  | { ok: false; status: number; error: string; blockers?: ChopUndoBlocker[] }

/** Undo the league's most recent chop, then optionally chop `chopInstead` for the same week. */
export async function undoLatestChop(args: { leagueId: string; userId: string; week: unknown; chopInstead?: unknown }): Promise<UndoChopResult> {
  const { leagueId, userId } = args
  const pre = await loadContext(leagueId)
  if (pre.week == null) return { ok: false, status: 404, error: CHOP_UNDO_BLOCKER_MESSAGES.no_chop }
  if (args.week !== pre.week) return { ok: false, status: 409, error: 'The chop changed while you were looking. Refresh and try again.' }
  const week = pre.week

  // The weekly chop's own locks, for this week and the next: nothing chops while a team is half restored.
  const owner = randomUUID()
  const keys = [`guillotine-chop:${leagueId}:${week}`, `guillotine-chop:${leagueId}:${week + 1}`]
  const held: string[] = []
  try {
    for (const key of keys) {
      const lock = await acquireAutomationLock(key, { owner, ttlMs: 300_000 })
      if (!lock.ok) return { ok: false, status: 409, error: 'The chop is being processed right now. Try again in a few minutes.' }
      held.push(key)
    }

    // Validated before the undo, so a bad pick never leaves a week with no chop.
    const scored = await prisma.guillotinePeriodScore.findMany({
      where: { leagueId, weekOrPeriod: week, ...(pre.gSeason ? { season: pre.gSeason.season } : {}) },
      select: { rosterId: true, periodPoints: true, seasonPointsCumul: true },
    })
    const stillChopped = new Set(
      (await prisma.guillotineRosterState.findMany({ where: { leagueId, choppedAt: { not: null } }, select: { rosterId: true } })).map((r) => r.rosterId),
    )
    const instead = validateChopInstead({
      requested: args.chopInstead,
      undoneRosterIds: pre.choppedRosterIds,
      eligibleRosterIds: scored.map((s) => s.rosterId).filter((id) => !stillChopped.has(id)),
    })
    if (!instead.ok) return { ok: false, status: 400, error: instead.error }

    const undone = await prisma.$transaction(async (tx) => {
      const ctx = await loadContext(leagueId, tx)
      if (ctx.week !== week || ctx.choppedRosterIds.join('|') !== pre.choppedRosterIds.join('|')) {
        return { ok: false as const, status: 409, error: 'The chop changed while you were looking. Refresh and try again.' }
      }
      const blockers = await blockersFor(ctx, tx)
      if (blockers.length) return { ok: false as const, status: 409, error: CHOP_UNDO_BLOCKER_MESSAGES[blockers[0]!], blockers }
      return { ok: true as const, ...(await applyUndo(tx, ctx, userId)) }
    }).catch((error: unknown) => {
      if (error instanceof UndoRefused) return { ok: false as const, status: 409, error: error.message }
      throw error
    })
    if (!undone.ok) return undone

    let choppedInsteadRosterIds: string[] = []
    if (instead.rosterIds.length) {
      choppedInsteadRosterIds = await chopInstead({ leagueId, week, gSeason: pre.gSeason!, rosterIds: instead.rosterIds, scored })
    }
    await announceUndo({
      leagueId,
      week,
      restoredRosterIds: pre.choppedRosterIds,
      choppedInsteadRosterIds,
    })
    return {
      ok: true,
      week,
      restoredRosterIds: pre.choppedRosterIds,
      choppedInsteadRosterIds,
      playersRestored: undone.playersRestored,
      claimsDenied: undone.claimsDenied,
    }
  } finally {
    for (const key of held) await releaseAutomationLock(key, owner).catch(() => undefined)
  }
}

async function applyUndo(tx: Prisma.TransactionClient, ctx: ChopContext, userId: string): Promise<{ playersRestored: number; claimsDenied: number }> {
  const { leagueId, gSeason, choppedRosterIds } = ctx
  const week = ctx.week!
  const redraftIds = choppedRosterIds.map((id) => ctx.redraftByEngine.get(id)!)
  const releasedPlayerIds = [...new Set(ctx.releases.map((r) => r.playerId))]

  await tx.guillotineRosterState.updateMany({
    where: { leagueId, rosterId: { in: choppedRosterIds } },
    data: { choppedAt: null, choppedInPeriod: null, choppedReason: null },
  })
  await tx.redraftRoster.updateMany({ where: { id: { in: redraftIds } }, data: { isEliminated: false } })
  await tx.leagueTeam.updateMany({ where: { leagueId, externalId: { in: choppedRosterIds } }, data: { eliminatedAt: null } })
  if (gSeason) {
    const removed = await tx.guillotineElimination.deleteMany({ where: { seasonId: gSeason.id, scoringPeriod: week, eliminatedRosterId: { in: redraftIds } } })
    await tx.guillotineSurvivalLog.updateMany({
      where: { seasonId: gSeason.id, scoringPeriod: week, rosterId: { in: redraftIds } },
      data: { survivalStatus: 'survived' },
    })
    if (removed.count) await tx.guillotineSeason.update({ where: { id: gSeason.id }, data: { currentTeamsActive: { increment: removed.count } } })
  }

  // The released players go back: the most recent drop of each listed player, on the team it was released from.
  let playersRestored = 0
  for (const rosterId of redraftIds) {
    const ids = ctx.releases.filter((r) => r.eliminatedRosterId === rosterId).map((r) => r.playerId)
    if (!ids.length) continue
    const rows = await tx.redraftRosterPlayer.findMany({
      where: { rosterId, playerId: { in: ids }, droppedAt: { not: null } },
      orderBy: { droppedAt: 'desc' },
      select: { id: true, playerId: true },
    })
    const latest = new Map<string, string>()
    for (const row of rows) if (!latest.has(row.playerId)) latest.set(row.playerId, row.id)
    if (latest.size) {
      const restored = await tx.redraftRosterPlayer.updateMany({ where: { id: { in: [...latest.values()] } }, data: { droppedAt: null } })
      playersRestored += restored.count
    }
  }
  await tx.guillotineWaiverRelease.deleteMany({ where: { leagueId, scoringPeriod: week, eliminatedRosterId: { in: redraftIds } } })
  const denied =
    gSeason?.redraftSeasonId && releasedPlayerIds.length
      ? await tx.redraftWaiverClaim.updateMany({
          where: { seasonId: gSeason.redraftSeasonId, status: 'pending', addPlayerId: { in: releasedPlayerIds } },
          data: { status: 'denied', processedAt: new Date(), denialReason: 'The commissioner undid the chop, so this player is back on his team.' },
        })
      : { count: 0 }

  // FAAB after a chop (top up / reset): undone FIRST, the reverse of the order the chop applied them. Each survivor
  // goes back to its balance before the chop — only if it is still exactly what the chop set (a spend since would make
  // "before" a guess). The marker is deleted so chopping the week again applies the rule again.
  const reset = await findFaabReset(leagueId, week, ctx.choppedAt, tx)
  if (reset) {
    const resetPlan = faabResetReturnPlan(reset.metadata)
    if (!resetPlan) throw new UndoRefused(CHOP_UNDO_BLOCKER_MESSAGES.faab_reset_unknown)
    for (const [rosterId, { before, after }] of resetPlan) {
      const put = await tx.roster.updateMany({ where: { id: rosterId, faabRemaining: after }, data: { faabRemaining: before } })
      if (put.count !== 1) throw new UndoRefused(CHOP_UNDO_BLOCKER_MESSAGES.waivers_ran)
    }
    if (resetPlan.size) await copyGenericFaabToRedraft(tx, [...resetPlan.keys()])
    await tx.guillotineEventLog.delete({ where: { id: reset.id } })
  }

  // FAAB passed to the survivors (split, a scorer, or the next in waiver order): each gives its share back, each
  // chopped team gets back what it gave.
  const payout = await findFaabSplit(leagueId, week, ctx.choppedAt, tx)
  const plan = faabReturnPlan(payout, choppedRosterIds)!
  for (const [rosterId, amount] of plan.fromSurvivors) {
    const took = await tx.roster.updateMany({ where: { id: rosterId, faabRemaining: { gte: amount } }, data: { faabRemaining: { decrement: amount } } })
    if (took.count !== 1) throw new UndoRefused(CHOP_UNDO_BLOCKER_MESSAGES.waivers_ran)
  }
  for (const [rosterId, amount] of plan.toChopped) {
    await tx.roster.update({ where: { id: rosterId }, data: { faabRemaining: { increment: amount } } })
  }
  if (plan.fromSurvivors.size || plan.toChopped.size) await copyGenericFaabToRedraft(tx, [...plan.fromSurvivors.keys(), ...plan.toChopped.keys()])
  // A payout that recorded its own marker (`key`, ./faabOnChopApply.ts) is paid once per chop BY that marker. The
  // money is back, so the marker goes too — as the reset's does above — or chopping the week again would pay nobody.
  // An older event with no key was never a marker and stays as it was.
  if (payout && typeof payout.key === 'string') await tx.guillotineEventLog.delete({ where: { id: payout.__eventId } })

  // The generic roster blob the release emptied: the snapshot when the release recorded one, else the player list.
  const released = await tx.guillotineEventLog.findMany({
    where: { leagueId, eventType: 'roster_released', createdAt: { gte: new Date(ctx.choppedAt!.getTime() - 60_000) } },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true },
  })
  for (const rosterId of choppedRosterIds) {
    const event = released.map((e) => (e.metadata ?? {}) as Record<string, unknown>).find((m) => Array.isArray(m.rosterIds) && m.rosterIds.includes(rosterId))
    const snapshot = event && event.previousPlayerData && typeof event.previousPlayerData === 'object' ? (event.previousPlayerData as Record<string, unknown>)[rosterId] : undefined
    if (snapshot !== undefined && snapshot !== null) {
      await tx.roster.update({ where: { id: rosterId }, data: { playerData: snapshot as Prisma.InputJsonValue } })
      continue
    }
    const redraftId = ctx.redraftByEngine.get(rosterId)!
    const players = ctx.releases.filter((r) => r.eliminatedRosterId === redraftId).map((r) => r.playerId)
    const current = await tx.roster.findUnique({ where: { id: rosterId }, select: { playerData: true } })
    if (current && players.length && getRosterPlayerIds(current.playerData).length === 0) {
      const data = Array.isArray(current.playerData) || !current.playerData ? {} : { ...(current.playerData as Record<string, unknown>) }
      await tx.roster.update({ where: { id: rosterId }, data: { playerData: { ...data, players } as Prisma.InputJsonValue } })
    }
  }

  await tx.guillotineEventLog.create({
    data: { leagueId, eventType: 'chop_undone', metadata: { weekOrPeriod: week, restoredRosterIds: choppedRosterIds, playersRestored, by: userId } },
  })
  await tx.leagueAuditLog.create({
    data: {
      leagueId,
      userId,
      actionType: 'guillotine_chop_undone',
      entityType: 'guillotine_week',
      entityId: `${gSeason?.id ?? 'season'}:${week}`,
      metadata: { week },
      afterState: { restoredRosterIds: choppedRosterIds, playersRestored, claimsDenied: denied.count },
    },
  })
  return { playersRestored, claimsDenied: denied.count }
}

/** The commissioner's pick, chopped for the same week by the real engine, released like any native chop. */
async function chopInstead(args: {
  leagueId: string
  week: number
  gSeason: NonNullable<ChopContext['gSeason']>
  rosterIds: string[]
  scored: Array<{ rosterId: string; periodPoints: number; seasonPointsCumul: number }>
}): Promise<string[]> {
  const result = await runElimination({
    leagueId: args.leagueId,
    weekOrPeriod: args.week,
    season: args.gSeason.season,
    // The week's correction cutoff passed before its original chop; this states "long over" without inventing a date.
    periodEndedAt: new Date(0),
    periodScores: args.scored,
    commissionerChoppedRosterIds: args.rosterIds,
    // One announcement covers the undo and this chop (announceUndo); the chop alerts still go out.
    skipChat: true,
  })
  const marked = result?.eliminationFlagged?.marked ?? []
  await releaseNativeChoppedPlayers({ leagueId: args.leagueId, guillotineSeasonId: args.gSeason.id, week: args.week, redraftRosterIds: marked, now: new Date() })
  if (!result?.choppedRosterIds.length) {
    console.warn('[guillotine] undo: the replacement chop did not happen', { leagueId: args.leagueId, week: args.week, reason: result?.reason })
  }
  return result?.choppedRosterIds ?? []
}

/** League chat, and a direct alert to each manager whose team came back. Best-effort: the undo has happened. */
async function announceUndo(args: {
  leagueId: string
  week: number
  restoredRosterIds: string[]
  choppedInsteadRosterIds: string[]
}): Promise<void> {
  try {
    const names = await resolveRosterDisplayNames(args.leagueId, [...args.restoredRosterIds, ...args.choppedInsteadRosterIds])
    const list = (ids: string[]) => ids.map((id) => names.get(id) ?? 'a team').join(' and ')
    const back = list(args.restoredRosterIds)
    const text = args.choppedInsteadRosterIds.length
      ? `↩️ The commissioner undid the week ${args.week} chop. ${back} ${args.restoredRosterIds.length === 1 ? 'is' : 'are'} back in, and ${list(args.choppedInsteadRosterIds)} ${args.choppedInsteadRosterIds.length === 1 ? 'is' : 'are'} chopped instead.`
      : `↩️ The commissioner undid the week ${args.week} chop. ${back} ${args.restoredRosterIds.length === 1 ? 'is' : 'are'} back in, with ${args.restoredRosterIds.length === 1 ? 'its' : 'their'} players.`
    const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { userId: true, name: true } })
    if (league?.userId) {
      await createLeagueChatMessage(args.leagueId, league.userId, text, {
        idempotencyKey: `guillotine-chop-undone:${args.leagueId}:w${args.week}:${args.restoredRosterIds.join(',')}`,
        type: 'host_announcement',
        metadata: { senderIsHost: true, guillotineChopUndone: true },
      })
    }
    // The same lookup the chop alerts use (./chopAlerts.ts): the roster's platform user, resolved to an app user.
    const owners = await prisma.roster.findMany({ where: { leagueId: args.leagueId, id: { in: args.restoredRosterIds } }, select: { platformUserId: true } })
    const { userIds } = await resolveRecipients(owners.map((o) => o.platformUserId).filter((v): v is string => !!v))
    if (userIds.length) {
      await dispatchNotification({
        userIds,
        category: 'matchup_results',
        type: 'guillotine_chop_undone',
        title: `You're back in ${league?.name?.trim() || 'your league'}`,
        body: `The commissioner undid the week ${args.week} chop. Your team and your players are back.`,
        actionHref: `/league/${args.leagueId}`,
        actionLabel: 'Open league',
        leagueId: args.leagueId,
        meta: { week: args.week },
        severity: 'high',
        dedupePrefix: `guillotine-chop-undone:${args.leagueId}:w${args.week}`,
      })
    }
  } catch (error) {
    console.warn('[guillotine] chop undo announcement failed; the undo stands', {
      leagueId: args.leagueId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
