/**
 * Live-state locks for the legacy Devy / C2C settings PATCH routes. Each answers "would this edit
 * break something already in play?" from the tables the engines read — never from the record
 * being edited.
 */
import { prisma } from '@/lib/prisma'

export type SlotConflict = { field: string; held: number; requested: number }

/** Largest per-team count among `rows`, optionally filtered. */
export function maxPerRoster<T extends { rosterId: string }>(rows: T[], keep: (r: T) => boolean = () => true): number {
  const counts = new Map<string, number>()
  for (const r of rows) {
    if (!keep(r)) continue
    counts.set(r.rosterId, (counts.get(r.rosterId) ?? 0) + 1)
  }
  let max = 0
  for (const n of counts.values()) if (n > max) max = n
  return max
}

/**
 * The league's startup draft has started: a LIVE draft session that has ever left `pre_draft`.
 * A dynasty league's first draft is its startup draft, and a completed imported-rosters snapshot
 * counts too — the startup rosters already exist. Mock drafts never count.
 */
export async function startupDraftHasStarted(leagueId: string): Promise<boolean> {
  const n = await prisma.draftSession.count({
    where: {
      leagueId,
      sessionKind: 'live',
      OR: [{ startedAt: { not: null } }, { status: { in: ['in_progress', 'paused', 'completed'] } }],
    },
  })
  return n > 0
}

/** A live draft is running right now (in progress or paused). */
export async function draftIsRunning(leagueId: string): Promise<boolean> {
  const n = await prisma.draftSession.count({
    where: { leagueId, sessionKind: 'live', status: { in: ['in_progress', 'paused'] } },
  })
  return n > 0
}

/**
 * Some season's pick rows are part used and part unused: that season's draft is under way.
 * Rows come from `devy_draft_picks` or `c2c_draft_picks`.
 */
export function seasonDraftUnderWay(rows: Array<{ season: number; isUsed: boolean }>): boolean {
  const seen = new Map<number, { used: boolean; open: boolean }>()
  for (const r of rows) {
    const s = seen.get(r.season) ?? { used: false, open: false }
    if (r.isUsed) s.used = true
    else s.open = true
    seen.set(r.season, s)
  }
  for (const s of seen.values()) if (s.used && s.open) return true
  return false
}
