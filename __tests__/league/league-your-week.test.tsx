/** "Your week" strip on the native league home (2026-10-13). */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildYourWeek, nextKickoff } from '@/lib/league/your-week'
import { LeagueYourWeekStrip, loadYourWeek } from '@/components/league/native/LeagueYourWeekStrip'
import type { MatchupCenterPayload, MatchupSidePayload } from '@/lib/matchup-center/types'

afterEach(() => vi.unstubAllGlobals())

const NOW = '2026-11-08T17:00:00.000Z' // Sun 12:00pm ET

function side(over: Partial<MatchupSidePayload> = {}): MatchupSidePayload {
  return { projectedTotalIncludesFallback: false, rosterId: 'r', teamName: 'Team', avatarUrl: null, record: { wins: 0, losses: 0, ties: 0 }, winPct: 0, totalPoints: 0, projectedTotal: 0, starters: [], remainingStarters: 0, ...over }
}
function matchup(over: Partial<MatchupCenterPayload> = {}): MatchupCenterPayload {
  return {
    leagueId: 'L1', season: 2026, week: 9, sport: 'NFL', matchupStatus: 'live', conceptOverlay: null,
    left: side({ teamName: 'Me', totalPoints: 88.4, projectedTotal: 120, remainingStarters: 3 }),
    right: side({ teamName: 'Rival', totalPoints: 76, projectedTotal: 110 }),
    winProbabilityLeft: null, insights: {} as MatchupCenterPayload['insights'], partialData: false, refreshIntervalMs: 60000,
    ...over,
  }
}

describe('building your week', () => {
  it('live: score, who you play, and how many are still to play', () => {
    const w = buildYourWeek({ matchup: matchup(), now: NOW })
    expect(w.matchup).toMatchObject({ you: { name: 'Me', points: 88.4 }, them: { name: 'Rival' }, headline: 'Winning by 12.4', yetToPlay: 3 })
    expect(w.week).toBe(9)
  })

  it('before kickoff it quotes the projection — but never a fallback projection', () => {
    expect(buildYourWeek({ matchup: matchup({ matchupStatus: 'upcoming' }), now: NOW }).matchup!.headline).toBe('Projected 120.0 – 110.0')
    const shaky = matchup({ matchupStatus: 'upcoming', right: side({ teamName: 'Rival', projectedTotalIncludesFallback: true, projectedTotal: 999 }) })
    expect(buildYourWeek({ matchup: shaky, now: NOW }).matchup!.headline).toBe('Not started yet')
  })

  it('final and behind', () => {
    expect(buildYourWeek({ matchup: matchup({ matchupStatus: 'final', left: side({ teamName: 'Me', totalPoints: 70 }), right: side({ teamName: 'Rival', totalPoints: 73 }) }), now: NOW }).matchup!.headline).toBe('Lost by 3.0')
  })

  it('no opponent (guillotine/survivor): no matchup tile and no week — the stakes card owns those, with the right week', () => {
    const w = buildYourWeek({ matchup: matchup({ week: 1, right: side({ teamName: 'No opponent' }) }), now: NOW, waiverNextRunAt: '2099-01-01T00:00:00.000Z' })
    expect(w.matchup).toBeNull()
    expect(w.week).toBeNull()
    expect(w.empty).toBe(false)
    expect(buildYourWeek({ matchup: matchup({ right: side({ teamName: 'No opponent' }) }), now: NOW }).empty).toBe(true)
  })

  it('locks at the next kickoff that has not started; none when there are no game times', () => {
    const games = [
      { scheduledStart: '2026-11-08T14:30:00.000Z', final: true },
      { scheduledStart: '2026-11-08T18:00:00.000Z' },
      { scheduledStart: '2026-11-08T21:25:00.000Z' },
    ]
    expect(nextKickoff(games, NOW)).toBe('2026-11-08T18:00:00.000Z')
    expect(buildYourWeek({ games, now: NOW }).lock).toMatchObject({ state: 'soon', label: 'locks in 1h 0m' })
    expect(buildYourWeek({ games: null, now: NOW }).lock).toBeNull()
  })

  it('empty slots and injured starters come from the lineup validator', () => {
    const w = buildYourWeek({
      now: NOW,
      lineupIssues: [
        { code: 'missing_starter_slot', slotType: 'FLEX' },
        { code: 'starter_ineligible_injury', playerName: 'Hurt Guy' },
        { code: 'starter_injury_risk', playerName: 'Maybe Guy' },
        { code: 'bench_overflow' },
      ],
    })
    expect(w.emptySlots).toBe(1)
    expect(w.injured).toEqual([{ name: 'Hurt Guy', status: 'Out', out: true }, { name: 'Maybe Guy', status: 'Questionable', out: false }])
  })

  it('starters on bye and blocking lineup errors count; warnings do not', () => {
    const w = buildYourWeek({
      now: NOW,
      lineupIssues: [
        { code: 'starter_on_bye', playerName: 'Bye Guy', severity: 'error' },
        { code: 'illegal_lineup_slot', severity: 'error' },
        { code: 'starter_slot_overflow', severity: 'error' },
        { code: 'bench_slot_overflow', severity: 'warning' },
      ],
    })
    expect(w.onBye).toEqual([{ name: 'Bye Guy' }])
    expect(w.otherErrors).toBe(2)
    expect(w.empty).toBe(false)
  })

  it('without a validator, injuries come from the matchup starters (not ones already finished)', () => {
    const starter = (name: string, injuryStatus: string | null, gameStatus: 'upcoming' | 'final' = 'upcoming') =>
      ({ playerId: name, name, position: 'WR', team: null, opponent: null, headshotUrl: null, currentPoints: 0, projectedPoints: 0, hasRealProjection: true, injuryStatus, newsBlurb: null, weatherSummary: null, gameStatus, gameLabel: '', aiInsight: null })
    const w = buildYourWeek({ now: NOW, matchup: matchup({ left: side({ teamName: 'Me', starters: [starter('A', 'Out'), starter('B', 'Questionable'), starter('C', 'Out', 'final'), starter('D', null), starter('E', 'Probable')] }) }) })
    expect(w.injured.map((p) => `${p.name}:${p.out}`)).toEqual(['A:true', 'B:false'])
  })

  it('waivers only when the next run is in the future; empty when nothing loaded', () => {
    expect(buildYourWeek({ now: NOW, waiverNextRunAt: '2026-11-11T08:00:00.000Z' }).waivers).toEqual({ at: '2026-11-11T08:00:00.000Z' })
    expect(buildYourWeek({ now: NOW, waiverNextRunAt: '2026-11-01T08:00:00.000Z' }).waivers).toBeNull()
    expect(buildYourWeek({ now: NOW }).empty).toBe(true)
  })
})

describe('the strip', () => {
  function stub(responses: Record<string, unknown>) {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      const key = Object.keys(responses).find((k) => url.includes(k))
      return key && responses[key] !== null ? ({ ok: true, json: async () => responses[key] } as Response) : ({ ok: false, status: 404, json: async () => ({}) } as Response)
    }))
    return calls
  }

  it('loads the existing endpoints with the week, and degrades source by source', async () => {
    const calls = stub({ 'matchup-center': { payload: matchup() }, 'redraft/roster': null, 'waiver-wire': { settings: { nextRunAt: null } } })
    const w = await loadYourWeek('L 1', 9, () => NOW)
    expect(calls).toEqual(expect.arrayContaining(['/api/leagues/L%201/matchup-center?week=9', '/api/redraft/roster?leagueId=L%201&week=9', '/api/waiver-wire/leagues/L%201/state']))
    expect(w.matchup?.headline).toBe('Winning by 12.4')
    expect(w.emptySlots).toBe(0)
    expect(w.waivers).toBeNull()
  })

  it('with no week from the shell, the matchup is asked for the week the roster resolved', async () => {
    const calls = stub({ 'matchup-center': { payload: matchup({ week: 6 }) }, 'redraft/roster': { week: 6, roster: { lineupValidation: { issues: [] } } }, 'waiver-wire': null })
    const w = await loadYourWeek('L1', null, () => NOW)
    expect(calls).toContain('/api/leagues/L1/matchup-center?week=6')
    expect(w.week).toBe(6)
  })

  it('renders each tile and sends you to the tab that fixes it', async () => {
    stub({
      'matchup-center': { payload: matchup() },
      'redraft/roster': { roster: { lineupValidation: { issues: [{ code: 'missing_starter_slot' }, { code: 'starter_ineligible_injury', playerName: 'Hurt Guy' }] } } },
      'waiver-wire': { settings: { nextRunAt: '2099-11-11T08:00:00.000Z' } },
    })
    const onSelectTab = vi.fn()
    render(<LeagueYourWeekStrip leagueId="L1" week={9} onSelectTab={onSelectTab} />)
    expect((await screen.findByTestId('your-week-score')).textContent).toBe('88.4 – 76.0')
    expect(screen.getByTestId('your-week-problems').textContent).toContain('1 empty slot · 1 injured')
    expect(screen.getByTestId('your-week-problems').textContent).toContain('Hurt Guy (Out)')
    expect(screen.getByTestId('your-week-waivers')).toBeTruthy()
    fireEvent.click(screen.getByTestId('your-week-matchup'))
    fireEvent.click(screen.getByTestId('your-week-problems'))
    fireEvent.click(screen.getByTestId('your-week-waivers'))
    expect(onSelectTab.mock.calls.map((c) => c[0])).toEqual(['matchups', 'roster', 'players'])
  })

  it('renders nothing when every source is empty or failing', async () => {
    const calls = stub({ 'matchup-center': null, 'redraft/roster': null, 'waiver-wire': null })
    render(<LeagueYourWeekStrip leagueId="L1" week={null} onSelectTab={vi.fn()} />)
    await vi.waitFor(() => expect(calls.length).toBe(3))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('your-week')).toBeNull()
  })
})
