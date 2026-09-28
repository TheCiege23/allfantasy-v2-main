/**
 * @vitest-environment node
 *
 * buildFanOutLeagues: the backup per league comes from the Player Finder's league-scored picker
 * (getPlayerImpact + leagueCall), not the sweep's old same-position guess — and anything the picker
 * cannot answer falls back to the hydrate's own name, never to nothing silently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ impact: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findMany: vi.fn(async () => [
        { id: 'L1', name: 'KBFL', platform: 'sleeper', platformLeagueId: '1180000000000000000', season: 2026 },
        { id: 'Y1', name: 'Yahoo League', platform: 'yahoo', platformLeagueId: '449.l.1', season: 2026 },
      ]),
    },
    leagueTeam: { findMany: vi.fn(async () => [{ leagueId: 'L1', externalId: '3' }, { leagueId: 'Y1', externalId: '7' }]) },
    sportsPlayer: { findFirst: vi.fn(async () => ({ team: 'HOU' })) },
    // No games on file: nobody is locked.
    sportsGame: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 4, seasonType: 'regular' })) }))
vi.mock('@/lib/core-app/playerImpact', () => ({ getPlayerImpact: h.impact }))

import { buildFanOutLeagues } from '@/lib/chimmy-alerts/injuryFanOut'

const alert = (leagueId: string, extra: Record<string, unknown> = {}) => ({
  title: 'Tank Dell is Out and still starting',
  message: `Tank Dell starts for you in ${leagueId}.`,
  leagueId,
  urgencySignal: 90,
  metadata: {
    playerName: 'Tank Dell',
    designation: 'Out',
    sleeperId: '9001',
    sport: 'NFL',
    // The sweep's old same-position guess, carried by the hydrate.
    replacement: { playerName: 'Same-Position Guess', projectedPoints: 5 },
    ...extra,
  },
})

const impactFor = (leagueId: string, bench: Array<{ id: string; name: string; pts: number; injury?: string }>) => ({
  leagueId,
  leagueName: 'KBFL',
  platform: 'sleeper',
  platformLeagueId: '1180000000000000000',
  season: 2026,
  teamExternalId: '3',
  slot: 'STARTER',
  exactSlot: 'FLEX',
  slotConfirmed: true,
  isStarting: true,
  afPoints: { available: true, data: { points: 11, matchedKeys: 3, scoredKeys: 3 } },
  replacements: {
    available: true,
    data: bench.map((b) => ({ playerId: b.id, name: b.name, position: 'RB', team: 'CIN', afPoints: b.pts, delta: b.pts - 11, injuryStatus: b.injury ?? null, from: 'BENCH' })),
  },
  startOver: null,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildFanOutLeagues', () => {
  it('names the league-scored best bench player — a FLEX-eligible RB, not the same-position guess', async () => {
    h.impact.mockResolvedValue([impactFor('L1', [{ id: 'S1', name: 'Joe Mixon', pts: 14 }, { id: 'S2', name: 'Hurt Guy', pts: 20, injury: 'Out' }])])
    const out = await buildFanOutLeagues('u1', [alert('L1')])
    expect(h.impact).toHaveBeenCalledWith('9001', 'u1', { leagueIds: ['L1'] })
    expect(out).toEqual([
      expect.objectContaining({ leagueId: 'L1', leagueName: 'KBFL', startName: 'Joe Mixon', fixHref: expect.stringContaining('sleeper.com/leagues/1180000000000000000') }),
    ])
  })

  it('a league the picker cannot read (Yahoo) keeps the hydrate’s name, and still gets its verified link', async () => {
    h.impact.mockResolvedValue([impactFor('L1', [{ id: 'S1', name: 'Joe Mixon', pts: 14 }])])
    const out = await buildFanOutLeagues('u1', [alert('L1'), alert('Y1')])
    const yahoo = out.find((l) => l.leagueId === 'Y1')!
    expect(yahoo.startName).toBe('Same-Position Guess')
    expect(yahoo.fixHref).toContain('yahoo')
  })

  it('the picker failing falls back to the hydrate’s name everywhere — the alert still has something to say', async () => {
    h.impact.mockRejectedValue(new Error('impact read failed'))
    const out = await buildFanOutLeagues('u1', [alert('L1')])
    expect(out[0]!.startName).toBe('Same-Position Guess')
  })

  it('no Sleeper id: the picker is not asked', async () => {
    const out = await buildFanOutLeagues('u1', [alert('L1', { sleeperId: null })])
    expect(h.impact).not.toHaveBeenCalled()
    expect(out[0]!.startName).toBe('Same-Position Guess')
  })
})
