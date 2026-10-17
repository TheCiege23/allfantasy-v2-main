/**
 * The finder's live game badge: reconciling the feeds, the loader, and the badge.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ games: vi.fn(), scores: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: db.games }, leaguePlayerWeeklyScore: { findMany: db.scores } } }))

import { agoLabel, reconcileGame, scoreLine, type GameRow } from '@/lib/core-app/liveGameBadge'
import { loadLiveGameBadge } from '@/lib/core-app/liveGameBadgeLoader'
import { LiveGameBadge } from '@/components/core-app/player-finder/LiveGameBadge'

const KICK = '2026-09-29T00:15:00.000Z' // the Monday-night game
const at = (h: number) => new Date(Date.parse(KICK) + h * 3_600_000)
const row = (status: string | null, home: number | null, away: number | null, over: Partial<GameRow> = {}): GameRow => ({
  homeTeam: 'PHI', awayTeam: 'DAL', homeScore: home, awayScore: away, status, startTime: KICK, seasonType: null, week: 3, updatedAt: KICK, ...over,
})
const fold = (t: string) => ({ JAC: 'JAX', WSH: 'WAS' } as Record<string, string>)[t] ?? t

describe('reconcileGame (pure)', () => {
  it('the measured case: one feed stuck on in_progress, two say final — it is FINAL, with the final score', () => {
    const rows = [
      // espn_live, lagging — and touched MOST recently, so "newest row wins" alone would pick its stale score.
      row('in_progress', 20, 24, { updatedAt: at(6.5) }),
      row('final', 27, 20, { seasonType: 'regular', updatedAt: at(3.2) }),
      row('Final', 27, 20, { updatedAt: at(3.1) }),
    ]
    const g = reconcileGame({ club: 'DAL', rows, now: at(7), fold })!
    expect(g).toMatchObject({ state: 'final', week: 3, homeScore: 27, awayScore: 20, isHome: false })
    expect(scoreLine(g)).toBe('DAL 20 – 27 PHI')
  })

  it('LIVE while a feed says in progress and none says final, inside the window', () => {
    const g = reconcileGame({ club: 'PHI', rows: [row('scheduled', null, null), row('in_progress', 14, 10)], now: at(1.5), fold })!
    expect(g).toMatchObject({ state: 'live', homeScore: 14, awayScore: 10, isHome: true })
    expect(scoreLine(g)).toBe('PHI 14 – 10 DAL')
  })

  it('a feed stuck on in_progress past the live window is FINAL, not live', () => {
    const g = reconcileGame({ club: 'PHI', rows: [row('in_progress', 27, 20)], now: at(6), fold })!
    expect(g.state).toBe('final')
  })

  it('kicked off but no feed has it live yet: nothing, rather than a guess', () => {
    expect(reconcileGame({ club: 'PHI', rows: [row('scheduled', null, null)], now: at(0.2), fold })).toBeNull()
  })

  it('before kickoff, or long after, there is no badge', () => {
    expect(reconcileGame({ club: 'PHI', rows: [row('scheduled', null, null)], now: at(-1), fold })).toBeNull()
    expect(reconcileGame({ club: 'PHI', rows: [row('final', 27, 20)], now: at(42), fold })).toBeNull()
  })

  it("next week's fixture already on file does not hide this week's final", () => {
    const nextWeek = row('scheduled', null, null, { startTime: at(160).toISOString(), week: 4, homeTeam: 'PHI', awayTeam: 'NYG' })
    expect(reconcileGame({ club: 'PHI', rows: [row('final', 27, 20), nextWeek], now: at(7), fold })).toMatchObject({ state: 'final', week: 3 })
  })

  it('a preseason row never stands in for this week', () => {
    expect(reconcileGame({ club: 'PHI', rows: [row('final', 3, 30, { seasonType: 'pre' })], now: at(4), fold })).toBeNull()
  })

  it('folds club spellings, and ignores other clubs\' games', () => {
    const rows = [row('final', 17, 13, { homeTeam: 'JAC', awayTeam: 'TEN' }), row('final', 27, 20)]
    expect(reconcileGame({ club: 'JAX', rows, now: at(7), fold })).toMatchObject({ home: 'JAX', homeScore: 17 })
    expect(reconcileGame({ club: 'KC', rows, now: at(7), fold })).toBeNull()
  })

  it('no week on any row: no badge', () => {
    expect(reconcileGame({ club: 'PHI', rows: [row('final', 27, 20, { week: null })], now: at(7), fold })).toBeNull()
  })

  it('says how fresh a number is', () => {
    const now = new Date('2026-09-29T02:00:00Z')
    expect(agoLabel('2026-09-29T01:59:40Z', now)).toBe('just now')
    expect(agoLabel('2026-09-29T01:56:00Z', now)).toBe('4 min ago')
    expect(agoLabel('2026-09-28T23:59:00Z', now)).toBe('2 h ago')
  })
})

describe('loadLiveGameBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.games.mockResolvedValue([row('final', 27, 20)])
    db.scores.mockResolvedValue([
      { leagueId: 'L2', points: 8.4, isStarter: false, updatedAt: at(3), isFinalized: false },
      { leagueId: 'L1', points: 21.7, isStarter: true, updatedAt: at(3.4), isFinalized: false },
    ])
  })
  const load = (over: Partial<Parameters<typeof loadLiveGameBadge>[0]> = {}) =>
    loadLiveGameBadge({ sport: 'NFL', team: 'PHI', sleeperId: '4034', leagues: [{ leagueId: 'L1', leagueName: 'Zeta Dynasty' }, { leagueId: 'L2', leagueName: 'Office Pool' }], now: at(4), ...over })

  it('reads his points for the game\'s week and season, starters first', async () => {
    const b = await load()
    expect(b!.game.state).toBe('final')
    expect(db.scores).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ playerId: '4034', week: 3, seasonYear: 2026, leagueId: { in: ['L1', 'L2'] } }) }))
    expect(b!.leagues.map((l) => [l.leagueName, l.points, l.isStarter])).toEqual([
      // Starters first, even though 'Office Pool' sorts before 'Zeta Dynasty'.
      ['Zeta Dynasty', 21.7, true],
      ['Office Pool', 8.4, false],
    ])
  })

  it('a January game belongs to last year\'s season', async () => {
    const jan = '2027-01-04T01:20:00.000Z'
    db.games.mockResolvedValue([row('final', 30, 3, { startTime: jan, week: 18 })])
    await load({ now: new Date(Date.parse(jan) + 4 * 3_600_000) })
    expect(db.scores).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ seasonYear: 2026, week: 18 }) }))
  })

  it('no league of yours: the game badge alone, no score read', async () => {
    const b = await load({ leagues: [] })
    expect(b!.leagues).toEqual([])
    expect(db.scores).not.toHaveBeenCalled()
  })

  it('not NFL, or no club: nothing, and no query', async () => {
    expect(await load({ sport: 'NBA' })).toBeNull()
    expect(await load({ team: null })).toBeNull()
    expect(db.games).not.toHaveBeenCalled()
  })
})

describe('LiveGameBadge', () => {
  it('LIVE: the score with his club first, and his points per league with their freshness', () => {
    const game = reconcileGame({ club: 'PHI', rows: [row('in_progress', 14, 10)], now: at(1.5), fold })!
    render(
      <LiveGameBadge
        data={{ game, leagues: [{ leagueId: 'L1', leagueName: 'KBFL', points: 12.4, isStarter: true, updatedAt: at(1.45).toISOString(), finalized: false }] }}
        nowIso={at(1.5).toISOString()}
      />,
    )
    expect(screen.getByRole('heading').textContent).toContain('Live')
    expect(screen.getByText('PHI 14 – 10 DAL')).toBeTruthy()
    expect(screen.getByText('12.4')).toBeTruthy()
    expect(screen.getByText('starting · updated 3 min ago')).toBeTruthy()
  })

  it('FINAL with no league score: says so instead of a zero', () => {
    const game = reconcileGame({ club: 'PHI', rows: [row('final', 27, 20)], now: at(7), fold })!
    render(<LiveGameBadge data={{ game, leagues: [] }} nowIso={at(7).toISOString()} />)
    expect(screen.getByRole('heading').textContent).toContain('Final')
    expect(screen.getByText(/No league score on file for him this week/)).toBeTruthy()
    expect(screen.queryByText('0.0')).toBeNull()
  })

  it('renders nothing without a game', () => {
    const { container } = render(<LiveGameBadge data={null} nowIso={at(0).toISOString()} />)
    expect(container.innerHTML).toBe('')
  })
})
