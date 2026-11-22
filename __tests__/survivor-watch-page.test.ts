import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unreadEliminations, watchCouncil, watchJury, watchPollMs, watchTribes, type WatchCouncilRow, type WatchPlayerRow } from '@/lib/survivor/spectator/watchModel'

const NOW = new Date('2026-10-20T01:00:00Z')

const council = (over: Partial<WatchCouncilRow> = {}): WatchCouncilRow => ({
  week: 3, councilNumber: 1, status: 'closed', closedAt: new Date('2026-10-20T00:00:00Z'), voteDeadlineAt: new Date('2026-10-20T00:00:00Z'),
  attendingTribeId: 't1', eliminatedUserId: 'u2', eliminatedName: 'Bo', isTie: false, tiePhase: null,
  isRevealed: true, revealStartsAt: new Date('2026-10-20T00:59:57Z'), revealStep: 0,
  revealSequence: [
    { targetName: 'Bo', status: 'counts', voterName: 'Ace' },
    { targetName: 'Cy', status: 'counts', voterName: 'Bo' },
    { targetName: 'Bo', status: 'counts', voterName: 'Cy' },
  ],
  ...over,
})
const player = (userId: string, displayName: string, over: Partial<WatchPlayerRow> = {}): WatchPlayerRow => ({ userId, displayName, tribeId: 't1', playerState: 'active', eliminatedWeek: null, isJuryMember: false, ...over })
const tribes = [
  { id: 't1', name: 'Tala', isMerged: false, crestUrl: null, color: '#fff' },
  { id: 't2', name: 'Vanua', isMerged: false, crestUrl: null, color: null },
]

describe('watch page privacy model', () => {
  it('the live read releases ballots one at a time, carries no voter, and holds the verdict until the last one', () => {
    // 3 s into the read, at one ballot per 2.5 s: the first at 0 s and the second at 2.5 s are out.
    const reading = watchCouncil([council({ revealStartsAt: new Date(NOW.getTime() - 3000) })], { t1: 'Tala' }, 'one_at_a_time', NOW)
    expect(reading).toMatchObject({ state: 'reading', week: 3, tribeName: 'Tala', visibleSteps: 2, totalSteps: 3, eliminatedName: null })
    const early = watchCouncil([council({ revealStartsAt: new Date(NOW.getTime() - 1000) })], {}, 'one_at_a_time', NOW)
    expect(early).toMatchObject({ state: 'reading', visibleSteps: 1, totalSteps: 3, eliminatedName: null })
    expect(JSON.stringify(early)).not.toMatch(/voter|Ace/)
    const done = watchCouncil([council({ revealStartsAt: new Date(NOW.getTime() - 60_000) })], {}, 'one_at_a_time', NOW)
    expect(done).toMatchObject({ state: 'read', eliminatedName: 'Bo' })
  })

  it('before the read: "voting" while votes are open, "waiting" once closed, with nothing about the result', () => {
    expect(watchCouncil([council({ isRevealed: false, closedAt: null, status: 'voting' })], {}, null, NOW)).toEqual({ state: 'voting', week: 3, tribeName: null, voteDeadlineAt: '2026-10-20T00:00:00.000Z' })
    const waiting = watchCouncil([council({ isRevealed: false })], {}, null, NOW)
    expect(waiting).toEqual({ state: 'waiting', week: 3, tribeName: null })
  })

  it('shows the latest council of the season', () => {
    const shown = watchCouncil([council({ week: 2, revealStartsAt: new Date(0) }), council({ week: 3, councilNumber: 2, isRevealed: false, closedAt: null, status: 'voting' })], {}, null, NOW)
    expect(shown).toMatchObject({ state: 'voting', week: 3 })
  })

  it('a manager whose read is not finished still looks in the game, on the tribe and in the jury', () => {
    const pending = unreadEliminations([council({ isRevealed: false })], null, NOW)
    expect([...pending]).toEqual(['u2'])
    const players = [player('u1', 'Ace'), player('u2', 'Bo', { playerState: 'eliminated', eliminatedWeek: 3, isJuryMember: true }), player('u3', 'Cy', { tribeId: 't2' })]
    const shown = watchTribes({ tribes, players, tribeTotals: { t1: 100, t2: 120.5 }, pendingOut: pending })
    expect(shown[0]!.castaways).toEqual([{ name: 'Ace', out: false, outWeek: null }, { name: 'Bo', out: false, outWeek: null }])
    expect(watchJury(players, pending)).toEqual([])

    const after = unreadEliminations([council({ revealStartsAt: new Date(0) })], null, NOW)
    const read = watchTribes({ tribes, players, tribeTotals: {}, pendingOut: after })
    expect(read[0]!.castaways).toEqual([{ name: 'Ace', out: false, outWeek: null }, { name: 'Bo', out: true, outWeek: 3 }])
    expect(watchJury(players, after)).toEqual(['Bo'])
  })

  it('pre-merge tribes carry the week total; after the merge one tribe holds everyone in, and the out list the rest', () => {
    const players = [player('u1', 'Ace'), player('u2', 'Bo', { playerState: 'jury', eliminatedWeek: 7, tribeId: null }), player('u3', 'Cy')]
    expect(watchTribes({ tribes, players, tribeTotals: { t1: 88 }, pendingOut: new Set() }).map(t => [t.name, t.total])).toEqual([['Tala', 88], ['Vanua', null], ['Out of the game', null]])
    const merged = watchTribes({ tribes: [...tribes, { id: 'm', name: 'Merged', isMerged: true, crestUrl: null, color: null }], players, tribeTotals: {}, pendingOut: new Set() })
    expect(merged.map(t => [t.name, t.castaways.map(c => c.name)])).toEqual([['Merged', ['Ace', 'Cy']], ['Out of the game', ['Bo']]])
  })

  it('polls fast only during a read', () => {
    expect(watchPollMs({ state: 'reading', week: 1, tribeName: null, steps: [], totalSteps: 3, visibleSteps: 1, nextStepAt: null, eliminatedName: null, isTie: false })).toBe(2_500)
    expect(watchPollMs(null)).toBe(60_000)
  })
})

const h = vi.hoisted(() => ({
  league: vi.fn(),
  isSurvivor: vi.fn(),
  councils: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.league },
    survivorGameState: { findUnique: vi.fn(async () => ({ phase: 'pre_merge', mergeTriggeredAt: null })) },
    survivorTribe: { findMany: vi.fn(async () => [{ id: 't1', name: 'Tala', isMerged: false, colorHex: null, logoUrl: null, catalogId: null, primaryColor: null, secondaryColor: null }]) },
    survivorPlayer: { findMany: vi.fn(async () => [{ userId: 'u1', displayName: 'Ace', tribeId: 't1', playerState: 'active', eliminatedWeek: null, isJuryMember: false }]) },
    survivorTribalCouncil: { findMany: h.councils },
    survivorWeeklyScore: { findMany: vi.fn(async () => [{ tribeId: 't1', finalScore: 42, countedTowardTribeTotal: true }]) },
    survivorAuditEntry: { findMany: vi.fn(async () => [{ data: { episode: { week: 2, title: 'The Tribe Has Spoken', scenes: [{ label: 'Tribal Council', text: 'Bo was voted out.' }] } } }]) },
  },
}))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ isSurvivorLeague: h.isSurvivor }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: vi.fn(async () => 3) }))

import { loadSurvivorWatchData } from '@/lib/survivor/spectator/watchPage'

describe('loadSurvivorWatchData', () => {
  beforeEach(() => {
    h.league.mockResolvedValue({ name: 'Island', sport: 'NFL', settings: { spectatorPageEnabled: true }, survivorRevealMode: null })
    h.isSurvivor.mockResolvedValue(true)
    h.councils.mockResolvedValue([])
  })

  it('is off until the commissioner opens it, and says nothing about the league', async () => {
    h.league.mockResolvedValue({ name: 'Island', sport: 'NFL', settings: {}, survivorRevealMode: null })
    expect(await loadSurvivorWatchData('L1')).toEqual({ state: 'private' })
  })

  it('an unknown or non-Survivor league is not found', async () => {
    h.isSurvivor.mockResolvedValue(false)
    expect(await loadSurvivorWatchData('L1')).toBeNull()
    h.league.mockResolvedValue(null)
    expect(await loadSurvivorWatchData('L1')).toBeNull()
  })

  it('a public league: names, the tribe race and episodes; the council query never asks for votes', async () => {
    const data = await loadSurvivorWatchData('L1', { now: NOW })
    expect(data).toMatchObject({ state: 'public', leagueName: 'Island', week: 3, remaining: 1, council: null, jury: [] })
    if (data?.state !== 'public') throw new Error('expected public')
    expect(data.tribes).toMatchObject([{ name: 'Tala', color: null, total: 42, castaways: [{ name: 'Ace', out: false, outWeek: null }] }])
    expect(data.episodes.map(e => e.title)).toEqual(['The Tribe Has Spoken'])
    const select = h.councils.mock.calls[0]![0].select as Record<string, unknown>
    expect(Object.keys(select)).not.toContain('votes')
    expect(JSON.stringify(data)).not.toMatch(/u1/)
  })
})
