import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadOwnerLastActions } from '@/lib/commissioner-hub/ownerLastAction'
import type { InactiveFlagTally } from '@/lib/commissioner-hub/inactiveFlagView'

/**
 * The commissioner's "inactive manager" flag, graded (2026-11-20).
 *
 * The manager table (`managerHealth.ts`) calls a NATIVE league's manager inactive after 14 days with nothing
 * of their own (`ownerLastAction.ts`). That is a prediction — "this team needs a hand" — and like every
 * other call AllFantasy makes it is now checked against what happened: two weeks after the flag, did the
 * manager do something of their own again (`came_back`), or not (`stayed_away`)? The share that stayed away
 * is how often the flag was right, and it is shown under the table once enough flags are graded.
 *
 * ⚠ ONE ROW PER STRETCH, NOT PER VIEW. A stretch is keyed by (league, roster, the last action it was idle
 * FROM): re-showing the same flag writes nothing, and a manager who returns and goes quiet again opens a new
 * stretch. The record is in `commissioner_inactive_flags` (migration 20261120030000).
 *
 * ⚠ RAW SQL, AND A MISSING TABLE IS "NOTHING RECORDED". The table arrives by migration; until it is applied
 * every read and write here is a no-op rather than an error, and the manager table it hangs off is never
 * slowed or broken by it. (Raw SQL also keeps this off a generated client that may not know the model.)
 *
 * IMPORTED LEAGUES ARE NOT RECORDED: their flag reads a synced timestamp, not the manager's own actions, and
 * grading it would measure the sync.
 */

export const INACTIVE_FLAG_GRADE_AFTER_MS = 14 * 86_400_000
/** How far back the shown record reaches. */
export const INACTIVE_FLAG_RECORD_WINDOW_MS = 365 * 86_400_000
const MAX_GRADED_PER_RUN = 500

export type InactiveFlagOutcome = 'came_back' | 'stayed_away'

/** PURE. Did the manager act on their own after the action the flag was idle from? */
export function inactiveFlagOutcome(idleFrom: Date, latestOwnAction: Date | null): InactiveFlagOutcome {
  return latestOwnAction && latestOwnAction.getTime() > idleFrom.getTime() ? 'came_back' : 'stayed_away'
}

/** Only "the table is not there yet". A raw query's generic P2010 is NOT that unless Postgres says 42P01. */
const tableMissing = (err: unknown): boolean => {
  const e = err as { code?: unknown; meta?: { code?: unknown } } | null
  const code = String(e?.code ?? '')
  return code === 'P2021' || code === '42P01' || String(e?.meta?.code ?? '') === '42P01'
}

/**
 * Record the stretches a native league's table is showing as inactive. Idempotent; never throws.
 * `rows` are the table's own rows, so what is recorded is exactly what the commissioner was shown.
 */
export async function recordInactiveFlags(
  leagueId: string,
  rows: ReadonlyArray<{ rosterId: string; status: string; lastActionAt: string | null }>,
): Promise<number> {
  const flagged = rows.filter((r) => r.status === 'inactive' && r.lastActionAt && Number.isFinite(Date.parse(r.lastActionAt)))
  if (!leagueId || flagged.length === 0) return 0
  try {
    const values = flagged.map((r) => Prisma.sql`(${randomUUID()}, ${leagueId}, ${r.rosterId}, ${new Date(r.lastActionAt!)})`)
    return await prisma.$executeRaw`
      INSERT INTO commissioner_inactive_flags ("id", "leagueId", "rosterId", "lastActionAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("leagueId", "rosterId", "lastActionAt") DO NOTHING`
  } catch {
    return 0
  }
}

/**
 * Grade every open stretch at least two weeks old, then tally the record. Called by the outcome rebuild
 * (`lib/chimmy-outcomes/adviceLearning.ts`) every six hours, so a flag is graded within six hours of its
 * fortnight. Null when the table is not there yet; any other failure is the caller's to see.
 */
export async function gradeInactiveFlags(now: Date = new Date()): Promise<InactiveFlagTally | null> {
  try {
    const due = await prisma.$queryRaw<Array<{ id: string; leagueId: string; rosterId: string; lastActionAt: Date }>>`
      SELECT "id", "leagueId", "rosterId", "lastActionAt" FROM commissioner_inactive_flags
      WHERE "outcome" IS NULL AND "flaggedAt" <= ${new Date(now.getTime() - INACTIVE_FLAG_GRADE_AFTER_MS)}
      ORDER BY "flaggedAt" ASC
      LIMIT ${MAX_GRADED_PER_RUN}`

    if (due.length) {
      const rosters = await prisma.roster.findMany({
        where: { id: { in: [...new Set(due.map((d) => d.rosterId))] } },
        select: { id: true, leagueId: true, platformUserId: true, managerUserId: true, redraftRosterId: true },
      })
      const own = await loadOwnerLastActions(rosters.map((r) => ({ ...r, platformUserId: r.platformUserId ?? null })))
      const known = new Set(rosters.map((r) => r.id))
      // A roster that no longer exists cannot be graded either way; it is closed and left out of the record.
      const graded = due.map((d) => ({ id: d.id, outcome: known.has(d.rosterId) ? inactiveFlagOutcome(new Date(d.lastActionAt), own.get(d.rosterId) ?? null) : 'gone' }))
      const values = graded.map((g) => Prisma.sql`(${g.id}, ${g.outcome})`)
      await prisma.$executeRaw`
        UPDATE commissioner_inactive_flags AS f SET "outcome" = v.outcome, "gradedAt" = ${now}
        FROM (VALUES ${Prisma.join(values)}) AS v(id, outcome)
        WHERE f."id" = v.id AND f."outcome" IS NULL`
    }

    const counts = await prisma.$queryRaw<Array<{ outcome: string | null; n: bigint | number }>>`
      SELECT "outcome", COUNT(*) AS n FROM commissioner_inactive_flags
      WHERE "flaggedAt" >= ${new Date(now.getTime() - INACTIVE_FLAG_RECORD_WINDOW_MS)}
      GROUP BY "outcome"`
    const n = (o: string | null) => Number(counts.find((c) => c.outcome === o)?.n ?? 0)
    return { graded: n('came_back') + n('stayed_away'), stayedAway: n('stayed_away'), pending: n(null) }
  } catch (err) {
    if (tableMissing(err)) return null
    throw err
  }
}
