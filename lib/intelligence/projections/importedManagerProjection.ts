import type { PrismaClient } from '@prisma/client'

/**
 * Manager coverage for IMPORTED leagues.
 *
 * `applyManagerSnapshot` only writes a row when a `DomainEvent` carries `actor.type` of user or
 * commissioner AND an `actorId` AND a `leagueId`. Measured on production 2026-08-20: of 7,845
 * events, **26** carried a user actor — and **24 of those were `auth.user.registered`, which has no
 * leagueId**. That left two league-scoped user events, from a single trade, and therefore exactly
 * **ONE** `intelligence_manager_snapshot` row in all of production.
 *
 * `IntelligenceQueryService.ManagerActivitySnapshot` reads that table, and it feeds Chimmy's
 * grounding and the StoryEngine — so those surfaces were being grounded on one manager.
 *
 * The managers exist. `decision_os_imported_activity` holds 6,436 rows across 42 leagues and every
 * row carries `normalized.managerKeys` — **403 distinct managers**. This projects them.
 *
 * ⚠ WHY THIS IS A SEPARATE PROJECTION rather than a change to `applyManagerSnapshot`: that function
 * is driven by the domain-event stream and must stay that way. Imported activity is replayed
 * provider history, not in-app behaviour, and its manager ids are frequently EXTERNAL
 * (`sleeper:<id>`) rather than AllFantasy users. Merging the two paths would blur a distinction the
 * consumers need.
 */

/** A manager key that came from the provider rather than an AllFantasy account. */
export function isExternalManagerKey(key: string): boolean {
  return key.includes(':')
}

type Row = {
  afLeagueId: string | null
  activityType: string | null
  occurredAt: Date | null
  normalized: unknown
}

export type ManagerTally = {
  leagueId: string
  managerKey: string
  lastActiveAt: Date | null
  totalActions: number
  tradeActions: number
  waiverActions: number
  lineupActions: number
  otherActions: number
}

function managerKeysOf(normalized: unknown): string[] {
  const raw = (normalized as { managerKeys?: unknown } | null | undefined)?.managerKeys
  if (!Array.isArray(raw)) return []
  return raw.filter((k): k is string => typeof k === 'string' && k.length > 0)
}

/**
 * Pure: fold imported-activity rows into one tally per (league, manager).
 *
 * A `roster_move` counts as `lineupActions` here — that is the closest existing column, and it is
 * the SAME mapping `MANAGER_ACTION_COL` already applies to native roster events, so the two paths
 * stay comparable. (The league-level evidence packet keeps roster moves in their own bucket
 * because there it sits beside a native `lineupCount` that means something narrower; here there is
 * no such neighbour to be confused with.)
 */
export function tallyManagersFromImportedActivity(rows: readonly Row[]): ManagerTally[] {
  const byKey = new Map<string, ManagerTally>()

  for (const row of rows) {
    if (!row.afLeagueId) continue // unlinked row — cannot attribute it to a league
    for (const managerKey of managerKeysOf(row.normalized)) {
      const id = `${row.afLeagueId}\u0000${managerKey}`
      let t = byKey.get(id)
      if (!t) {
        t = {
          leagueId: row.afLeagueId, managerKey, lastActiveAt: null,
          totalActions: 0, tradeActions: 0, waiverActions: 0, lineupActions: 0, otherActions: 0,
        }
        byKey.set(id, t)
      }
      t.totalActions += 1
      switch (row.activityType) {
        case 'trade': t.tradeActions += 1; break
        case 'waiver': t.waiverActions += 1; break
        case 'roster_move': t.lineupActions += 1; break
        default: t.otherActions += 1 // includes draft_pick — no dedicated column exists
      }
      if (row.occurredAt && (!t.lastActiveAt || row.occurredAt > t.lastActiveAt)) {
        t.lastActiveAt = row.occurredAt
      }
    }
  }

  return [...byKey.values()]
}

export type ProjectResult = {
  leaguesConsidered: number
  leaguesSkippedNative: number
  managersWritten: number
  rowsRead: number
}

/**
 * Project imported activity into `intelligence_manager_snapshot`.
 *
 * IDEMPOTENT: each (league, manager) is upserted to an absolute tally recomputed from source, never
 * incremented. Re-running converges on the same state rather than inflating counts — the failure
 * that made the event store 98.8% noise.
 *
 * A league that already has NATIVE manager snapshots is skipped entirely. Native is first-party and
 * authoritative; overwriting it with provider history would be a downgrade, and mixing the two
 * inside one league would make the counts mean nothing.
 */
export async function projectImportedManagerSnapshots(
  prisma: PrismaClient,
  opts: { leagueIds?: string[]; limitLeagues?: number } = {},
): Promise<ProjectResult> {
  const delegate = (prisma as unknown as {
    decisionOsImportedActivity?: { findMany(args: unknown): Promise<Row[]> }
  }).decisionOsImportedActivity
  // Honest refusal: without the generated delegate this environment cannot read imported activity.
  if (!delegate) return { leaguesConsidered: 0, leaguesSkippedNative: 0, managersWritten: 0, rowsRead: 0 }

  const rows = await delegate.findMany({
    where: opts.leagueIds?.length ? { afLeagueId: { in: opts.leagueIds } } : { afLeagueId: { not: null } },
    select: { afLeagueId: true, activityType: true, occurredAt: true, normalized: true },
  })

  const tallies = tallyManagersFromImportedActivity(rows)
  const leagueIds = [...new Set(tallies.map((t) => t.leagueId))].slice(0, opts.limitLeagues ?? Number.MAX_SAFE_INTEGER)

  let managersWritten = 0
  let leaguesSkippedNative = 0

  for (const leagueId of leagueIds) {
    // Skip any league that already has native manager snapshots — see the note above.
    const nativeCount = await prisma.intelligenceManagerSnapshot.count({ where: { leagueId } })
    if (nativeCount > 0) { leaguesSkippedNative += 1; continue }

    for (const t of tallies.filter((x) => x.leagueId === leagueId)) {
      const values = {
        lastActiveAt: t.lastActiveAt,
        totalActions: t.totalActions,
        tradeActions: t.tradeActions,
        waiverActions: t.waiverActions,
        lineupActions: t.lineupActions,
        otherActions: t.otherActions,
      }
      await prisma.intelligenceManagerSnapshot.upsert({
        where: { leagueId_managerKey: { leagueId: t.leagueId, managerKey: t.managerKey } },
        create: { leagueId: t.leagueId, managerKey: t.managerKey, ...values },
        // Absolute values, NOT increments — that is what makes a re-run idempotent.
        update: values,
      })
      managersWritten += 1
    }
  }

  return {
    leaguesConsidered: leagueIds.length,
    leaguesSkippedNative,
    managersWritten,
    rowsRead: rows.length,
  }
}
