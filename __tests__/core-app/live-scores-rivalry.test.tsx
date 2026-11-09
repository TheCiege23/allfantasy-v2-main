import { vi } from 'vitest'
vi.mock('next/navigation', () => ({ usePathname: () => '/core/live', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }) }))
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { LiveScores } from '@/components/core-app/screens/LiveScores'
import type { LiveGameCard, LivePageData } from '@/lib/live/liveScoresPage'

function game(id: string, away: string, home: string, sport = 'NCAAF'): LiveGameCard {
  const side = (name: string) => ({ abbrev: name.slice(0, 4).toUpperCase(), name, logo: '', score: null, record: null, linescores: [], hits: null, errors: null, leaders: [], shooting: null, rank: null })
  return {
    gameId: id,
    sport,
    week: 13,
    status: 'scheduled',
    statusDetail: 'Sat',
    clockLabel: null,
    isLive: false,
    completed: false,
    startTime: '2026-11-28T20:30:00.000Z',
    home: side(home),
    away: side(away),
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

function payload(games: LiveGameCard[], sport = 'NCAAF'): LivePageData {
  return {
    sport,
    scope: 'all',
    counts: [{ sport, label: 'College Football', slateCount: games.length }],
    games,
    impact: { totalPoints: 0, livePlayers: 0, liveGames: 0, biggestMover: null, plays: [], upNext: [] },
    lockAlerts: [],
    fetchedAt: '2026-11-28T15:00:00.000Z',
    hasRosterData: true,
    loadFailed: false,
    rosterFailed: false,
    top25: null,
  } as LivePageData
}

describe('rivalry crests on live matchup cards', () => {
  it('puts the rivalry band, with its own crest, only on the rivalry game', () => {
    const { container } = render(<LiveScores data={payload([
      game('g1', 'Auburn Tigers', 'Alabama Crimson Tide'),
      game('g2', 'Michigan State Spartans', 'Ohio State Buckeyes'),
    ])} />)
    const bands = [...container.querySelectorAll('.af-live-rivalry')]
    expect(bands).toHaveLength(1)
    expect(bands[0]!.getAttribute('data-rivalry')).toBe('iron')
    expect(bands[0]!.textContent).toContain('Iron Bowl')
    expect(bands[0]!.querySelector('svg.af-pb-crest')?.getAttribute('data-bowl')).toBe('iron')
    // Decorative: the rivalry name beside it says which game this is.
    expect(bands[0]!.querySelector('svg.af-pb-crest')?.getAttribute('aria-hidden')).toBe('true')
    expect(bands[0]!.closest('.af-live-game')?.textContent).toContain('Auburn Tigers')
  })
})
