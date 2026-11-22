import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantraxLeague: {
      findUnique: vi.fn(async () => ({
        standings: [
          { team: 'Ciege82', fantraxTeamId: 'ciege' },
          { team: 'Connor0488', fantraxTeamId: 'conn' },
        ],
        roster: [
          { fantraxId: 'c1', teamName: 'Connor0488', position: 'QB', status: 'ACTIVE' },
          { fantraxId: 'c2', teamName: 'Connor0488', position: 'WR', status: 'RESERVE' },
          { fantraxId: 'm1', teamName: 'Ciege82', position: 'QB', status: 'ACTIVE' },
        ],
      })),
    },
  },
}))
vi.mock('@/lib/core-app/connectedRoster', () => ({
  connectedRosterPlayers: vi.fn(async (_p: string, _s: string, rows: Array<{ fantraxId: string; position: string; status: string }>) =>
    rows.map((r) => ({ id: r.fantraxId, name: r.fantraxId, position: r.position, team: null, imageUrl: null, logoUrl: null, rosterSlot: r.position, rosterStatus: r.status, cfbdId: null, rollingInsightsId: null })),
  ),
}))
// The opponent's starter scored 30, his bench player 99: only starters count.
vi.mock('@/lib/league/collegePro/collegePoints', () => ({ loadCollegePoints: vi.fn(async () => ({ points: { c1: 30, c2: 99 }, statsOnFile: true, live: true, cfbWeeks: [] })) }))

import { loadHeadToHead } from '@/lib/league/collegePro/headToHead'

const base = {
  fantraxSnapshotId: 'snap',
  myCollegeTeamName: 'Ciege82',
  myCombined: 205.36,
  opponentProTotal: 101.2,
  opponentName: 'Connor0488',
  myRosterId: '8',
  opponentRosterId: '5',
  sleeperTeams: [
    { rosterId: '8', teamName: '(F) SF TEP', ownerName: 'TheCiege24' },
    { rosterId: '5', teamName: 'Connor0488', ownerName: 'Connor0488' },
  ],
  season: 2026,
  nflWeek: 12,
}

describe('loadHeadToHead', () => {
  it("adds the opponent's college STARTERS to his NFL score once his team is matched", async () => {
    const r = await loadHeadToHead({ ...base, proSettings: { collegeProTeamMap: { '5': 'conn', '8': 'ciege' } }, wantEditor: false })
    expect(r.headToHead).toEqual({ me: 205.36, opponent: { name: 'Connor0488', total: 131.2 }, missing: null })
    expect(r.editor).toBeNull()
  })

  it('with no saved map, scores an unambiguous match on its own — nobody has to set it up', async () => {
    const r = await loadHeadToHead({ ...base, proSettings: {}, wantEditor: true })
    // Connor0488 is Connor0488 on both platforms and nothing else competes: applied automatically.
    expect(r.headToHead).toEqual({ me: 205.36, opponent: { name: 'Connor0488', total: 131.2 }, missing: null })
    // The commissioner still sees it as a suggestion they can change; nothing was saved for them.
    expect(r.editor?.suggested).toEqual({ '8': 'ciege', '5': 'conn' })
    expect(r.editor?.saved).toEqual({})
  })

  it('with no saved map and an ambiguous opponent, says what to do and never scores from a guess', async () => {
    const r = await loadHeadToHead({
      ...base,
      proSettings: {},
      wantEditor: false,
      // Two Sleeper teams fit "Connor0488" equally well, so neither is applied.
      sleeperTeams: [...base.sleeperTeams, { rosterId: '6', teamName: null, ownerName: 'Connor0488' }],
    })
    expect(r.headToHead.opponent).toBeNull()
    expect(r.headToHead.missing).toMatch(/Match each pro team/)
  })

  it("a commissioner's saved choice wins over the automatic match", async () => {
    const r = await loadHeadToHead({ ...base, proSettings: { collegeProTeamMap: { '5': 'ciege' } }, wantEditor: false })
    // Saved says the opponent's college team is Ciege82's, not Connor0488's.
    expect(r.headToHead.opponent?.name).toBe('Connor0488')
    expect(r.headToHead.opponent?.total).not.toBe(131.2)
  })

  it('a bye week has no opponent to compare', async () => {
    const r = await loadHeadToHead({ ...base, opponentRosterId: null, proSettings: { collegeProTeamMap: { '5': 'conn' } }, wantEditor: false })
    expect(r.headToHead.missing).toBe('No head-to-head opponent this week.')
  })
})
