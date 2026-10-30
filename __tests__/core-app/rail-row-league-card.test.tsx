import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RailRowBody } from '@/components/core-app/RailRowBody'
import type { RailMatchupSummary } from '@/components/core-app/AfCoreShell'
import { leagueSportIcon } from '@/lib/core-app/leagueSports'

/*
 * The league list as a Sleeper-style card (user call, 2026-10-30): league name, the platform in
 * its own colour, then both managers with VS between them and each one's points underneath.
 * No week line and no AllFantasy engine column.
 */

const h2h = (over: Partial<RailMatchupSummary> = {}): RailMatchupSummary => ({
  season: 2026, week: 9, yourTeam: 'Ciege Squad', yourAvatarUrl: null, yourScore: 0,
  yourProjection: { projected: 150.2, afProjected: 167.56, afEngine: 171.9, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 },
  opponentTeam: 'Logan8888', opponentAvatarUrl: null, opponentScore: 0,
  opponentProjection: { projected: 170.1, afProjected: 176.8, afEngine: 180.4, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 },
  scored: false, freshAt: null, source: 'live_cache', ...over,
})

const draw = (platform: string, m: RailMatchupSummary | null = h2h()) =>
  render(<RailRowBody name="Yellow Buffalo Dynasty" platform={platform} m={m} showScoreStatus />).container

describe('RailRowBody — the league card', () => {
  it('both managers either side of VS, each with the league-scored projection and no AF engine number', () => {
    const el = draw('sleeper')
    const sides = [...el.querySelectorAll('.af-rail-row-side')]
    expect(sides.map((s) => s.querySelector('.af-rail-row-team')?.textContent)).toEqual(['Ciege Squad', 'Logan8888'])
    expect(sides[1]!.getAttribute('data-side')).toBe('them')
    expect(el.querySelector('.af-rail-row-line')?.getAttribute('data-vs')).toBe('true')
    expect(el.querySelector('.af-rail-row-vs')?.textContent).toBe('VS')
    expect(sides.map((s) => s.querySelector('.af-rail-row-projected')?.textContent)).toEqual(['proj167.6', 'proj176.8'])
    expect(el.textContent).not.toMatch(/171\.9|180\.4|SLPR|SCORE/)
  })

  it('an unplayed week draws no score, never 0.0', () => {
    const el = draw('sleeper')
    expect(el.querySelector('.af-rail-row-score')).toBeNull()
    expect(el.textContent).not.toContain('0.0')
  })

  it('a played week draws each score above its projection', () => {
    const el = draw('sleeper', h2h({ scored: true, yourScore: 88.4, opponentScore: 79.2 }))
    expect([...el.querySelectorAll('.af-rail-row-score')].map((n) => n.textContent)).toEqual(['88.4', '79.2'])
  })

  it('no week line', () => {
    expect(draw('sleeper').textContent).not.toMatch(/Week 9|Wk 9/)
  })

  it('the platform chip names the platform and carries its colour key; AllFantasy leagues are native', () => {
    const chip = (platform: string) => draw(platform).querySelector('.af-rail-row-plat')!
    expect([chip('sleeper').textContent, chip('sleeper').getAttribute('data-platform')]).toEqual(['Sleeper', 'sleeper'])
    expect([chip('fantrax').textContent, chip('fantrax').getAttribute('data-platform')]).toEqual(['Fantrax', 'fantrax'])
    expect([chip('espn').textContent, chip('espn').getAttribute('data-platform')]).toEqual(['ESPN', 'espn'])
    for (const native of ['manual', 'allfantasy', 'native']) {
      expect([chip(native).textContent, chip(native).getAttribute('data-platform')]).toEqual(['AllFantasy', 'native'])
    }
  })
})

describe('leagueSportIcon', () => {
  it('gives each sport heading its ball, and nothing for "Other"', () => {
    expect(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'].map(leagueSportIcon)).toEqual(['🏈', '🏀', '🏒', '⚾', '🏈', '🏀', '⚽'])
    expect(leagueSportIcon(null)).toBe('')
  })
})
