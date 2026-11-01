import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GUILLY_DEFAULTS, buildGuillyCreateBody, buildGuillyFollowUps, summarizeGuilly, validateGuillySetup,
} from '@/lib/guilly/setup'
import { buildGuillyHub, describeTiebreak } from '@/lib/guilly/hub'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
afterEach(() => cleanup())

const named = { ...GUILLY_DEFAULTS, name: 'Chop Night' }

describe('Guilly setup', () => {
  it('summarizes the season the way the engine runs it: one chop a week', () => {
    expect(summarizeGuilly({ leagueSize: 18, firstChopWeek: 1 })).toMatchObject({ chops: 17, lastChopWeek: 17, fitsSeason: true })
    expect(summarizeGuilly({ leagueSize: 20, firstChopWeek: 3 })).toMatchObject({ chops: 19, lastChopWeek: 21, fitsSeason: true })
  })

  it('matches the guillotine engine NBA season length and team cap', () => {
    const nba = getGuillotineSportConfig('NBA')
    expect(summarizeGuilly({ leagueSize: 18, firstChopWeek: 1 }).seasonWeeks).toBe(nba.regularSeasonWeeks)
    expect(20).toBeLessThanOrEqual(nba.maxTeams)
  })

  it('accepts the defaults and refuses every option the engine cannot run', () => {
    expect(validateGuillySetup(named)).toEqual([])
    expect(validateGuillySetup({ ...named, lineups: 'bestball' })).toHaveLength(1)
    expect(validateGuillySetup({ ...named, doubleChop: true })).toHaveLength(1)
    expect(validateGuillySetup({ ...named, release: 'free_agency' })).toHaveLength(1)
    expect(validateGuillySetup({ ...named, auctionBudget: 500 })).toHaveLength(1)
    // The auction budget only matters for an auction draft.
    expect(validateGuillySetup({ ...named, draft: 'snake', auctionBudget: 500 })).toEqual([])
    expect(validateGuillySetup({ ...named, name: '  ' })).toHaveLength(1)
  })

  it('creates an NBA Guilly league through the existing create route', () => {
    expect(buildGuillyCreateBody({ ...named, draft: 'snake', leagueSize: 14 })).toEqual({
      platform: 'manual', name: 'Chop Night', sport: 'NBA', leagueSize: 14, leagueType: 'guillotine', draftType: 'snake',
      settings: { teamCount: 14, roster_mode: 'redraft' },
    })
  })

  it('saves first chop week and FAAB through existing permission-checked routes', () => {
    expect(buildGuillyFollowUps('L1', named).map((f) => f.url)).toEqual(['/api/waiver-wire/leagues/L1/settings'])
    const steps = buildGuillyFollowUps('L1', { ...named, firstChopWeek: 2, faabBudget: 2000 })
    expect(steps).toEqual([
      { method: 'PATCH', url: '/api/leagues/L1/guillotine/summary', body: { eliminationStartWeek: 2 }, label: 'First chop week' },
      { method: 'PUT', url: '/api/waiver-wire/leagues/L1/settings', body: { waiverType: 'faab', faabBudget: 2000 }, label: 'Season FAAB' },
    ])
  })

  it('renders unsupported options disabled', async () => {
    const { GuillySetup } = await import('@/components/guilly/GuillySetup')
    render(<GuillySetup />)
    expect((screen.getByRole('button', { name: /Bestball/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Free agency/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^On/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '$200' }) as HTMLButtonElement).disabled).toBe(false)
    expect((within(screen.getByRole('group', { name: 'Auction budget' })).getByRole('button', { name: /\$500/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('guilly-summary').textContent).toContain('Week 17')
  })
})

describe('Guilly hub model', () => {
  const payload = {
    weekOrPeriod: 8,
    choppedThisWeek: [],
    survivalStandings: [
      { rosterId: 'a', displayName: 'Buckets', rank: 1, seasonPointsCumul: 900 },
      { rosterId: 'b', displayName: 'Dunk', rank: 2, seasonPointsCumul: 800 },
      { rosterId: 'c', displayName: 'Brick', rank: 3, seasonPointsCumul: 700 },
    ],
    dangerTiers: [
      { rosterId: 'c', tier: 'chop_zone', pointsFromChopZone: 0 },
      { rosterId: 'b', tier: 'danger', pointsFromChopZone: 6.04 },
      { rosterId: 'a', tier: 'safe', pointsFromChopZone: 41.6 },
    ],
    recentChopEvents: [{ weekOrPeriod: 7, choppedRosterIds: ['z'] }],
    myRosterId: 'b',
  }

  it('orders the board best-first with heads from the engine tier', () => {
    const hub = buildGuillyHub(payload)
    expect(hub.blade.map((r) => [r.name, r.head])).toEqual([['Buckets', 'calm'], ['Dunk', 'nervous'], ['Brick', 'ko']])
    expect(hub.me?.overBlade).toBe(6)
    expect(hub.graveyard).toEqual([{ rosterId: 'z', week: 7, name: 'A chopped team' }])
  })

  it('describes the league\'s configured tiebreak, not the handoff\'s', () => {
    expect(describeTiebreak(['bench_points', 'season_points', 'commissioner'])).toBe('Ties at the blade line go to bench points, then season points, then the commissioner.')
  })
})
