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
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { slotCategory } from '@/lib/league-runtime/redraftSlotType'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { lineupSetsItself } from './guillotineBestBall'
import { planBenchForRemovedSeats, withoutStarterSeats, type BenchedPlayer } from './rosterBenchRemovedSeats'
import { remapStarterSeats } from './rosterSeatRemap'
import { readRosterScheduleRan, rosterChangesInEventLog } from './rosterScheduleRan'
import {
  ROSTER_SCHEDULE_STATE_KEY,
  describeLayout,
  describeRosterChange,
  dueRosterChanges,
  readRosterSchedule,
  readRosterScheduleState,
  rosterChangeMovesPlayers,
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
 * 🛑 ONE KIND OF CHANGE MOVES A PLAYER, AND ONLY BETWEEN WEEKS. Taking a starting spot away benches whoever
 * sits in it (./rosterBenchRemovedSeats.ts says why it must). It runs only when the pass says the week's games
 * are over (`betweenWeeks`), so the lineup it touches is next week's and nobody who has played is moved. A
 * take-away whose week arrives mid-week WAITS for the week to end; every other kind runs at once. The move is
 * the lineup engine's own save, so the lineup, the scoring slot and the week's record all change together.
 *
 * 🛑 AND THE WEEK JUST FINISHED IS FROZEN FIRST. A team's scoring slot is current state: a week with no saved
 * lineup of its own is scored from it (lib/redraft/weekLineupSlots.ts), and the chop for the week just played
 * can run a day or more after its last game. Benching a starter for next week would reach back and take his
 * points away from the week he just played, in a league where the lowest score is cut. So before a team's
 * player is moved, that team's lineup for the finished week is written down as it stands, unless it has one.
 */

export type RosterScheduleRun = {
  week: number
  applied: RosterChange[]
  skipped: Array<{ change: RosterChange; reason: string }>
  slots: Record<string, number>
  /** True when this pass finished a run an earlier pass recorded. */
  resumed: boolean
  /** Players moved to the bench because their starting spot was taken away, by team. */
  benched: Array<{ rosterId: string; players: BenchedPlayer[] }>
  /** Teams whose player could not be moved, with the lineup engine's reason. */
  benchFailures: Array<{ rosterId: string; error: string }>
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

async function starterSeatLabels(leagueId: string): Promise<string[]> {
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return []
  const sport = String(league.sport ?? 'NFL')
  const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
  return resolveLineupStarterSlots(league as never, template).map((s) => s.label)
}

/** Due now: every due change, except one that moves players while a week is being played. */
function dueNow(schedule: RosterChange[], done: ReadonlyArray<string>, week: number, betweenWeeks: boolean): RosterChange[] {
  return dueRosterChanges(schedule, done, week).filter((c) => betweenWeeks || !rosterChangeMovesPlayers(c.kind))
}

/**
 * A team's lineup for a finished week, written down as scoring reads it today, unless that week already has
 * one. Scoring then reads the week from this record and a later move cannot change it.
 */
async function freezeWeekLineup(args: { leagueId: string; rosterId: string; redraftRosterId: string | null; season: number; week: number }): Promise<void> {
  if (!args.redraftRosterId || args.week < 1) return
  const redraftRosterId = args.redraftRosterId
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM rosters WHERE id = ${args.rosterId} FOR UPDATE`
    const existing = await tx.afRosterLineupAssignment.count({ where: { rosterId: args.rosterId, season: args.season, week: args.week } })
    if (existing > 0) return
    const players = await tx.redraftRosterPlayer.findMany({ where: { rosterId: redraftRosterId, droppedAt: null }, select: { playerId: true, slotType: true }, orderBy: { playerId: 'asc' } })
    const order = new Map<string, number>()
    const rows = players.map((p) => {
      const category = slotCategory(p.slotType)
      const section = category === 'starter' ? 'starters' : category
      const slotIndex = order.get(section) ?? 0
      order.set(section, slotIndex + 1)
      return { leagueId: args.leagueId, rosterId: args.rosterId, season: args.season, week: args.week, section, slotIndex, playerId: p.playerId }
    })
    if (rows.length > 0) await tx.afRosterLineupAssignment.createMany({ data: rows, skipDuplicates: true })
  })
}

/**
 * Apply every scheduled change due by `week`. Null when there is nothing to do, which is almost every call,
 * and when another pass is already doing it. Throws only when a write fails; the record it left makes the
 * next pass finish the job.
 *
 * `week` is the week whose lineups are open, and `betweenWeeks` says the games before it are over.
 */
export async function applyDueRosterChanges(input: { leagueId: string; week: number; betweenWeeks?: boolean }): Promise<RosterScheduleRun | null> {
  const { leagueId, week } = input
  const betweenWeeks = input.betweenWeeks === true
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
    if (dueNow(schedule, ran.done, week, betweenWeeks).length === 0) return null
  }
  const locked = await withAutomationLock(`guillotine:roster-schedule:${leagueId}`, { owner: randomUUID(), ttlMs: 120_000 }, () => runLocked(leagueId, week, betweenWeeks))
  return locked.ok ? locked.value : null
}

async function runLocked(leagueId: string, week: number, betweenWeeks: boolean): Promise<RosterScheduleRun | null> {
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
    const due = dueNow(readRosterSchedule(row.settings), ran.done, week, betweenWeeks)
    if (due.length === 0) return null
    const walk = walkRosterSchedule(layoutNow, due, spots)
    const next: NonNullable<RosterScheduleState['pending']> = {
      week,
      ids: walk.steps.flatMap((s) => (s.ok ? [s.change.id] : [])),
      skipped: walk.steps.flatMap((s) => (s.ok ? [] : [{ id: s.change.id, reason: s.reason }])),
      slots: walk.slots,
      slotsBefore: layoutNow,
      seatsBefore: seatsNow,
      startedAt: new Date().toISOString(),
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

  const byId = new Map(schedule.map((c) => [c.id, c]))
  const applied = pending.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
  const skipped = pending.skipped.flatMap((s) => (byId.has(s.id) ? [{ change: byId.get(s.id)!, reason: s.reason }] : []))
  const startedAt = pending.startedAt ? new Date(pending.startedAt) : null
  // A roster changed since the run was recorded may already be in the new layout's terms.
  const untouchedSince = (updatedAt: Date) => !startedAt || updatedAt.getTime() <= startedAt.getTime()

  // 2b. BENCH the player in a starting spot that was taken away. Each team's move is decided from its lineup
  // as it stands, so a pass that repeats this finds nothing left to move.
  const benched: RosterScheduleRun['benched'] = []
  const benchFailures: RosterScheduleRun['benchFailures'] = []
  const owners = new Map<string, string>()
  /** Rosters this pass saved through the lineup engine: their seats are already the new layout's. */
  const seated = new Set<string>()
  if (applied.some((c) => rosterChangeMovesPlayers(c.kind)) && pending.seatsBefore.length > 0 && seatsAfter.length > 0) {
    const now = await prisma.league.findUnique({ where: { id: leagueId } })
    // A best ball league sets its own lineup from the layout: there is no saved starter to move.
    if (now && !lineupSetsItself(now)) {
      const capacities = resolveRedraftRosterConfig(sport, now.settings).starterCapacities
      const capacitiesBefore = resolveRedraftRosterConfig(sport, { roster: { config: { sections: [{ key: 'primary', slots: pending.slotsBefore }] } } }).starterCapacities
      const season = (await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { season: true } }))?.season ?? now.season
      const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true, updatedAt: true, redraftRosterId: true, platformUserId: true } })
      // Loaded here, where a player is about to be moved, and nowhere else: the lineup engine brings every
      // league format's rules with it, and the passes that move nobody (nearly all of them) do not need it.
      const { persistRosterLineupWithEngine } = await import('@/lib/roster-lineup-engine/lineupService')
      for (const roster of rosters) {
        const plan = planBenchForRemovedSeats({
          playerData: roster.playerData,
          sport,
          seatsBefore: pending.seatsBefore,
          seatsAfter,
          capacities,
          capacitiesBefore,
          trustSavedSeats: untouchedSince(roster.updatedAt),
        })
        if (!plan) continue
        if (season != null) await freezeWeekLineup({ leagueId, rosterId: roster.id, redraftRosterId: roster.redraftRosterId, season, week: pending.week - 1 })
        const saved = await persistRosterLineupWithEngine({
          leagueId,
          rosterId: roster.id,
          actorUserId: league.userId,
          nextPlayerData: plan.playerData,
          season: season ?? new Date().getFullYear(),
          week: pending.week,
          // The commissioner's own scheduled rule: it is not stopped by a roster lock or a move freeze.
          source: 'commissioner_override',
          skipLockCheck: true,
        })
        if (saved.ok) {
          seated.add(roster.id)
          benched.push({ rosterId: roster.id, players: plan.benched })
          if (roster.platformUserId) owners.set(roster.id, roster.platformUserId)
        } else {
          benchFailures.push({ rosterId: roster.id, error: saved.error })
        }
      }
    }
  }

  // 3. FINISH: seats, event, done, record cleared. All or nothing.
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
            if (seated.has(id)) continue
            await tx.$queryRaw`SELECT id FROM rosters WHERE id = ${id} FOR UPDATE`
            const roster = await tx.roster.findUnique({ where: { id }, select: { playerData: true, updatedAt: true } })
            if (!roster) continue
            // Untouched since the run was recorded: each saved seat follows its seat. Changed since (a
            // manager's save against the new layout, or this run's own save on an earlier pass): the saved
            // positions may be in either layout's terms, so they are dropped and the screen seats the lineup.
            const next = untouchedSince(roster.updatedAt) ? remapStarterSeats(roster.playerData, pending.seatsBefore, seatsAfter) : withoutStarterSeats(roster.playerData)
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
              benched,
              benchFailures,
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
    const moved = benched.length > 0 ? ' The player in a spot that was taken away moved to the bench.' : ''
    await post(`Roster change for week ${pending.week}: ${lines.join('; ')}. Every team now has ${describeLayout(pending.slots, spots)}.${moved} Check your lineup before the week locks.`)
    if (benchFailures.length > 0) {
      await post(`Commissioner: ${benchFailures.length === 1 ? 'one team still has' : `${benchFailures.length} teams still have`} a starter in a spot that was taken away, because the move could not be saved. Fix ${benchFailures.length === 1 ? 'that lineup' : 'those lineups'} in the roster tools before the week locks.`)
    }
    // Each manager whose player moved is told directly, once.
    for (const team of benched) {
      const userId = owners.get(team.rosterId)
      if (!userId) continue
      const names = team.players.map((p) => p.name).filter((n): n is string => Boolean(n))
      const who = names.length > 0 ? names.join(' and ') : team.players.length === 1 ? 'One of your starters' : `${team.players.length} of your starters`
      await dispatchNotification({
        userIds: [userId],
        category: 'league_announcements',
        type: 'guillotine_roster_change_benched',
        title: `Week ${pending.week} roster change`,
        body: `${who} moved to your bench: the league took away a starting spot this week. Set your lineup before it locks.`,
        actionHref: `/core/my-team?league=${encodeURIComponent(leagueId)}`,
        actionLabel: 'Open roster',
        leagueId,
        severity: 'medium',
        dedupePrefix: `guillotine-roster-change:${leagueId}:${team.rosterId}:${pending.week}`,
        meta: { week: pending.week, rosterId: team.rosterId, playerIds: team.players.map((p) => p.id) },
      }).catch((e) => console.warn('[roster-schedule] notification failed', e instanceof Error ? e.message : 'unknown error'))
    }
    await publishRuleChangesEvent({
      leagueId,
      actorUserId: league.userId,
      section: 'roster',
      changes: diffRuleSnapshots({ rosterSlots: normalizeRosterSlots(layoutNow) }, { rosterSlots: normalizeRosterSlots(pending.slots) }),
    })
  }
  return { week: pending.week, applied, skipped, slots: pending.slots, resumed: pending.resumed, benched, benchFailures }
}
