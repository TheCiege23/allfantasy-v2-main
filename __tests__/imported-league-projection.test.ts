/**
 * League coverage for imported leagues.
 *
 * WHY THIS EXISTS
 * `intelligence_league_snapshot` is fed by exactly one thing — the domain-event consumer — and
 * `getPlatformEvents()`, "the ONE way business code emits catalog events", is called almost entirely
 * from `lib/redraft/*`, the NATIVE product. Production measured 2026-08-24: **56 sleeper leagues,
 * 23 manual, 18 test seed, 1 native.** So league intelligence described a product nobody uses:
 * 29 snapshots, max 6 events, none with 10 or more.
 *
 * The same imported activity already reaches `intelligence_manager_snapshot` (677 rows) through
 * `projectImportedManagerSnapshots`. The manager half was written; the league half never was.
 *
 * WHAT IS PINNED
 *   1. THE MAPPING IS NARROW ON PURPOSE. `categorize()` defines `lineupCount` as `roster.lineup*` —
 *      lineup SETS. An imported `roster_move` is an add/drop. Writing 2,512 roster moves into
 *      `lineupCount` would fabricate an input the model cannot know is fabricated — the identical
 *      failure to the waiver heartbeats that claimed 687 waiver events when the truth was zero.
 *   2. NATIVE LEAGUES ARE NEVER TOUCHED, and the test is the SOURCE (`domain_events`), not "does a
 *      snapshot exist" — the latter cannot tell native data from this projection's own prior writes.
 *   3. RE-RUNS CONVERGE. Absolute tallies, never increments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  tallyLeaguesFromImportedActivity,
  projectImportedLeagueSnapshots,
} from '@/lib/intelligence/projections/importedLeagueProjection'

function row(leagueId: string | null, activityType: string, occurredAt: Date | null = new Date(1_000)) {
  return { afLeagueId: leagueId, activityType, occurredAt }
}

describe('tallyLeaguesFromImportedActivity', () => {
  it('routes roster moves to otherCount, never to lineupCount', () => {
    const [t] = tallyLeaguesFromImportedActivity([
      row('L1', 'roster_move'), row('L1', 'roster_move'), row('L1', 'trade'),
    ])
    // The care point. lineupCount has no honest value here, so the tally must not produce one.
    expect(t!.otherCount).toBe(2)
    expect(t!.tradeCount).toBe(1)
    expect(t).not.toHaveProperty('lineupCount')
  })

  it('counts trades, waivers and draft picks into their real columns', () => {
    const [t] = tallyLeaguesFromImportedActivity([
      row('L1', 'trade'), row('L1', 'waiver'), row('L1', 'waiver'), row('L1', 'draft_pick'),
    ])
    expect(t!.tradeCount).toBe(1)
    expect(t!.waiverCount).toBe(2)
    expect(t!.draftCount).toBe(1)
    expect(t!.totalEvents).toBe(4)
  })

  it('tracks first and last activity, and per-kind recency', () => {
    const early = new Date(1_000)
    const late = new Date(9_000)
    const [t] = tallyLeaguesFromImportedActivity([
      row('L1', 'trade', early), row('L1', 'trade', late), row('L1', 'waiver', early),
    ])
    expect(t!.firstEventAt).toEqual(early)
    expect(t!.lastActivityAt).toEqual(late)
    expect(t!.lastTradeAt).toEqual(late)
    expect(t!.lastWaiverAt).toEqual(early)
  })

  it('drops rows with no league id rather than inventing a bucket', () => {
    const out = tallyLeaguesFromImportedActivity([row(null, 'trade'), row('L1', 'trade')])
    expect(out).toHaveLength(1)
    expect(out[0]!.leagueId).toBe('L1')
  })

  it('separates leagues', () => {
    const out = tallyLeaguesFromImportedActivity([row('L1', 'trade'), row('L2', 'waiver')])
    expect(out.map((t) => t.leagueId).sort()).toEqual(['L1', 'L2'])
  })
})

describe('projectImportedLeagueSnapshots', () => {
  const findMany = vi.fn()
  const count = vi.fn()
  const upsert = vi.fn(async () => ({}))
  const prisma = {
    decisionOsImportedActivity: { findMany },
    domainEvent: { count },
    intelligenceLeagueSnapshot: { upsert },
  } as never

  beforeEach(() => {
    vi.clearAllMocks()
    count.mockResolvedValue(0)
    upsert.mockResolvedValue({})
  })

  it('writes a snapshot for an imported league with no native events', async () => {
    findMany.mockResolvedValue([row('L1', 'trade'), row('L1', 'roster_move')])

    const r = await projectImportedLeagueSnapshots(prisma)

    expect(r.leaguesWritten).toBe(1)
    const arg = upsert.mock.calls[0]![0] as { create: Record<string, number> }
    expect(arg.create.tradeCount).toBe(1)
    expect(arg.create.otherCount).toBe(1)
    // Honestly zero: imported activity carries no lineup-set signal at all.
    expect(arg.create.lineupCount).toBe(0)
  })

  it('never touches a league that has native domain events', async () => {
    findMany.mockResolvedValue([row('L1', 'trade')])
    count.mockResolvedValue(5) // native league

    const r = await projectImportedLeagueSnapshots(prisma)

    expect(r.leaguesSkippedNative).toBe(1)
    expect(r.leaguesWritten).toBe(0)
    // Native is first-party and authoritative; provider history would be a downgrade.
    expect(upsert).not.toHaveBeenCalled()
  })

  it('checks the SOURCE, so a second run still updates its own earlier writes', async () => {
    findMany.mockResolvedValue([row('L1', 'trade')])
    await projectImportedLeagueSnapshots(prisma)
    await projectImportedLeagueSnapshots(prisma)

    // The manager projection asks "does a snapshot exist", which after its first run skips that
    // league forever and lets its counts drift from reality. Asking domain_events instead stays
    // re-runnable while still protecting native data.
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(count).toHaveBeenCalledWith({ where: { leagueId: 'L1' } })
  })

  it('upserts absolute values so re-runs converge instead of inflating', async () => {
    findMany.mockResolvedValue([row('L1', 'trade'), row('L1', 'trade')])
    await projectImportedLeagueSnapshots(prisma)

    const arg = upsert.mock.calls[0]![0] as { update: Record<string, number> }
    expect(arg.update.tradeCount).toBe(2)
    expect(arg.update.totalEvents).toBe(2)
  })

  it('refuses honestly when the delegate is absent', async () => {
    const r = await projectImportedLeagueSnapshots({} as never)
    expect(r).toEqual({ leaguesConsidered: 0, leaguesSkippedNative: 0, leaguesWritten: 0, rowsRead: 0 })
  })
})
