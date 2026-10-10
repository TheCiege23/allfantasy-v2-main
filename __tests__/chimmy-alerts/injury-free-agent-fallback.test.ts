/**
 * @vitest-environment node
 *
 * "No bench player can come in" is no longer a dead end (2026-10-09): the alert names the free agent
 * to add — healthy, with a game still to play — for a viewer with AF Pro player depth, and every
 * viewer gets the league's verified claim screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFind: vi.fn(),
  teamFind: vi.fn(),
  playerFindFirst: vi.fn(),
  gameFind: vi.fn(),
  impact: vi.fn(),
  leagueCall: vi.fn(),
  week: vi.fn(),
  depth: vi.fn(),
  replacements: vi.fn(),
  injuries: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: h.leagueFind },
    leagueTeam: { findMany: h.teamFind },
    sportsPlayer: { findFirst: h.playerFindFirst },
    sportsGame: { findMany: h.gameFind },
  },
}))
vi.mock('@/lib/core-app/playerImpact', () => ({ getPlayerImpact: h.impact }))
vi.mock('@/lib/core-app/leagueCall', () => ({ leagueCall: h.leagueCall }))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: h.week }))
vi.mock('@/lib/core-app/corePaywall', () => ({ resolveCoreDepth: h.depth }))
vi.mock('@/lib/shared-services/league-hub/replacementOptions', () => ({ resolveReplacementOptions: h.replacements }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: h.injuries }))

import { pickFreeAgent, type FreeAgentCandidate } from '@/lib/chimmy-alerts/freeAgentFallback'
import { fanOutCopy, type FanOutAlert, type FanOutLeague } from '@/lib/chimmy-alerts/injuryFanOutCopy'
import { buildFanOutLeagues } from '@/lib/chimmy-alerts/injuryFanOut'
import { renderInjuryEmail } from '@/lib/notifications/injuryEmail'

const NOW = new Date('2026-10-09T21:30:00.000Z') // Friday 5:30pm ET
const SUNDAY = '2026-10-11T17:00:00.000Z'
const THURSDAY = '2026-10-09T00:15:00.000Z' // already played

const cand = (playerId: string, name: string, team: string | null, projectedPoints = 10): FreeAgentCandidate => ({
  playerId,
  name,
  position: 'RB',
  team,
  projectedPoints,
})
const ctx = (statusById: Record<string, string> = {}) => ({
  kickoffs: { CHI: SUNDAY, JAX: SUNDAY, NYG: THURSDAY },
  club: (t: string | null) => (t ? t.toUpperCase() : null),
  statusById: new Map(Object.entries(statusById)),
  now: NOW,
})

describe('pickFreeAgent', () => {
  it('the engine’s best healthy candidate with a game still to play', () => {
    expect(pickFreeAgent([cand('1', 'Chris Rodriguez', 'JAX', 9.4)], ctx())).toEqual({ playerId: '1', name: 'Chris Rodriguez', position: 'RB', projectedPoints: 9.4 })
  })
  it('🛑 skips a free agent listed Out / Doubtful / IR — suggesting one is the mistake the alert answers', () => {
    const pick = pickFreeAgent([cand('1', 'Hurt Guy', 'CHI'), cand('2', 'Iffy Guy', 'CHI'), cand('3', 'Healthy Guy', 'JAX')], ctx({ '1': 'Out', '2': 'Doubtful' }))
    expect(pick?.name).toBe('Healthy Guy')
  })
  it('🛑 skips a free agent on bye, or whose game has already started', () => {
    expect(pickFreeAgent([cand('1', 'Bye Guy', 'KC'), cand('2', 'Thursday Guy', 'NYG')], ctx())).toBeNull()
  })
  it('Questionable is still playable; no club on file is not', () => {
    expect(pickFreeAgent([cand('1', 'No Club', null), cand('2', 'GTD Guy', 'CHI')], ctx({ '2': 'Questionable' }))?.name).toBe('GTD Guy')
  })
})

const alert = (leagueId: string): FanOutAlert => ({
  title: 'Kyle Monangai is Out and still starting',
  message: 'Kyle Monangai is listed Out.',
  leagueId,
  urgencySignal: 80,
  metadata: { playerName: 'Kyle Monangai', designation: 'Out', sleeperId: '12345', sport: 'NFL' },
})
const fl = (over: Partial<FanOutLeague>): FanOutLeague => ({ leagueId: 'L1', leagueName: 'Jacksonville Pro', startName: null, fixHref: null, fixLabel: null, ...over })

describe('fanOutCopy — the no-bench line', () => {
  it('names the free agent to add, with his projection', () => {
    const c = fanOutCopy([alert('L1')], [fl({ freeAgent: { name: 'Chris Rodriguez', projectedPoints: 9.4 }, claimHref: 'https://x' })])
    expect(c.body).toContain("Jacksonville Pro: no bench player can come in — add Chris Rodriguez (9.4 proj), he's a free agent.")
  })
  it('without a name (no AF Pro, or none healthy), points at the free agents', () => {
    expect(fanOutCopy([alert('L1')], [fl({ claimHref: 'https://x' })]).body).toContain('Jacksonville Pro: no bench player can come in — check free agents.')
  })
  it('without even a claim screen, says what it always said', () => {
    expect(fanOutCopy([alert('L1')], [fl({})]).body).toContain('Jacksonville Pro: no bench player can come in for him.')
  })
})

describe('renderInjuryEmail — labelled links', () => {
  it('a claim link carries its own words; a lineup link keeps "Fix your lineup in …"', () => {
    const mail = renderInjuryEmail({
      alerts: [
        {
          title: 'Kyle Monangai is Out',
          message: 'm',
          fixLinks: [
            { leagueName: 'Washington', href: 'https://sleeper.com/leagues/1/team' },
            { leagueName: 'Jacksonville', href: 'https://sleeper.com/leagues/2/players', label: 'Add Chris Rodriguez in Jacksonville' },
          ],
        },
      ],
      baseUrl: 'https://allfantasy.ai',
    })!
    expect(mail.html).toContain('Fix your lineup in Washington →')
    expect(mail.html).toContain('Add Chris Rodriguez in Jacksonville →')
  })
})

describe('buildFanOutLeagues — the fallback end to end', () => {
  beforeEach(() => {
    for (const f of Object.values(h)) f.mockReset()
    h.leagueFind.mockResolvedValue([
      { id: 'L1', name: 'Jacksonville Pro', platform: 'sleeper', platformLeagueId: '111', season: 2026 },
      { id: 'L2', name: 'Washington Pro', platform: 'sleeper', platformLeagueId: '222', season: 2026 },
    ])
    h.teamFind.mockResolvedValue([
      { leagueId: 'L1', externalId: '3' },
      { leagueId: 'L2', externalId: '4' },
    ])
    h.playerFindFirst.mockResolvedValue({ team: 'CHI' })
    h.week.mockResolvedValue({ season: 2026, week: 6, seasonType: 'regular' })
    h.gameFind.mockResolvedValue([
      { homeTeam: 'CHI', awayTeam: 'WAS', startTime: new Date(SUNDAY), seasonType: 'regular', venue: null },
      { homeTeam: 'JAX', awayTeam: 'SEA', startTime: new Date(SUNDAY), seasonType: 'regular', venue: null },
    ])
    h.impact.mockResolvedValue([
      { leagueId: 'L1', isStarting: true },
      { leagueId: 'L2', isStarting: true },
    ])
    // L1: nobody on the bench can come in; L2: start Chris Brooks.
    h.leagueCall.mockImplementation(({ impact }: { impact: { leagueId: string } }) => ({ swap: impact.leagueId === 'L2' ? { startName: 'Chris Brooks' } : null }))
    h.replacements.mockResolvedValue({
      freeAgentOptions: [
        { playerId: '90', name: 'Hurt Back', position: 'RB', team: 'JAX', projectedPoints: 12 },
        { playerId: '91', name: 'Chris Rodriguez', position: 'RB', team: 'JAX', projectedPoints: 9.4 },
      ],
    })
    h.injuries.mockResolvedValue({ byPlayer: new Map([['hurt back', { status: 'Out' }]]) })
  })

  it('AF Pro: the no-bench league names a healthy free agent and its claim screen; the other keeps its bench swap', async () => {
    h.depth.mockResolvedValue({ unlocked: true })
    const out = await buildFanOutLeagues('u1', [alert('L1'), alert('L2')], NOW)
    const l1 = out.find((l) => l.leagueId === 'L1')!
    const l2 = out.find((l) => l.leagueId === 'L2')!
    expect(l1).toMatchObject({ startName: null, freeAgent: { name: 'Chris Rodriguez', projectedPoints: 9.4 }, claimHref: 'https://sleeper.com/leagues/111/players' })
    expect(l2).toMatchObject({ startName: 'Chris Brooks', claimHref: null })
    expect(l2.freeAgent).toBeUndefined()
    // Only the hole was priced — one engine call, not one per league.
    expect(h.replacements).toHaveBeenCalledTimes(1)
    expect(h.replacements).toHaveBeenCalledWith({ appUserId: 'u1', leagueId: 'L1', affectedPlayerId: '12345' })
  })

  it('🛑 without AF Pro: no name (the Finder withholds pickups there too) — the claim screen still comes through', async () => {
    h.depth.mockResolvedValue({ unlocked: false })
    const out = await buildFanOutLeagues('u1', [alert('L1'), alert('L2')], NOW)
    const l1 = out.find((l) => l.leagueId === 'L1')!
    expect(l1.freeAgent).toBeUndefined()
    expect(l1.claimHref).toBe('https://sleeper.com/leagues/111/players')
    expect(h.replacements).not.toHaveBeenCalled()
  })

  it('a failing engine leaves the claim link and never throws', async () => {
    h.depth.mockResolvedValue({ unlocked: true })
    h.replacements.mockRejectedValue(new Error('roster scan failed'))
    const out = await buildFanOutLeagues('u1', [alert('L1')], NOW)
    expect(out[0]).toMatchObject({ startName: null, claimHref: 'https://sleeper.com/leagues/111/players' })
    expect(out[0]!.freeAgent).toBeUndefined()
  })
})
