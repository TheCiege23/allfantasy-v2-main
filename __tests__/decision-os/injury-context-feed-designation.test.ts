// @vitest-environment node
/**
 * 🛑 `resolveInjuryContext` — behind the lineup signal facts (`lineup/signalFacts.ts`) and the Decision OS
 * injury-enriched world — derived availability from `SportsPlayer.status`. On Sleeper's row that is the
 * ROSTER status ("Active", "Injured Reserve"), so an Out player read "Active" → 'available'; and a stray
 * 'out' that `PlayerStatusAggregator` stamped on a provider row (and never clears) read 'unavailable'
 * forever. The designation now comes from the injury FEED (`resolveCurrentInjuryDesignations`), matched
 * on the identity of the row found in the league's id space, with a roster status counted only when it is
 * Sleeper's own row and a season-scale absence.
 *
 * The prisma fake honours the `SportsPlayer` reads' `where` (the Sleeper-space read, then the provider
 * read) and returns the injury feed for the feed read, so the real port, row keying, feed matching and
 * staleness rules all run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  players: [] as Array<Record<string, unknown>>,
  feed: [] as Array<Record<string, unknown>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const matchesWhere = (row: Record<string, unknown>, where: Record<string, any>): boolean => {
    if (where.sport && row.sport !== where.sport) return false
    if (Array.isArray(where.OR)) {
      return where.OR.some((c: Record<string, any>) =>
        c.sleeperId ? c.sleeperId.in.includes(row.sleeperId) : c.externalId ? c.externalId.in.includes(row.externalId) : false,
      )
    }
    if (where.externalId?.in) {
      if (where.source?.not && row.source === where.source.not) return false
      return where.externalId.in.includes(row.externalId)
    }
    return false
  }
  return {
    prisma: {
      sportsPlayer: { findMany: vi.fn(async ({ where }: { where: Record<string, any> }) => db.players.filter((r) => matchesWhere(r, where))) },
      sportsInjury: { findMany: vi.fn(async () => db.feed) },
      league: { findUnique: vi.fn(async () => ({ season: 2026 })) },
    },
  }
})

import { resolveInjuryContext, resolveInjuryEnrichedCanonicalWorld, defaultInjuryEnrichedWorldDeps } from '@/lib/decision-os/world/injuryEnrichedWorld'
import { loadLineupSignalFacts } from '@/lib/decision-os/lineup/signalFacts'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)
const inDays = (d: number) => new Date(Date.now() + d * 24 * 3_600_000)

function sleeperRow(sleeperId: string, name: string, position: string, team: string, status: string | null) {
  return {
    sport: 'NFL',
    externalId: `sleeper:${sleeperId}`,
    sleeperId,
    source: 'sleeper',
    status,
    name,
    team,
    position,
    fetchedAt: hoursAgo(1),
    expiresAt: inDays(1),
    updatedAt: hoursAgo(1),
  }
}

function riRow(externalId: string, sleeperId: string | null, name: string, position: string, team: string, status: string | null) {
  return { ...sleeperRow(sleeperId ?? '', name, position, team, status), externalId, sleeperId, source: 'rolling_insights' }
}

function feed(over: Record<string, unknown>) {
  return {
    playerName: 'Nobody',
    status: 'Out',
    type: 'Hamstring',
    description: null,
    date: hoursAgo(20),
    week: 6,
    source: 'rolling_insights',
    fetchedAt: hoursAgo(1),
    team: null,
    position: null,
    ...over,
  }
}

beforeEach(() => {
  db.players = []
  db.feed = []
})

describe('resolveInjuryContext — the designation is the injury feed’s, never SportsPlayer.status', () => {
  it('🛑 an Out player whose Sleeper roster status reads "Active" is unavailable', async () => {
    db.players = [sleeperRow('9001', 'Ja’Marr Chase', 'WR', 'CIN', 'Active')]
    db.feed = [feed({ playerName: 'Ja’Marr Chase', team: 'Cincinnati Bengals', position: 'WR', status: 'Out' })]
    const res = await resolveInjuryContext('NFL', ['9001'])
    const ctx = res.byId.get('9001')!
    expect(ctx.status).toBe('Out')
    expect(ctx.availabilityCategory).toBe('unavailable')
    expect(ctx.resolved).toBe(true)
    expect(ctx.provenance.source).toBe('rolling_insights')
  })

  it('a Questionable feed designation is uncertain', async () => {
    db.players = [sleeperRow('9002', 'Tee Higgins', 'WR', 'CIN', 'Active')]
    db.feed = [feed({ playerName: 'Tee Higgins', team: 'Cincinnati Bengals', position: 'WR', status: 'Questionable' })]
    const ctx = (await resolveInjuryContext('NFL', ['9002'])).byId.get('9002')!
    expect(ctx.status).toBe('Questionable')
    expect(ctx.availabilityCategory).toBe('uncertain')
  })

  it("Sleeper's own season-scale roster absence counts when the feed has nothing", async () => {
    db.players = [sleeperRow('9003', 'On The Shelf', 'RB', 'DAL', 'Injured Reserve')]
    const ctx = (await resolveInjuryContext('NFL', ['9003'])).byId.get('9003')!
    expect(ctx.status).toBe('Injured Reserve')
    expect(ctx.availabilityCategory).toBe('unavailable')
    expect(ctx.provenance.source).toBe('sleeper_roster_status')
  })

  it.each([
    ['a stamped provider "out" (PlayerStatusAggregator, never cleared)', riRow('77001', '9020', 'Stamped Out', 'RB', 'DAL', 'out')],
    ['a Sleeper roster "Inactive"', sleeperRow('9004', 'Practice Body', 'RB', 'DAL', 'Inactive')],
    ['Rolling Insights "INACT"', riRow('77002', '9021', 'Roster Word', 'RB', 'DAL', 'INACT')],
  ])('%s is not a designation — no news, never "unavailable"', async (_label, row) => {
    db.players = [row]
    const id = row.sleeperId as string
    const ctx = (await resolveInjuryContext('NFL', [id])).byId.get(id)!
    expect(ctx.status).toBeNull()
    expect(ctx.availabilityCategory).toBe('unknown')
    expect(ctx.resolved).toBe(true)
    expect(ctx.uncertainty).toContain('no_current_injury_designation')
  })

  it('a stale game-day "Out" from last week is suppressed', async () => {
    db.players = [sleeperRow('9005', 'Last Week Out', 'RB', 'NYG', 'Active')]
    db.feed = [feed({ playerName: 'Last Week Out', team: 'New York Giants', position: 'RB', status: 'Out', date: hoursAgo(10 * 24) })]
    const ctx = (await resolveInjuryContext('NFL', ['9005'])).byId.get('9005')!
    expect(ctx.status).toBeNull()
    expect(ctx.availabilityCategory).toBe('unknown')
  })

  it('🛑 Sleeper 8394 (Percy Butler) is asked about as Percy Butler — never Rome Odunze, RI 8394', async () => {
    db.players = [
      riRow('8394', '11621', 'Rome Odunze', 'WR', 'CHI', 'INACT'),
      sleeperRow('8394', 'Percy Butler', 'S', 'WAS', 'Active'),
    ]
    db.feed = [feed({ playerName: 'Rome Odunze', team: 'Chicago Bears', position: 'WR', status: 'Out' })]
    const res = await resolveInjuryContext('NFL', ['8394'])
    expect(res.byId.get('8394')?.status).toBeNull()
    expect(res.byId.get('8394')?.availabilityCategory).toBe('unknown')
  })

  it('an id with no row is unresolved, not healthy', async () => {
    const res = await resolveInjuryContext('NFL', ['404404'])
    expect(res.byId.get('404404')?.resolved).toBe(false)
    expect(res.unresolvedIds).toEqual(['404404'])
  })
})

describe('the consumers', () => {
  it('🛑 lineup signal facts flag an Out starter whose roster status reads "Active"', async () => {
    db.players = [sleeperRow('9001', 'Ja’Marr Chase', 'WR', 'CIN', 'Active'), sleeperRow('9010', 'Healthy Guy', 'RB', 'CIN', 'Active')]
    db.feed = [feed({ playerName: 'Ja’Marr Chase', team: 'Cincinnati Bengals', position: 'WR', status: 'Out' })]
    const facts = await loadLineupSignalFacts({
      leagueId: 'lg',
      sport: 'NFL',
      week: 6,
      players: [
        { playerId: '9001', playerName: 'Ja’Marr Chase', team: 'CIN' },
        { playerId: '9010', playerName: 'Healthy Guy', team: 'CIN' },
      ],
    })
    expect(facts.injury?.flagged).toEqual([
      { playerId: '9001', playerName: 'Ja’Marr Chase', status: 'Out', availabilityCategory: 'unavailable' },
    ])
    expect(facts.injury?.resolvedCount).toBe(2)
  })

  it('🛑 the injury-enriched world counts an Out player as unavailable', async () => {
    db.players = [sleeperRow('9001', 'Ja’Marr Chase', 'WR', 'CIN', 'Active')]
    db.feed = [feed({ playerName: 'Ja’Marr Chase', team: 'Cincinnati Bengals', position: 'WR', status: 'Out' })]
    const world = {
      league: { sport: 'NFL' },
      rosters: [{ rosterId: 'r1', players: [{ playerId: '9001', name: 'Ja’Marr Chase', position: 'WR', team: 'CIN' }] }],
    }
    const out = await resolveInjuryEnrichedCanonicalWorld('lg', {
      ...defaultInjuryEnrichedWorldDeps,
      resolveEnrichedWorld: async () => world as never,
    })
    expect(out?.injurySummary.unavailablePlayers).toBe(1)
    expect(out?.rosters[0].players[0].injuryContext.status).toBe('Out')
  })
})
