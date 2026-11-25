import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withAutomationLock } from '@/lib/automation/locks'
import { getRosterEngineRegistry, writeLeagueRosterConfig } from '@/lib/roster-engine'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { publishRuleChangesEvent } from '@/lib/league-rules-explainer/publishRuleChanges'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { normalizeRosterSlots } from '@/lib/league-rules-explainer/snapshot'
import { remapStarterSeats } from './rosterSeatRemap'
import {
  ROSTER_SCHEDULE_STATE_KEY,
  describeLayout,
  describeRosterChange,
  dueRosterChanges,
  readRosterSchedule,
  readRosterScheduleState,
  rosterSpotsFromDefinitions,
  walkRosterSchedule,
  type RosterChange,
  type RosterScheduleState,
} from './rosterSchedule'

/**
 * The weekly run that applies a guillotine league's scheduled roster changes (rules in ./rosterSchedule.ts).
 *
 * Called for every native guillotine season on each score-sync pass (app/api/redraft/score-sync), with the week
 * whose lineups are open: the week being played, or the next one once this week's games are over. A change set
 * for week 10 therefore lands when week 9 ends, before week 10's first kickoff, not after it.
 *
 * 🛑 A CHANGE IS A DELTA, AND A DELTA RUN TWICE IS A DIFFERENT ROSTER. Every score-sync pass calls this, the
 * worker runs two replicas, and the layout is written through the roster engine's own writer, which is several
 * statements and not one transaction. So a run goes in three steps, and each is safe to repeat:
 *
 *   1. RECORD, under the league row lock: the changes due, and the absolute layout they produce from the
 *      roster the league has now. Nothing else is written yet.
 *   2. WRITE that recorded layout (lib/roster-engine `writeLeagueRosterConfig`, the commissioner editor's
 *      writer). It is absolute, so writing it again after a crash writes the same roster.
 *   3. FINISH, in one transaction under the same lock: move every saved starter's seat to where it now is
 *      (./rosterSeatRemap.ts), log the event, mark the changes done, clear the record.
 *
 * A pass that finds a record left by an earlier one skips step 1 and repeats 2 and 3 from it.
 *
 * 🛑 AND THE RECORD CAN COME BACK FROM THE DEAD. League.settings is one JSON value that many writers read,
 * change and write back whole, the roster engine's writer in step 2 among them. A writer holding a copy from
 * before step 3 puts the finished run's record back and erases its "done". Measured, not imagined: three
 * passes at once, and the second pass's step 2 restored the record the first had just cleared, so the finish
 * ran twice and every seat moved twice. Two things stop that:
 *
 *   - ONE PASS PER LEAGUE AT A TIME (lib/automation/locks.ts). A pass that cannot take the lock does nothing;
 *     whatever is left is picked up by the next one.
 *   - WHAT HAS RUN IS READ FROM THE EVENT LOG, not from settings. The `roster_change` event is written in the
 *     same transaction as the seat moves, in an append-only table no settings writer touches. A change named
 *     in an event is done, whatever settings says, and a record whose changes are all in an event is only
 *     cleared, never run again. That covers a writer this lock does not know about, such as a commissioner
 *     saving another setting in the same second.
 *
 * Nothing here moves a player in or out of anyone's lineup. See ./rosterSchedule.ts for why the kinds of
 * change are limited to ones where that is never needed.
 */

export type RosterScheduleRun = {
  week: number
  applied: RosterChange[]
  skipped: Array<{ change: RosterChange; reason: string }>
  slots: Record<string, number>
  /** True when this pass finished a run an earlier pass recorded. */
  resumed: boolean
}

type Db = Pick<Prisma.TransactionClient, 'guillotineEventLog'>

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Every change a `roster_change` event names: the durable record of what has run. */
export async function rosterChangesInEventLog(db: Db, leagueId: string): Promise<{ done: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const rows = await db.guillotineEventLog.findMany({ where: { leagueId, eventType: 'roster_change' }, select: { metadata: true } })
  const done: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  for (const row of rows) {
    const m = record(row.metadata)
    for (const a of Array.isArray(m.applied) ? m.applied : []) {
      const id = record(a).id
      if (typeof id === 'string') done.push(id)
    }
    for (const s of Array.isArray(m.skipped) ? m.skipped : []) {
      const x = record(s)
      if (typeof x.id === 'string') {
        done.push(x.id)
        skipped.push({ id: x.id, reason: typeof x.reason === 'string' ? x.reason : '' })
      }
    }
  }
  return { done, skipped }
}

/** What has run: the event log, plus whatever settings also says. */
export async function readRosterScheduleRan(db: Db, leagueId: string, settings: unknown): Promise<{ done: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const state = readRosterScheduleState(settings)
  const logged = await rosterChangesInEventLog(db, leagueId)
  const skipped = new Map([...state.skipped, ...logged.skipped].map((s) => [s.id, s]))
  return { done: [...new Set([...state.done, ...logged.done])], skipped: [...skipped.values()] }
}

async function starterSeatLabels(leagueId: string): Promise<string[]> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return []
  const sport = String(league.sport ?? 'NFL')
  const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
  return resolveLineupStarterSlots(league as never, template).map((s) => s.label)
}

/**
 * Apply every scheduled change due by `week`. Null when there is nothing to do, which is almost every call,
 * and when another pass is already doing it. Throws only when a write fails; the record it left makes the
 * next pass finish the job.
 */
export async function applyDueRosterChanges(input: { leagueId: string; week: number }): Promise<RosterScheduleRun | null> {
  const { leagueId, week } = input
  if (!Number.isInteger(week) || week < 1) return null
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
  if (!league) return null
  // An imported league's roster is its provider's (lib/guillotine/importedLeagueGuard.ts).
  if (!isNativePlatform(league.platform)) return null
  // The cheap way out, before any lock: no record, and nothing due that has not run.
  if (!readRosterScheduleState(league.settings).pending) {
    const schedule = readRosterSchedule(league.settings)
    if (schedule.length === 0) return null
    const ran = await readRosterScheduleRan(prisma, leagueId, league.settings)
    if (dueRosterChanges(schedule, ran.done, week).length === 0) return null
  }
  const locked = await withAutomationLock(`guillotine:roster-schedule:${leagueId}`, { owner: randomUUID(), ttlMs: 120_000 }, () => runLocked(leagueId, week))
  return locked.ok ? locked.value : null
}

async function runLocked(leagueId: string, week: number): Promise<RosterScheduleRun | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true, userId: true } })
  if (!league) return null
  const sport = String(league.sport ?? '').toUpperCase()
  const registry = getRosterEngineRegistry()
  if (!registry.isSupported(sport)) return null
  const service = registry.getService(sport)
  const layoutNow = (await service.getConfig(leagueId)).slots
  const spots = rosterSpotsFromDefinitions(service.getSlots(), layoutNow)
  const seatsNow = await starterSeatLabels(leagueId)
  const schedule = readRosterSchedule(league.settings)

  // 1. RECORD. Everything is re-read under the row lock.
  const pending = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return null
    const state = readRosterScheduleState(row.settings)
    const ran = await readRosterScheduleRan(tx, leagueId, row.settings)
    const settle = async (pendingNext: RosterScheduleState['pending']) => {
      const settings = { ...record(row.settings), [ROSTER_SCHEDULE_STATE_KEY]: { done: ran.done, skipped: ran.skipped, pending: pendingNext } }
      await tx.league.update({ where: { id: leagueId }, data: { settings: settings as Prisma.InputJsonValue } })
    }
    if (state.pending) {
      const ids = [...state.pending.ids, ...state.pending.skipped.map((s) => s.id)]
      // A record whose changes are all in the event log is a finished run that a stale settings write
      // brought back. It is cleared, and that is all.
      if (ids.length > 0 && ids.every((id) => ran.done.includes(id))) {
        await settle(null)
        return null
      }
      return { ...state.pending, resumed: true }
    }
    const due = dueRosterChanges(readRosterSchedule(row.settings), ran.done, week)
    if (due.length === 0) return null
    const walk = walkRosterSchedule(layoutNow, due, spots)
    const next: NonNullable<RosterScheduleState['pending']> = {
      week,
      ids: walk.steps.flatMap((s) => (s.ok ? [s.change.id] : [])),
      skipped: walk.steps.flatMap((s) => (s.ok ? [] : [{ id: s.change.id, reason: s.reason }])),
      slots: walk.slots,
      seatsBefore: seatsNow,
    }
    await settle(next)
    return { ...next, resumed: false }
  })
  if (!pending) return null

  // 2. WRITE the recorded layout. Skipped when every due change was refused: the roster does not change.
  if (pending.ids.length > 0) {
    await writeLeagueRosterConfig(leagueId, { templateKey: 'custom', slots: pending.slots }, { userId: null, auditAction: 'scheduled' })
  }
  const seatsAfter = pending.ids.length > 0 ? await starterSeatLabels(leagueId) : pending.seatsBefore

  // 3. FINISH: seats, event, done, record cleared. All or nothing.
  const byId = new Map(schedule.map((c) => [c.id, c]))
  const applied = pending.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const skipped = pending.skipped.flatMap((s) => (byId.has(s.id) ? [{ change: byId.get(s.id)!, reason: s.reason }] : []))
  const finished = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
      const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
      if (!row) return false
      const ran = await rosterChangesInEventLog(tx, leagueId)
      const ids = [...pending.ids, ...pending.skipped.map((s) => s.id)]
      // Already in the event log: this run was finished. Never move the seats a second time.
      const alreadyFinished = ids.length > 0 && ids.every((id) => ran.done.includes(id))
      if (!alreadyFinished) {
        if (pending.ids.length > 0 && pending.seatsBefore.length > 0 && seatsAfter.length > 0) {
          const rosters = await tx.roster.findMany({ where: { leagueId }, select: { id: true } })
          for (const { id } of rosters) {
            await tx.$queryRaw`SELECT id FROM rosters WHERE id = ${id} FOR UPDATE`
            const roster = await tx.roster.findUnique({ where: { id }, select: { playerData: true } })
            if (!roster) continue
            const next = remapStarterSeats(roster.playerData, pending.seatsBefore, seatsAfter)
            if (next !== roster.playerData) await tx.roster.update({ where: { id }, data: { playerData: next as Prisma.InputJsonValue } })
          }
        }
        await tx.guillotineEventLog.create({
          data: {
            leagueId,
            eventType: 'roster_change',
            metadata: {
              week: pending.week,
              applied: applied.map((c) => ({ id: c.id, week: c.week, text: describeRosterChange(c, spots) })),
              skipped: skipped.map((s) => ({ id: s.change.id, week: s.change.week, text: describeRosterChange(s.change, spots), reason: s.reason })),
              slots: pending.slots,
            } as Prisma.InputJsonValue,
          },
        })
      }
      const now = await readRosterScheduleRan(tx, leagueId, row.settings)
      const settings = { ...record(row.settings), [ROSTER_SCHEDULE_STATE_KEY]: { done: now.done, skipped: now.skipped, pending: null } }
      await tx.league.update({ where: { id: leagueId }, data: { settings: settings as Prisma.InputJsonValue } })
      return !alreadyFinished
    },
    { timeout: 30_000 },
  )
  if (!finished) return null

  // After the commit, best effort: a missed post never undoes or repeats the change.
  const post = (message: string) =>
    createLeagueChatMessage(leagueId, league.userId, message, {
      type: 'host_announcement',
      metadata: { senderIsHost: true, contentType: 'guillotine_roster_change', weekOrPeriod: pending.week },
    }).catch((e) => console.warn('[roster-schedule] chat post failed', e instanceof Error ? e.message : 'unknown error'))
  // A skipped change is said out loud: the commissioner scheduled it and the league was expecting it.
  for (const s of skipped) {
    await post(`A roster change scheduled for week ${s.change.week} was not made: ${describeRosterChange(s.change, spots)}. Why: ${s.reason}`)
  }
  if (applied.length > 0) {
    const lines = applied.map((c) => describeRosterChange(c, spots))
    await post(`Roster change for week ${pending.week}: ${lines.join('; ')}. Every team now has ${describeLayout(pending.slots, spots)}. Check your lineup before the week locks.`)
    await publishRuleChangesEvent({
      leagueId,
      actorUserId: league.userId,
      section: 'roster',
      changes: diffRuleSnapshots({ rosterSlots: normalizeRosterSlots(layoutNow) }, { rosterSlots: normalizeRosterSlots(pending.slots) }),
    })
  }
  return { week: pending.week, applied, skipped, slots: pending.slots, resumed: pending.resumed }
}
