/**
 * 🛑 FOUND BY RENDERING, 2026-09-24: the league-graded verdict told a manager he "already starts 1 TE
 * and carries 12 more". `SportsPlayer` holds several rows for many players (production: 1,420 of
 * 11,960 NFL Sleeper ids have 2–3), and the need loader counted ROWS, so a 28-man roster read as 68
 * bodies. The loader must count each rostered player once, whatever the table holds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ sleeperId: string; position: string; name: string }>,
  platform: 'sleeper',
  sleeperIdsAsked: [] as string[][],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: async () => ({ platform: h.platform }) },
    sportsPlayer: {
      findMany: async (a: { where?: { sleeperId?: { in?: string[] } } }) => {
        h.sleeperIdsAsked.push(a?.where?.sleeperId?.in ?? [])
        return h.rows
      },
    },
    sportsInjury: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/trade-intel/viewerLeagueRoster', () => ({
  resolveViewerLeagueRoster: async () => ({
    ok: true,
    team: { platformUserId: 'sl-me', externalId: '1' },
    roster: { id: 'r1', playerData: { players: ['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1'] } },
  }),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: async () => null }))
vi.mock('@/lib/trade-intel/positionScarcity', () => ({ getPositionScarcity: async () => new Map() }))

import { loadRosterNeedFactors, loadViewerNeedFactors } from '@/lib/trade-value/viewerNeedFactors'

beforeEach(() => {
  h.platform = 'sleeper'
  h.sleeperIdsAsked = []
  h.rows = [
    { sleeperId: 'qb1', position: 'QB', name: 'Q' },
    { sleeperId: 'rb1', position: 'RB', name: 'R1' },
    { sleeperId: 'rb2', position: 'RB', name: 'R2' },
    { sleeperId: 'wr1', position: 'WR', name: 'W1' },
    { sleeperId: 'wr2', position: 'WR', name: 'W2' },
    // ONE tight end, stored three times — once with the long spelling.
    { sleeperId: 'te1', position: 'TE', name: 'T1' },
    { sleeperId: 'te1', position: 'TE', name: 'T1' },
    { sleeperId: 'te1', position: 'TightEnd', name: 'T1' },
  ]
})

const args = {
  leagueId: 'L',
  userId: 'u',
  sport: 'NFL',
  starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'],
  give: [{ name: 'W2', position: 'WR', base: 1000 }],
  get: [{ name: 'Incoming TE', position: 'TE', base: 3000 }],
}

describe('need counts players, not rows', () => {
  it('🛑 one tight end stored as three rows is one tight end — his slot is exactly filled', async () => {
    const f = await loadViewerNeedFactors(args)
    expect(f.gap).toBeNull()
    // Inflated, this read "you already start 1 TE and carry 2 more" and discounted him 4%.
    expect(f.get[0]).toBeNull()
  })

  it('and the receiver sent away leaves a real hole, priced as one', async () => {
    const f = await loadViewerNeedFactors(args)
    expect(f.give[0]?.factor).toBeGreaterThan(1)
    expect(f.give[0]?.reason).toMatch(/^after this trade you cannot fill 1 WR slot/)
  })
})

describe('a foreign league’s roster ids', () => {
  /*
   * 🛑 A Fleaflicker / MFL / Fantrax / Yahoo roster holds that provider's own ids — short numbers that
   * collide with real Sleeper ids (51 of 248 on the one production Fleaflicker league). Read as Sleeper
   * ids, the viewer's roster became a stranger's positions and the need premium priced his holes.
   */
  it('🛑 a Fleaflicker roster is never looked up by Sleeper id, and says why need is not priced', async () => {
    h.platform = 'fleaflicker'
    const f = await loadViewerNeedFactors(args)
    expect(h.sleeperIdsAsked).toEqual([])
    expect(f.give[0]).toBeNull()
    expect(f.get[0]).toBeNull()
    expect(f.gap).toMatch(/cannot be matched/)
  })

  // The partner-side loader (the trade agent grading the other roster) shares the read, and the gate.
  it('🛑 a Fleaflicker PARTNER roster is never looked up by Sleeper id either', async () => {
    h.platform = 'fleaflicker'
    const { userId: _u, ...rest } = args
    const f = await loadRosterNeedFactors({ ...rest, playerData: { players: ['qb1', 'te1'] } })
    expect(h.sleeperIdsAsked).toEqual([])
    expect(f.gap).toMatch(/cannot be matched/)
  })

  it('CONTROL: a Sleeper league’s roster IS looked up by those ids', async () => {
    const f = await loadViewerNeedFactors(args)
    expect(h.sleeperIdsAsked).toEqual([['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1']])
    expect(f.gap).toBeNull()
  })
})
