import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LeagueRailRow, leagueRailRowView, type LeagueRailData } from '@/components/league/native/LeagueRail'

/**
 * The /league/[leagueId] league rail draws /core's rail row (RailRowBody) from /core's rail data
 * (getRailMatchups + the /api/core/rail-scores live poll). It used to be two-letter chips with a
 * platform tag and "WK 6" — no league name, score, projection or manager (user report 2026-10-18).
 */

const league = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'Kings of the Court', platform: 'sleeper', currentWeek: 6, lifecycleState: 'in_season', status: undefined, ...over,
}) as never

const proj = (p: number, af: number) => ({ projected: p, afProjected: p, afEngine: af, afEngineFrom: 9, pricedFrom: 9, starterCount: 9 })
const RAIL: LeagueRailData = {
  imageUrls: { s1: null },
  matchups: {
    s1: {
      season: 2026, week: 6, yourTeam: 'Ciege Squad', yourAvatarUrl: null, yourScore: 88.4, yourProjection: proj(112.3, 115),
      opponentTeam: 'Hoop Dreams', opponentAvatarUrl: null, opponentScore: 79.2, opponentProjection: proj(104.8, 101.2),
      scored: true, freshAt: '2026-10-18T12:00:00.000Z', source: 'live_cache',
    },
  },
}
const NO_LIVE = { scores: {}, delayed: [] as string[] }
const CLOCK = Date.parse('2026-10-18T12:03:00.000Z')

describe('leagueRailRowView', () => {
  it('maps the saved matchup, platform, week and freshness', () => {
    const v = leagueRailRowView(league(), RAIL, NO_LIVE, CLOCK)
    expect(v.platform).toBe('sleeper')
    expect(v.platformLabel).toBe('Sleeper')
    expect(v.weekLabel).toBe('Wk 6')
    expect(v.m?.yourScore).toBe(88.4)
    expect(v.freshMinutes).toBe(3)
    expect(v.isLive).toBe(false)
  })

  it('folds every native spelling into AF', () => {
    for (const platform of ['allfantasy', 'af', 'manual', 'native']) {
      const v = leagueRailRowView(league({ id: 'n1', platform }), RAIL, NO_LIVE, CLOCK)
      expect([v.platform, v.platformLabel]).toEqual(['native', 'AF'])
      expect(v.m).toBeNull()
    }
  })

  it('lays a fresh live poll over the snapshot, keeping same-week projections, and calls it live', () => {
    const live = { ...RAIL.matchups.s1, yourScore: 101.5, season: 2026, week: 6, updatedAt: '2026-10-18T12:02:30.000Z' }
    const v = leagueRailRowView(league(), RAIL, { scores: { s1: live as never }, delayed: [] }, CLOCK)
    expect(v.m?.yourScore).toBe(101.5)
    expect(v.m?.yourProjection?.afEngine).toBe(115)
    expect(v.isLive).toBe(true)
    // A stale poll (>90s) is delayed and is NOT drawn as live — the positive control for the gate above.
    const stale = leagueRailRowView(league(), RAIL, { scores: { s1: live as never }, delayed: [] }, CLOCK + 120_000)
    expect([stale.delayed, stale.isLive]).toEqual([true, false])
  })

  it('falls back to the phase when there is no week to show', () => {
    expect(leagueRailRowView(league({ id: 'x', currentWeek: undefined, lifecycleState: 'drafting' }), RAIL, NO_LIVE, CLOCK).weekLabel).toBe('Draft')
  })
})

describe('LeagueRailRow', () => {
  it('renders league name, both managers with VS between them, the score and one projection each', () => {
    const view = leagueRailRowView(league(), RAIL, NO_LIVE, CLOCK)
    const { container, getByText } = render(<LeagueRailRow view={view} href="/league/s1" active expanded />)
    expect(getByText('Kings of the Court')).toBeTruthy()
    expect(getByText('Ciege Squad')).toBeTruthy()
    expect(getByText('Hoop Dreams')).toBeTruthy()
    const mine = container.querySelector('.af-rail-row-side:not([data-side="them"])')!
    expect(mine.querySelector('.af-rail-row-score')?.textContent).toBe('88.4')
    // The league-scored provider line only; the AF engine total (115.0) stays on the matchup screen.
    expect([...mine.querySelectorAll('.af-rail-row-projected')].map(n => n.textContent)).toEqual(['proj112.3'])
    expect(container.textContent).not.toContain('115.0')
    expect(container.querySelector('.af-rail-row-vs')?.textContent).toBe('VS')
    expect(container.querySelector('.af-rail-row-side[data-side="them"] .af-rail-row-score')?.textContent).toBe('79.2')
    expect(container.querySelector('.af-platform-chip')?.textContent).toBe('Sleeper')
    // Every row is the same week, so the expanded row no longer prints it.
    expect(container.textContent).not.toContain('Wk 6')
  })

  it('marks the current league, and only draws the crest when collapsed', () => {
    const view = leagueRailRowView(league(), RAIL, NO_LIVE, CLOCK)
    const { container } = render(<LeagueRailRow view={view} href="/league/s1" active expanded={false} />)
    const link = container.querySelector('a')!
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(link.getAttribute('data-active')).toBe('true')
    expect(container.querySelector('.af-rail-row')).toBeNull()
  })

  it('says so when a league has no matchup on file', () => {
    const view = leagueRailRowView(league({ id: 'n1', platform: 'allfantasy' }), RAIL, NO_LIVE, CLOCK)
    const { getByText } = render(<LeagueRailRow view={view} href="/league/n1" active={false} expanded />)
    expect(getByText('Matchup not available yet')).toBeTruthy()
  })
})

describe('own chat bubble contrast', () => {
  it('bubble text inherits the bubble colour instead of a host paragraph colour', () => {
    const css = readFileSync(join(process.cwd(), 'components/core-app/af-comms.css'), 'utf8')
    expect(css).toMatch(/^\.af-cm-bubble-text \{[^}]*color: inherit;/m)
    const native = readFileSync(join(process.cwd(), 'components/league/native/native-league.css'), 'utf8')
    // The workspace paragraph rule must not outrank a component's own colour.
    expect(native).not.toMatch(/^\.nl-workspace p\{/m)
    expect(native).toMatch(/^:where\(\.nl-workspace\) p\{/m)
  })
})
