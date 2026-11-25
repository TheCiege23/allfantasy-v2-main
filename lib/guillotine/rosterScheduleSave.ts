import 'server-only'

import { prisma } from '@/lib/prisma'
import { FeatureGateService } from '@/lib/subscription/FeatureGateService'
import { getRosterEngineRegistry } from '@/lib/roster-engine'
import { DEFAULT_END_WEEK_BY_SPORT, getGuillotineConfig } from './GuillotineLeagueConfig'
import { resolveGuillotineCalendarWeek } from './guillotineCurrentWeek'
import { readRosterScheduleRan } from './rosterScheduleRan'
import {
  ROSTER_SCHEDULE_KEY,
  normalizeRosterSchedule,
  readRosterSchedule,
  readRosterScheduleState,
  rosterSpotsFromDefinitions,
  type RosterChange,
  type RosterScheduleError,
  type RosterScheduleView,
} from './rosterSchedule'

/**
 * Read and save a guillotine league's scheduled roster changes (rules in ./rosterSchedule.ts; the weekly run
 * that applies them in ./rosterScheduleApply.ts).
 *
 * AF Commissioner (`commissioner_automation`) to add or edit a change, the same feature as the chop schedule.
 * Removing one is always allowed, so a lapsed plan never leaves a league with a change it cannot cancel.
 * A change that has already run is history: it stays in the list, and a save can neither edit nor remove it.
 * Written under the league row lock, because League.settings is shared by every settings writer.
 */

export type { RosterScheduleView }

export async function readRosterScheduleView(leagueId: string): Promise<RosterScheduleView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true } })
  if (!league) return null
  const sport = String(league.sport ?? '').toUpperCase()
  const registry = getRosterEngineRegistry()
  const [config, calendarWeek] = await Promise.all([getGuillotineConfig(leagueId), resolveGuillotineCalendarWeek(leagueId)])
  const toWeek = config?.eliminationEndWeek ?? (DEFAULT_END_WEEK_BY_SPORT as Record<string, number | undefined>)[sport] ?? 18
  // Week 1 is played on the roster the league was set up with; the first week a change can land on is 2,
  // and once the season is running, the week after the one being played.
  const fromWeek = Math.max(2, (calendarWeek ?? 0) + 1)
  const changes = readRosterSchedule(league.settings)
  // What has run is read from the event log, not only from settings (./rosterScheduleApply.ts says why).
  const { done, skipped } = await readRosterScheduleRan(prisma, leagueId, league.settings)
  if (!registry.isSupported(sport)) {
    return { changes, done, skipped, layout: {}, spots: { starters: [], bench: { key: 'BN', label: 'Bench', shortLabel: 'BN', min: 0, max: 30 } }, fromWeek, toWeek, supported: false }
  }
  const service = registry.getService(sport)
  const layout = (await service.getConfig(leagueId)).slots
  return { changes, done, skipped, layout, spots: rosterSpotsFromDefinitions(service.getSlots(), layout), fromWeek, toWeek, supported: true }
}

export type SaveRosterScheduleError = RosterScheduleError | 'not_entitled' | 'not_found' | 'unsupported' | 'busy'

const same = (a: RosterChange, b: RosterChange) => a.week === b.week && a.kind === b.kind && a.slot === b.slot && a.count === b.count

export async function saveRosterSchedule(
  leagueId: string,
  userId: string,
  raw: unknown,
): Promise<{ ok: true; view: RosterScheduleView } | { ok: false; error: SaveRosterScheduleError; message: string }> {
  const current = await readRosterScheduleView(leagueId)
  if (!current) return { ok: false, error: 'not_found', message: 'League not found.' }
  if (!current.supported) return { ok: false, error: 'unsupported', message: 'Scheduled roster changes are not available for this sport yet.' }
  if (!Array.isArray(raw)) return { ok: false, error: 'bad_change', message: 'Send the roster changes as a list.' }

  const ran = new Set(current.done)
  const stored = new Map(current.changes.map((c) => [c.id, c]))
  // A change that has run is not the commissioner's to send back: whatever arrives under its id is ignored.
  const incoming = raw.filter((item) => !(item && typeof item === 'object' && ran.has(String((item as { id?: unknown }).id))))
  // A stored change sent back untouched keeps its week even if that week is now being played: it is waiting
  // for the weekly run, not being scheduled into the past.
  const untouched = new Set<string>()
  for (const item of incoming) {
    const x = (item ?? {}) as Partial<RosterChange>
    const before = typeof x.id === 'string' ? stored.get(x.id) : undefined
    if (before && same(before, { ...before, ...x, slot: x.slot ?? null } as RosterChange)) untouched.add(before.id)
  }
  const n = normalizeRosterSchedule(incoming, { layout: current.layout, spots: current.spots, fromWeek: current.fromWeek, toWeek: current.toWeek, anyWeekIds: untouched })
  if (!n.ok) return n

  // The plan is needed to ADD or EDIT a change. Removing one, or all of them, never is: a lapsed plan can always
  // cancel what it scheduled.
  const addsOrEdits = n.value.some((c) => !stored.has(c.id) || !same(stored.get(c.id)!, c))
  if (addsOrEdits) {
    const access = await new FeatureGateService().evaluateUserFeatureAccess(userId, 'commissioner_automation').catch(() => null)
    if (!access?.allowed) return { ok: false, error: 'not_entitled', message: 'Scheduled roster changes are part of AF Commissioner.' }
  }

  const written = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return 'not_found' as const
    const state = readRosterScheduleState(row.settings)
    // The weekly run has recorded a layout and is writing it. Its changes are about to become history.
    if (state.pending) return 'busy' as const
    const nowDone = new Set((await readRosterScheduleRan(tx, leagueId, row.settings)).done)
    const history = readRosterSchedule(row.settings).filter((c) => nowDone.has(c.id))
    const next = { ...((row.settings as Record<string, unknown> | null) ?? {}) }
    const list = [...history, ...n.value.filter((c) => !nowDone.has(c.id))]
    if (list.length === 0) delete next[ROSTER_SCHEDULE_KEY]
    else next[ROSTER_SCHEDULE_KEY] = list
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as object } })
    return 'ok' as const
  })
  if (written === 'not_found') return { ok: false, error: 'not_found', message: 'League not found.' }
  if (written === 'busy') return { ok: false, error: 'busy', message: 'AllFantasy is applying a roster change right now. Try again in a minute.' }
  const view = await readRosterScheduleView(leagueId)
  return view ? { ok: true, view } : { ok: false, error: 'not_found', message: 'League not found.' }
}
