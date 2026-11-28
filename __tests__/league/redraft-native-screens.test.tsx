/**
 * Redraft native screens (batch A2): the redraft-only markup appears for a native redraft league and
 * NOT for any other format, and every new element is dropped when its data is missing.
 */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/hooks/useVisibleRefresh', () => ({ useVisibleRefresh: () => undefined }))
vi.mock('@/lib/league/lineup-lock', () => ({ evaluateLineupLock: () => ({ locked: false, policy: 'football_weekly' }) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('@/app/league/[leagueId]/tabs/ProposeTradeModal', () => ({ ProposeTradeModal: () => null }))
vi.mock('@/components/waiver-wire/WaiverClaimDrawer', () => ({ default: () => null }))
vi.mock('@/components/league/PlayerHeadshot', () => ({ PlayerHeadshot: () => null }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))

import { NativeMatchupScreen } from '@/components/league/native/screens/NativeMatchupScreen'
import { NativeTradesScreen } from '@/components/league/native/screens/NativeTradesScreen'
import { NativeStandingsScreen } from '@/components/league/native/screens/NativeStandingsScreen'
import { NativeWaiversScreen } from '@/components/league/native/screens/NativeWaiversScreen'
import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'

afterEach(() => vi.unstubAllGlobals())

const base = { id: 'lg1', name: 'Blah', season: 2026, currentWeek: 9, teamCount: 4, platform: 'allfantasy', format: 'redraft', settings: {} }
const redraft = (sport: string, over: Record<string, unknown> = {}) => ({ ...base, sport, leagueType: 'redraft', ...over }) as unknown as UserLeague
/** The same league as another format: every redraft element must disappear. */
const dynasty = (sport: string, over: Record<string, unknown> = {}) => ({ ...base, sport, leagueType: 'dynasty', isDynasty: true, ...over }) as unknown as UserLeague

function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const key = Object.keys(routes).find((k) => url.includes(k))
      if (!key) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 })
      return new Response(JSON.stringify(routes[key]), { status: 200 })
    }),
  )
  return calls
}

/* ── Matchup ───────────────────────────────────────────────────────────────────────────────────── */

const slot = (playerId: string, position: string, gameStatus: string, currentPoints: number) => ({
  playerId, name: `Player ${playerId}`, position, team: 'BOS', opponent: 'DEN', headshotUrl: null, currentPoints, projectedPoints: 20, hasRealProjection: true,
  injuryStatus: null, newsBlurb: null, weatherSummary: null, gameStatus, gameLabel: gameStatus === 'final' ? 'Final' : 'Q3 4:00', aiInsight: null,
})
const side = (rosterId: string, teamName: string, starters: unknown[], totalPoints: number) => ({
  projectedTotalIncludesFallback: false, rosterId, teamName, avatarUrl: null, record: { wins: 5, losses: 3, ties: 0 }, winPct: 0.6, totalPoints, projectedTotal: 120, starters, remainingStarters: 1,
})
const matchup = (winProbabilityLeft: number | null) => ({
  payload: {
    leagueId: 'lg1', season: 2026, week: 9, sport: 'NBA', matchupStatus: 'live', conceptOverlay: null,
    left: side('r1', 'Home Team', [slot('a', 'C', 'live', 22), slot('b', 'PG', 'final', 30)], 52),
    right: side('r2', 'Away Team', [slot('c', 'C', 'unknown', 10), slot('d', 'PG', 'final', 12)], 22),
    winProbabilityLeft, insights: { matchupEdge: '', startSit: '', weather: '' }, partialData: false, refreshIntervalMs: 0,
  },
})

describe('Matchup — score bug', () => {
  it('redraft: the score bug, live state + odds, per-row game state, and NBA position tones', async () => {
    stubFetch({ '/matchup-center': matchup(0.62), '/scoring/matchups': { matchups: [] } })
    const { container } = render(<NativeMatchupScreen league={redraft('NBA')} onSelectTab={() => {}} />)
    const bug = await screen.findByTestId('redraft-score-bug')
    expect(within(bug).getByTestId('redraft-score-bug-state').textContent).toBe('Live · 62% to win')
    expect(within(bug).getByText('52.0').getAttribute('data-lead')).toBe('true')
    expect(within(bug).getByText(/1 playing · 1 done/)).toBeTruthy()
    expect(container.querySelector('[data-rd-screen=matchup]')).toBeTruthy()
    // A C is a centre in the NBA (amber), not the football palette's "other".
    const pills = [...container.querySelectorAll('.nls-mrow .nls-pos')]
    expect(pills.map((p) => p.getAttribute('data-rd-pos'))).toEqual(['amber', 'blue'])
    // Game state dots only from known states: the right side's "unknown" carries none.
    const states = [...container.querySelectorAll('.nls-mrow small')].map((s) => s.getAttribute('data-game'))
    expect(states).toEqual(['live', null, 'final', 'final'])
  })

  it('redraft: no win probability means no odds text and no meter (dropped, not estimated)', async () => {
    stubFetch({ '/matchup-center': matchup(null), '/scoring/matchups': { matchups: [] } })
    render(<NativeMatchupScreen league={redraft('NBA')} onSelectTab={() => {}} />)
    const bug = await screen.findByTestId('redraft-score-bug')
    expect(within(bug).getByTestId('redraft-score-bug-state').textContent).toBe('Live')
    expect(within(bug).queryByRole('meter')).toBeNull()
  })

  it('another format: the original score card, no redraft markup at all', async () => {
    stubFetch({ '/matchup-center': matchup(0.62), '/scoring/matchups': { matchups: [] } })
    const { container } = render(<NativeMatchupScreen league={dynasty('NBA')} onSelectTab={() => {}} />)
    await screen.findByText('AF win prob', { exact: false })
    expect(screen.queryByTestId('redraft-score-bug')).toBeNull()
    expect(container.querySelector('[data-rd-screen]')).toBeNull()
    expect(container.querySelector('[data-rd-pos]')).toBeNull()
    expect(container.querySelector('[data-game]')).toBeNull()
  })
})

/* ── Waivers ───────────────────────────────────────────────────────────────────────────────────── */

const waiverRoutes = (settings: Record<string, unknown>, faabRemaining: number | null) => ({
  '/claims?type=history': { transactions: [] },
  '/claims': { claims: [{ id: 'c1', addPlayerId: 'p1', dropPlayerId: null, faabBid: 5, priorityOrder: 1, status: 'pending' }] },
  '/api/league/roster': { rosterId: 'r1', roster: { lineup_sections: { starters: [], bench: [] } }, unifiedRoster: [], faabRemaining, waiverPriority: 3 },
  '/settings': settings,
  '/players': { players: [{ id: 'p1', name: 'Free Guy', position: 'C', team: 'BOS', sport: 'NHL', projectedPoints: 5 }] },
  '/state': { state: { nextRunAt: null } },
  '/watchlist': { playerIds: [] },
})

describe('Players & waivers — one waiver line (Sleeper pass 2)', () => {
  it('redraft FAAB: claim type, the balance against the budget and priority in one line; claims still carry their state', async () => {
    stubFetch(waiverRoutes({ sport: 'NHL', waiverType: 'faab', faabBudget: 100, processingDayOfWeek: 3 }, 64))
    render(<NativeWaiversScreen league={redraft('NHL')} />)
    const line = await screen.findByTestId('players-waiver-line')
    await waitFor(() => expect(line.textContent).toContain('FAAB $64 left of $100'))
    expect(line.textContent).toContain('FAAB bidding')
    expect(line.textContent).toContain('Priority 3 of')
    expect(screen.queryByTestId('redraft-waiver-header')).toBeNull()
    // The claims panel opens from the header button; its claim state is still there.
    fireEvent.click(screen.getByTestId('players-claims-toggle'))
    expect((await screen.findByTestId('native-waivers-claim-state-c1')).textContent).toBe('Pending')
  })

  it('rolling waivers: the claim type and no FAAB', async () => {
    stubFetch(waiverRoutes({ sport: 'NHL', waiverType: 'rolling', faabBudget: null }, null))
    render(<NativeWaiversScreen league={redraft('NHL')} />)
    const line = await screen.findByTestId('players-waiver-line')
    await waitFor(() => expect(line.textContent).toContain('Rolling priority'))
    expect(line.textContent).not.toContain('FAAB $')
  })

  it('FAAB with no budget in settings: the real balance, no invented budget', async () => {
    stubFetch(waiverRoutes({ sport: 'NHL', waiverType: 'faab', faabBudget: null }, 40))
    render(<NativeWaiversScreen league={redraft('NHL')} />)
    const line = await screen.findByTestId('players-waiver-line')
    await waitFor(() => expect(line.textContent).toContain('FAAB $40 left'))
    expect(line.textContent).not.toContain(' of $')
  })
})

/* ── Trades ────────────────────────────────────────────────────────────────────────────────────── */

const panel = {
  tradeBlock: [],
  historyTrades: [],
  activeTrades: [
    { id: 't1', direction: 'incoming', partnerName: 'Rival', timestamp: new Date().toISOString(), sent: [{ id: 'a', label: 'Mine' }], received: [{ id: 'b', label: 'Theirs' }], status: 'pending', viewerIsReceiver: true, leagueGrade: { graded: true, letter: 'B+', recommendation: 'Take it.' } },
    { id: 't2', direction: 'outgoing', partnerName: 'Other', timestamp: new Date().toISOString(), sent: [{ id: 'c', label: 'X' }], received: [{ id: 'd', label: 'Y' }], status: 'pending', viewerIsProposer: true },
  ],
}

describe('Trades — deadline and proposal cards', () => {
  it('redraft: deadline from settings with weeks left, graded card, and open-offer state', async () => {
    stubFetch({ '/api/league/trades-panel': panel })
    const { container } = render(<NativeTradesScreen league={redraft('NFL', { tradeDeadlineWeek: 12 })} teams={[]} />)
    expect((await screen.findByTestId('redraft-trade-deadline')).textContent).toContain('Deadline · Wk 12 · 3 weeks left')
    await screen.findByText('Rival')
    expect(container.querySelector('.nls-rd-grade')?.textContent).toBe('AF grade for you · B+')
    expect(screen.getByText('Awaiting response')).toBeTruthy()
  })

  it('redraft: a passed deadline and an unset one say so', async () => {
    stubFetch({ '/api/league/trades-panel': panel })
    const { unmount } = render(<NativeTradesScreen league={redraft('NFL', { tradeDeadlineWeek: 8 })} teams={[]} />)
    expect((await screen.findByTestId('redraft-trade-deadline')).getAttribute('data-state')).toBe('passed')
    unmount()
    render(<NativeTradesScreen league={redraft('NFL', { tradeDeadlineWeek: null })} teams={[]} />)
    expect((await screen.findByTestId('redraft-trade-deadline')).textContent).toContain('No trade deadline')
  })

  it('another format: the original chip and grade line', async () => {
    stubFetch({ '/api/league/trades-panel': panel })
    const { container } = render(<NativeTradesScreen league={dynasty('NFL', { tradeDeadlineWeek: 12 })} teams={[]} />)
    expect(await screen.findByText('Deadline · Wk 12')).toBeTruthy()
    expect(screen.getByText('AF grade for you · B+')).toBeTruthy()
    expect(screen.queryByTestId('redraft-trade-deadline')).toBeNull()
    expect(container.querySelector('.nls-rd-offer')).toBeNull()
  })
})

/* ── Standings ─────────────────────────────────────────────────────────────────────────────────── */

const standings = {
  season: 2026, scoredWeeks: 8, viewerRosterId: 'r2',
  standings: [
    { rosterId: 'r1', teamName: 'One', wins: 7, losses: 1, ties: 0, pointsFor: 900, pointsAgainst: 700, rank: 1 },
    { rosterId: 'r2', teamName: 'Two', wins: 6, losses: 2, ties: 0, pointsFor: 880, pointsAgainst: 720, rank: 2 },
    { rosterId: 'r3', teamName: 'Three', wins: 2, losses: 6, ties: 0, pointsFor: 700, pointsAgainst: 800, rank: 3 },
    { rosterId: 'r4', teamName: 'Four', wins: 1, losses: 7, ties: 0, pointsFor: 650, pointsAgainst: 850, rank: 4 },
  ],
}
const runtime = (generated: boolean) => ({
  playoffs: {
    seeds: [{ seed: 1, rosterId: 'r1', displayName: 'One' }, { seed: 2, rosterId: 'r2', displayName: 'Two' }],
    eliminatedRosterIds: ['r3', 'r4'],
    bracket: {
      generated, championRosterId: null,
      rounds: generated ? [{ roundId: 'f', roundNumber: 1, roundName: 'Championship', status: 'active', matchups: [{ matchupId: 'm', homeRosterId: 'r1', awayRosterId: 'r2', homeSeed: 1, awaySeed: 2, homeScore: 101.5, awayScore: 99, winnerRosterId: null, status: 'live', bye: false, complete: false }] }] : [],
    },
  },
})
const sLeague = (fmt: typeof redraft) => fmt('NFL', { settings: { playoff_team_count: 2 } })

describe('Standings & playoffs — playoff line, clinched / eliminated, bracket', () => {
  it('redraft before the bracket: a labelled playoff line and NO clinched / eliminated claim', async () => {
    stubFetch({ '/scoring/standings': standings, '/playoff-runtime': runtime(false), '/scoring/playoff-seeds': { seeds: [] } })
    render(<NativeStandingsScreen league={sLeague(redraft)} isCommissioner={false} onSelectTab={() => {}} />)
    expect((await screen.findByTestId('native-standings-playoff-line')).textContent).toBe('Playoff line · top 2')
    await waitFor(() => expect(screen.queryByTestId('native-standings-race-r1')).toBeNull())
    expect(screen.queryByText('Eliminated')).toBeNull()
    // The labelled line says it, so no note under the table says it again (2026-11-24).
    expect(screen.queryByText(/The labelled line is the playoff cut/)).toBeNull()
    expect(screen.queryByText(/Order and tiebreaks follow/)).toBeNull()
  })

  it('redraft after generation: clinched and eliminated chips, and the bracket on Playoff picture', async () => {
    stubFetch({ '/scoring/standings': standings, '/playoff-runtime': runtime(true), '/scoring/playoff-seeds': { seeds: [] } })
    render(<NativeStandingsScreen league={sLeague(redraft)} isCommissioner={false} onSelectTab={() => {}} />)
    expect((await screen.findByTestId('native-standings-race-r1')).textContent).toBe('Clinched')
    expect(screen.getByTestId('native-standings-race-r4').textContent).toBe('Eliminated')
    fireEvent.click(screen.getByRole('button', { name: 'Playoffs' }))
    const bracket = await screen.findByTestId('redraft-playoff-bracket-view')
    expect(within(bracket).getByText('Championship')).toBeTruthy()
    expect(within(bracket).getByText('101.5')).toBeTruthy()
  })

  it('another format: no runtime read, no labelled line, no chips, no bracket view', async () => {
    const calls = stubFetch({ '/scoring/standings': standings, '/playoff-runtime': runtime(true), '/scoring/playoff-seeds': { seeds: [] } })
    render(<NativeStandingsScreen league={sLeague(dynasty)} isCommissioner={false} onSelectTab={() => {}} />)
    await screen.findByRole('table')
    expect(screen.queryByTestId('native-standings-playoff-line')).toBeNull()
    expect(screen.queryByTestId('native-standings-race-r1')).toBeNull()
    expect(calls.some((u) => u.includes('playoff-runtime'))).toBe(false)
    expect(screen.getByText(/Cyan line = playoff cut/)).toBeTruthy()
  })
})

/* ── My team ───────────────────────────────────────────────────────────────────────────────────── */

const wire = (id: string, position: string, extra: Record<string, unknown> = {}) => ({ id, name: `P ${id}`, position, team: 'BOS', sport: 'NBA', injuryStatus: null, projectedPoints: 20, product: { unified: {}, yearsExp: null }, ...extra })
const lineupRoster = (unifiedRoster: unknown[], daily: boolean) => ({
  rosterId: 'ros1', leagueWeek: 9, canEditLineup: true, faabRemaining: 50,
  starterSlots: [{ index: 0, label: 'C', allowedPositions: ['C'], isFlexible: false }, { index: 1, label: 'PG', allowedPositions: ['PG'], isFlexible: false }],
  roster: { lineup_sections: { starters: [{ id: 'a' }, { id: 'b' }], bench: [{ id: 'c' }], ir: [], taxi: [], devy: [] } },
  unifiedRoster,
  dailyLineups: daily ? { week: 9, today: '2026-10-31', days: [{ day: '2026-10-31', status: 'today', slots: {}, points: {}, starterPoints: 0 }], weekPoints: 0, startedPoints: {} } : null,
})
const team = { id: 't', teamName: 'Mine', wins: 3, losses: 1, ties: 0, pointsFor: 400, currentRank: 2 } as never

describe('My team — position chips and bye / off-day badges', () => {
  it('redraft daily: an off day only for the player the schedule says has no game; bench shows his position', async () => {
    stubFetch({ '/api/league/roster': lineupRoster([wire('a', 'C', { periodOpponent: 'DEN' }), wire('b', 'PG', { periodOpponent: null }), wire('c', 'SF', { periodOpponent: 'LAL' })], true), '/claims': { claims: [] }, '/state': { state: {} }, '/settings': {} })
    const { container } = render(<NativeLineupScreen league={redraft('NBA')} userTeam={team} onSelectTab={() => {}} />)
    expect(await screen.findByTestId('lineup-off-day-b')).toBeTruthy()
    expect(screen.queryByTestId('lineup-off-day-a')).toBeNull()
    expect(container.querySelector('[data-rd-screen=lineup]')).toBeTruthy()
    // Starter slots by sport tone; the bench row shows the player's own position (SF = NBA forward, green).
    expect([...container.querySelectorAll('.nls-lrow .nls-pos')].map((p) => [p.textContent, p.getAttribute('data-rd-pos')])).toEqual([
      ['C', 'amber'],
      ['PG', 'blue'],
      ['SF', 'green'],
    ])
  })

  it('redraft daily with no schedule loaded: nobody is marked off', async () => {
    stubFetch({ '/api/league/roster': lineupRoster([wire('a', 'C', { periodOpponent: null }), wire('b', 'PG', { periodOpponent: null }), wire('c', 'SF')], true), '/claims': { claims: [] }, '/state': { state: {} }, '/settings': {} })
    render(<NativeLineupScreen league={redraft('NBA')} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('P a')
    expect(screen.queryByText('Off day')).toBeNull()
  })

  it('redraft weekly: a real bye is badged', async () => {
    stubFetch({ '/api/league/roster': lineupRoster([wire('a', 'QB'), wire('b', 'RB', { product: { unified: {}, yearsExp: null, byeWeek: 9 } }), wire('c', 'WR')], false), '/claims': { claims: [] }, '/state': { state: {} }, '/settings': {} })
    render(<NativeLineupScreen league={redraft('NFL')} userTeam={team} onSelectTab={() => {}} />)
    expect(await screen.findByTestId('lineup-bye-b')).toBeTruthy()
    expect(screen.queryByTestId('lineup-bye-a')).toBeNull()
    // The bye badge stands alone in the bye week: the "Bye 9" tag would say it twice.
    expect(screen.queryByTestId('lineup-bye-week-b')).toBeNull()
  })

  it('a team defense’s projection is labelled Sleeper; an AF projection is not', async () => {
    stubFetch({ '/api/league/roster': lineupRoster([wire('a', 'QB', { projectedPoints: 20, projectionsSource: 'allfantasy' }), wire('b', 'DEF', { projectedPoints: 6.4, projectionsSource: 'sleeper' }), wire('c', 'WR')], false), '/claims': { claims: [] }, '/state': { state: {} }, '/settings': {} })
    render(<NativeLineupScreen league={redraft('NFL')} userTeam={team} onSelectTab={() => {}} />)
    const label = await screen.findByTestId('lineup-proj-source-b')
    expect(label.textContent).toBe('Sleeper')
    expect(label.getAttribute('title')).toContain('AllFantasy does not project team defenses')
    expect(screen.queryByTestId('lineup-proj-source-a')).toBeNull()
  })

  it('a club’s bye week and the game’s forecast are drawn on the row', async () => {
    const wx = { indoors: false, symbol: '☔', conditionLabel: 'Rain', temperatureF: 46.6, windSpeedMph: 11, precipChancePct: 70 }
    stubFetch({ '/api/league/roster': lineupRoster([wire('a', 'QB', { teamByeWeek: 7, periodOpponent: 'NYG', periodWeather: wx }), wire('b', 'RB', { periodWeather: { ...wx, indoors: true, symbol: '⌂' } }), wire('c', 'WR')], false), '/claims': { claims: [] }, '/state': { state: {} }, '/settings': {} })
    render(<NativeLineupScreen league={redraft('NFL')} userTeam={team} onSelectTab={() => {}} />)
    expect((await screen.findByTestId('lineup-bye-week-a')).textContent).toBe('Bye 7')
    expect(screen.getByTestId('lineup-weather-a').textContent).toContain('☔ 47°')
    expect(screen.getByTestId('lineup-weather-a').textContent).toContain('70% chance of rain or snow')
    expect(screen.getByTestId('lineup-weather-b').textContent).toContain('Dome')
    expect(screen.queryByTestId('lineup-bye-week-c')).toBeNull()
    expect(screen.queryByTestId('lineup-weather-c')).toBeNull()
  })

  it('another format: no badges, no sport tones, bench keeps the BN pill', async () => {
    stubFetch({ '/api/league/roster': lineupRoster([wire('a', 'C', { periodOpponent: 'DEN' }), wire('b', 'PG', { periodOpponent: null }), wire('c', 'SF', { periodOpponent: 'LAL' })], true), '/claims': { claims: [] }, '/state': { state: {} }, '/settings': {} })
    const { container } = render(<NativeLineupScreen league={dynasty('NBA')} userTeam={team} onSelectTab={() => {}} />)
    await screen.findByText('P a')
    expect(screen.queryByText('Off day')).toBeNull()
    expect(container.querySelector('[data-rd-pos]')).toBeNull()
    expect([...container.querySelectorAll('.nls-lrow .nls-pos')].map((p) => p.textContent)).toEqual(['C', 'PG', 'BN'])
  })
})
