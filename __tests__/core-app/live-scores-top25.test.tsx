import { vi } from 'vitest'
vi.mock('next/navigation', () => ({ usePathname: () => '/core/live', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }) }))
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { LiveScores, top25Href } from '@/components/core-app/screens/LiveScores'
import { pollIsKnown } from '@/lib/live/collegeTop25'
import type { LiveGameCard, LivePageData } from '@/lib/live/liveScoresPage'

/*
 * The college Top 25 filter must say what it hid (live, 2026-10-08): an all-unranked Thursday slate
 * rendered "We could not read your rosters. Switch to All games" — on the All games tab — because the
 * empty state had no idea a filter had emptied it.
 */

function game(id: string): LiveGameCard {
  const side = (abbrev: string, rank: number | null) => ({ abbrev, name: `${abbrev} team`, logo: '', score: null, record: null, linescores: [], hits: null, errors: null, leaders: [], shooting: null, rank })
  return {
    gameId: id,
    sport: 'NCAAF',
    week: 6,
    status: 'scheduled',
    statusDetail: 'Sat',
    clockLabel: null,
    isLive: false,
    completed: false,
    startTime: '2026-10-10T16:00:00.000Z',
    home: side(`${id}H`, 5),
    away: side(`${id}A`, null),
    winProbability: null,
    topPerformer: null,
    leaders: [],
    situation: null,
    venue: null,
    broadcast: null,
    espnDetail: true,
    leadersArePregame: false,
    tieIns: [],
    leaguesAffected: 0,
  } as LiveGameCard
}

function payload(over: Partial<LivePageData>): LivePageData {
  return {
    sport: 'NCAAF',
    scope: 'all',
    counts: [{ sport: 'NCAAF', label: 'College Football', slateCount: 1 }],
    games: [],
    impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, biggestMover: null, plays: [], upNext: [] },
    lockAlerts: [],
    fetchedAt: '2026-10-10T15:00:00.000Z',
    hasRosterData: true,
    loadFailed: false,
    rosterFailed: false,
    top25: null,
    ...over,
  } as LivePageData
}

describe('college Top 25 on /core/live', () => {
  it('an empty slate says the filter emptied it — not a roster fault — and offers every game', () => {
    const { container } = render(<LiveScores data={payload({ rosterFailed: true, top25: { hidden: 4, showingAll: false } })} />)
    const text = container.textContent ?? ''
    expect(text).toContain('No Top 25 games on this slate.')
    expect(text).toContain('4 games between unranked teams are hidden.')
    expect(text).not.toContain('We could not read your rosters.')
    const showAll = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Show all games')
    expect(showAll?.getAttribute('href')).toBe('/core/live?sport=NCAAF&scope=all&t25=off')
  })

  it('says how many games it hid above a slate it did not empty, and draws the rank', () => {
    const { container } = render(<LiveScores data={payload({ games: [game('g1')], top25: { hidden: 12, showingAll: false } })} />)
    expect(container.querySelector('.af-live-top25-note')?.textContent).toContain('Top 25 and teams you follow · 12 other games hidden.')
    expect(container.querySelector('.af-live-team-rank')?.textContent).toBe('5')
  })

  it('offers the way back once everything is showing', () => {
    const { container } = render(<LiveScores data={payload({ games: [game('g1')], top25: { hidden: 0, showingAll: true } })} />)
    const note = container.querySelector('.af-live-top25-note')
    expect(note?.textContent).toContain('Showing every game.')
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/core/live?sport=NCAAF&scope=all')
  })

  it('says nothing on a non-college tab', () => {
    const { container } = render(<LiveScores data={payload({ sport: 'NFL', games: [game('g1')], top25: null })} />)
    expect(container.querySelector('.af-live-top25-note')).toBeNull()
  })

  it('builds its links from the tab and scope', () => {
    expect(top25Href('NCAAB', 'my', true)).toBe('/core/live?sport=NCAAB&t25=off')
    expect(top25Href('NCAAB', 'all', false)).toBe('/core/live?sport=NCAAB&scope=all')
  })

  it('🛑 an all-unranked ESPN slate is a known poll: null is "unranked", undefined is "no data"', () => {
    expect(pollIsKnown(null, [{ homeRank: null, awayRank: null }])).toBe(true)
    expect(pollIsKnown(null, [{}])).toBe(false)
  })
})
