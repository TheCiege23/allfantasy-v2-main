import type { PrismaClient } from '@prisma/client'

/**
 * League coverage for IMPORTED leagues.
 *
 * `intelligence_league_snapshot` is fed by exactly one thing: `createIntelligenceSnapshotConsumer`,
 * draining `domain_events`. And `getPlatformEvents()` — documented as the ONE way business code
 * emits catalog events — is called almost entirely from `lib/redraft/*`, the NATIVE product.
 *
 * Production is not native. Measured 2026-08-24: 56 sleeper leagues, 23 manual, 18 test seed, and
 * **1 native**. So the league-intelligence table describes a product almost nobody is using:
 * 29 snapshots, a maximum of 6 events each, and not one with 10 or more.
 *
 * Meanwhile the imported leagues are busy. `decision_os_imported_activity` holds **8,262 rows
 * across 50 leagues**, every row carrying `afLeagueId`. That activity already reaches
 * `intelligence_manager_snapshot` through `projectImportedManagerSnapshots` — which is why manager
 * coverage is 677 rows while league coverage sat at 29. The manager half was written; the league
 * half never was. This is the league half.
 *
 * ⚠ WHY A SEPARATE PROJECTION rather than emitting domain events from the import path: the same
 * reason the manager projection is separate. Imported activity is replayed provider history, not
 * in-app behaviour, and merging it into the event stream would blur a distinction the consumers
 * need — and would put thousands of backfilled rows through an outbox built for live events.
 */

type Row = {
  afLeagueId: string | null
  activityType: string | null
  occurredAt: Date | null
}

export type LeagueTally = {
  leagueId: string
  firstEventAt: Date | null
  lastActivityAt: Date | null
  totalEvents: number
  tradeCount: number
  waiverCount: number
  draftCount: number
  /** Roster moves and anything unrecognised. See the mapping note on `tallyLeagues…`. */
  otherCount: number
  lastTradeAt: Date | null
  lastWaiverAt: Date | null
  lastDraftAt: Date | null
}

/**
 * Pure: fold imported-activity rows into one tally per league.
 *
 * ⚠ THE MAPPING IS DELIBERATELY NARROWER THAN THE MANAGER ONE, AND THIS IS THE WHOLE CARE POINT.
 *
 * `categorize()` defines what each column MEANS for native events: `lineupCount` counts
 * `roster.lineup*` — lineup SETS. An imported `roster_move` is an add/drop, which is not a lineup
 * set. Writing roster moves into `lineupCount` would tell the Decision OS evidence packet a league
 * sets its lineup 2,512 times when the true number is unknown and probably zero.
 *
 * That is precisely the failure already documented one file over: `transaction.waiver.window_processed`
 * heartbeats incremented `waiverCount` and told a model a league had 687 waiver events when the real
 * number was zero — "a fabricated input, and the model cannot know it is fabricated."
 *
 * So roster moves go to `otherCount`, and `lineupCount` stays 0 for imported leagues. Zero is the
 * honest answer: we have no lineup-set data for them.
 *
 * (The manager tally maps `roster_move` to `lineupActions` on purpose — there it is the closest
 * existing column and has no native neighbour to be confused with. Here it does.)
 */
export function tallyLeaguesFromImportedActivity(rows: readonly Row[]): LeagueTally[] {
  const byLeague = new Map<string, LeagueTally>()

  for (const row of rows) {
    if (!row.afLeagueId) continue // unlinked row — cannot attribute it to a league
    let t = byLeague.get(row.afLeagueId)
    if (!t) {
      t = {
        leagueId: row.afLeagueId,
        firstEventAt: null, lastActivityAt: null, totalEvents: 0,
        tradeCount: 0, waiverCount: 0, draftCount: 0, otherCount: 0,
        lastTradeAt: null, lastWaiverAt: null, lastDraftAt: null,
      }
      byLeague.set(row.afLeagueId, t)
    }

    t.totalEvents += 1
    const at = row.occurredAt
    switch (row.activityType) {
      case 'trade':
        t.tradeCount += 1
        if (at && (!t.lastTradeAt || at > t.lastTradeAt)) t.lastTradeAt = at
        break
      case 'waiver':
        t.waiverCount += 1
        if (at && (!t.lastWaiverAt || at > t.lastWaiverAt)) t.lastWaiverAt = at
        break
      case 'draft_pick':
        t.draftCount += 1
        if (at && (!t.lastDraftAt || at > t.lastDraftAt)) t.lastDraftAt = at
        break
      default:
        // roster_move lands here on purpose — it is not a lineup set. See the note above.
        t.otherCount += 1
    }

    if (at) {
      if (!t.firstEventAt || at < t.firstEventAt) t.firstEventAt = at
      if (!t.lastActivityAt || at > t.lastActivityAt) t.lastActivityAt = at
    }
  }

  return [...byLeague.values()]
}

export type ProjectLeagueResult = {
  leaguesConsidered: number
  leaguesSkippedNative: number
  leaguesWritten: number
  rowsRead: number
}

/**
 * Project imported activity into `intelligence_league_snapshot`.
 *
 * IDEMPOTENT: each league is upserted to an absolute tally recomputed from source, never
 * incremented. Re-running converges rather than inflating — the failure that made the event store
 * 98.8% noise.
 *
 * ⚠ NATIVE LEAGUES ARE SKIPPED, AND THE TEST IS `domain_events`, NOT "does a snapshot exist".
 *
 * The manager projection asks whether snapshot rows already exist, which cannot distinguish native
 * data from its OWN previous writes — so after its first run it skips that league forever and its
 * counts stop tracking reality. Checking the SOURCE instead is both safer and re-runnable: a league
 * with zero domain events can have no native snapshot, so anything there is ours to update; a league
 * with any domain events is first-party and is never touched.
 */
export async function projectImportedLeagueSnapshots(
  prisma: PrismaClient,
  opts: { leagueIds?: string[]; limitLeagues?: number } = {},
): Promise<ProjectLeagueResult> {
  const delegate = (prisma as unknown as {
    decisionOsImportedActivity?: { findMany(args: unknown): Promise<Row[]> }
  }).decisionOsImportedActivity
  // Honest refusal: without the generated delegate this environment cannot read imported activity.
  if (!delegate) {
    return { leaguesConsidered: 0, leaguesSkippedNative: 0, leaguesWritten: 0, rowsRead: 0 }
  }

  const rows = await delegate.findMany({
    where: opts.leagueIds?.length
      ? { afLeagueId: { in: opts.leagueIds } }
      : { afLeagueId: { not: null } },
    select: { afLeagueId: true, activityType: true, occurredAt: true },
  })

  const tallies = tallyLeaguesFromImportedActivity(rows)
    .slice(0, opts.limitLeagues ?? Number.MAX_SAFE_INTEGER)

  let leaguesWritten = 0
  let leaguesSkippedNative = 0

  for (const t of tallies) {
    const nativeEvents = await prisma.domainEvent.count({ where: { leagueId: t.leagueId } })
    if (nativeEvents > 0) {
      leaguesSkippedNative += 1
      continue
    }

    const values = {
      firstEventAt: t.firstEventAt,
      lastActivityAt: t.lastActivityAt,
      totalEvents: t.totalEvents,
      tradeCount: t.tradeCount,
      waiverCount: t.waiverCount,
      draftCount: t.draftCount,
      otherCount: t.otherCount,
      lastTradeAt: t.lastTradeAt,
      lastWaiverAt: t.lastWaiverAt,
      lastDraftAt: t.lastDraftAt,
      // Left at 0 deliberately: imported activity carries no lineup-set, scoring or governance
      // signal, and a fabricated count is worse than an absent one.
      lineupCount: 0,
      scoringCount: 0,
      governanceCount: 0,
      lifecycleCount: 0,
    }

    await prisma.intelligenceLeagueSnapshot.upsert({
      where: { leagueId: t.leagueId },
      create: { leagueId: t.leagueId, ...values },
      // Absolute values, NOT increments — that is what makes a re-run idempotent.
      update: values,
    })
    leaguesWritten += 1
  }

  return {
    leaguesConsidered: tallies.length,
    leaguesSkippedNative,
    leaguesWritten,
    rowsRead: rows.length,
  }
}
