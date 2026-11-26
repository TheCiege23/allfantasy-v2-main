import type { Prisma } from '@prisma/client'
import { readRosterScheduleState } from './rosterSchedule'

/**
 * Which scheduled roster changes have run: read from the guillotine event log, not only from League.settings.
 *
 * League.settings is one JSON value that many writers read, change and write back whole, so a writer holding
 * an older copy can erase a finished run's "done" (./rosterScheduleApply.ts tells how that was found). The
 * `roster_change` event is written in the same transaction as the run's finish, in an append-only table no
 * settings writer touches. A change named in an event has run, whatever settings says.
 *
 * Its own small file so the rules page's read and save do not import the weekly run, which loads the lineup
 * engine.
 */

type Db = Pick<Prisma.TransactionClient, 'guillotineEventLog'>
export type RosterScheduleRan = { done: string[]; skipped: Array<{ id: string; reason: string }> }

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Every change a `roster_change` event names. */
export async function rosterChangesInEventLog(db: Db, leagueId: string): Promise<RosterScheduleRan> {
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
export async function readRosterScheduleRan(db: Db, leagueId: string, settings: unknown): Promise<RosterScheduleRan> {
  const state = readRosterScheduleState(settings)
  const logged = await rosterChangesInEventLog(db, leagueId)
  const skipped = new Map([...state.skipped, ...logged.skipped].map((s) => [s.id, s]))
  return { done: [...new Set([...state.done, ...logged.done])], skipped: [...skipped.values()] }
}
