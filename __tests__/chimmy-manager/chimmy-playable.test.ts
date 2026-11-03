/**
 * Without the league owner's AF Commissioner plan, Chimmy PLAYS only its free team — the one handed
 * over first — in the draft, the auction, Tribal Council and Exile. The others stay switched on for
 * when the plan returns; with the plan, every team Chimmy runs plays.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ hasPlan: false, resolves: 0, owner: 'owner-1' as string | null, settings: {} as Record<string, unknown>, rosterOwner: 'orphan-r2' }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    async resolveForUser() {
      h.resolves++
      return { hasAccess: h.hasPlan }
    }
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async (q: { select: Record<string, boolean> }) => (q.select.userId && !q.select.settings ? { userId: h.owner } : { settings: h.settings, userId: h.owner })) },
    roster: { findUnique: vi.fn(async () => ({ platformUserId: h.rosterOwner })) },
    liveDraftAutopickPreference: { findUnique: vi.fn(async () => null) },
  },
}))

import { playableManagedLineups, type ManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { CHIMMY_PLAN_CACHE_MS, readPlayableChimmyLineups, resetChimmyPlanCache } from '@/lib/inactive-manager/chimmyPlayable'
import { instantAutopickReason } from '@/lib/live-draft-engine/instantAutopick'

const on = (since: string, seat: string) => ({ since: 's', byUserId: 'c', ownerUserId: seat, autopilot: { style: 'win_now' as const, since, byUserId: 'c' } })
const twoTeams = (): ManagedLineups => ({
  r1: on('2026-10-01T00:00:00Z', 'orphan-r1'),
  r2: on('2026-10-05T00:00:00Z', 'orphan-r2'),
  r3: { since: 's', byUserId: 'c' },
})

beforeEach(() => {
  resetChimmyPlanCache()
  h.hasPlan = false
  h.resolves = 0
  h.owner = 'owner-1'
  h.settings = { af_managed_lineups: twoTeams() }
  h.rosterOwner = 'orphan-r2'
})

describe('playableManagedLineups', () => {
  it('with the plan, every Chimmy team plays', () => {
    expect(playableManagedLineups(twoTeams(), true)).toEqual(twoTeams())
  })

  it('without it, only the first team handed over keeps playing; the rest keep everything but autopilot', () => {
    const playable = playableManagedLineups(twoTeams(), false)
    expect(playable.r1.autopilot).toBeDefined()
    expect(playable.r2).toEqual({ since: 's', byUserId: 'c', ownerUserId: 'orphan-r2' })
    expect(playable.r3).toEqual({ since: 's', byUserId: 'c' })
  })
})

describe('readPlayableChimmyLineups', () => {
  it('never asks about the plan for a league within the free allowance', async () => {
    h.settings = { af_managed_lineups: { r1: on('2026-10-01T00:00:00Z', 'orphan-r1') } }
    expect(Object.keys(await readPlayableChimmyLineups({ userId: 'owner-1', settings: h.settings }))).toEqual(['r1'])
    expect(h.resolves).toBe(0)
  })

  it('asks once a minute per owner, and follows a plan change after that', async () => {
    const t0 = Date.parse('2026-10-31T12:00:00Z')
    expect((await readPlayableChimmyLineups({ userId: 'owner-1', settings: h.settings }, t0)).r2.autopilot).toBeUndefined()
    h.hasPlan = true
    expect((await readPlayableChimmyLineups({ userId: 'owner-1', settings: h.settings }, t0 + 1000)).r2.autopilot).toBeUndefined()
    expect(h.resolves).toBe(1)
    expect((await readPlayableChimmyLineups({ userId: 'owner-1', settings: h.settings }, t0 + CHIMMY_PLAN_CACHE_MS)).r2.autopilot).toBeDefined()
    expect(h.resolves).toBe(2)
  })

  it('reads the league owner when the caller has only the league id; a league with no owner has no plan', async () => {
    h.hasPlan = true
    expect((await readPlayableChimmyLineups({ id: 'L', settings: h.settings })).r2.autopilot).toBeDefined()
    resetChimmyPlanCache()
    expect((await readPlayableChimmyLineups({ userId: null, settings: h.settings })).r2.autopilot).toBeUndefined()
  })
})

describe('the draft picks for a Chimmy team only while Chimmy plays it', () => {
  it('a paused team waits for its clock like anyone; with the plan it picks at once; the free team always does', async () => {
    expect(await instantAutopickReason({ leagueId: 'L', draftSessionId: 'd', rosterId: 'r2', leagueSettings: h.settings })).toBeNull()
    h.rosterOwner = 'orphan-r1'
    expect(await instantAutopickReason({ leagueId: 'L', draftSessionId: 'd', rosterId: 'r1', leagueSettings: h.settings })).toBe('autopilot')
    resetChimmyPlanCache()
    h.hasPlan = true
    h.rosterOwner = 'orphan-r2'
    expect(await instantAutopickReason({ leagueId: 'L', draftSessionId: 'd', rosterId: 'r2', leagueSettings: h.settings })).toBe('autopilot')
  })
})
