/**
 * Game Plan names every league it did not check, and says "48 of 64" rather than "48".
 *
 * Reported from the War Room 2026-11-11: "why does the war room show less leagues than I am actually
 * in? shows only 48 leagues." Sixteen skips were counted on screen and the rest were silent. The
 * loader now returns `skipped` (every league not read, with a reason); these pin what the screen
 * does with it.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))

import { GamePlan } from '@/components/core-app/screens/GamePlan'
import { classifySkippedLeagues, type GameDayTriage, type SkippedLeague } from '@/lib/core-app/gameDayTriage'

const NOW = '2026-11-11T20:00:00.000Z'

function plan(data: Partial<GameDayTriage>): string {
  const full: GameDayTriage = { rows: [], week: { season: 2026, week: 10 }, leaguesRead: 48, startersRead: 544, ...data }
  return renderToStaticMarkup(<GamePlan data={full} nowIso={NOW} weekHref="/core/week" waiversHref="/core/waivers" showHead={false} />)
}

const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')

const skip = (leagueId: string, reason: SkippedLeague['reason'], platform: string | null = 'sleeper'): SkippedLeague => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  platform,
  reason,
})

describe('Game Plan — leagues not checked', () => {
  const skipped = [
    ...Array.from({ length: 4 }, (_, i) => skip(`bb${i}`, 'best_ball')),
    ...Array.from({ length: 12 }, (_, i) => skip(`y${i}`, 'unsupported', 'yahoo')),
    skip('nt', 'no_team'),
    skip('nr', 'no_roster'),
    skip('over', 'season_over'),
  ]

  it('states the denominator: checked across 48 of 67 leagues', () => {
    expect(text(plan({ skipped }))).toContain('544 starters checked across 48 of 67 leagues.')
  })

  it('names every skipped league under its reason, the fixable reasons first', () => {
    const html = plan({ skipped })
    const t = text(html)
    expect(t).toContain('19 leagues not checked — which, and why')
    for (const s of skipped) expect(t).toContain(s.leagueName!)
    // Order: no team, no roster, unsupported, best ball, season over.
    const order = ['no_team', 'no_roster', 'unsupported', 'best_ball', 'season_over'].map((r) => html.indexOf(`data-reason="${r}"`))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(t).toContain('On a platform we can’t read yet (12)')
    expect(t).toContain('Best ball (4)')
  })

  it('links a missing roster to its sync page, and does not link a no-team league anywhere', () => {
    const html = plan({ skipped })
    expect(html).toContain('href="/core/sync?league=nr"')
    // A team is claimed at import; no league screen offers a claim, so there is nowhere useful to send it.
    expect(html).not.toContain('league=nt"')
  })

  it('does not repeat the old counts-only line when the full list is there', () => {
    const t = text(plan({ skipped, bestBallLeagues: 4, unsupportedLeagues: 12, rostersAsOf: '2026-11-11T19:00:00.000Z' }))
    expect(t).not.toContain('4 best-ball leagues skipped')
  })

  it('still shows why when NOTHING was read — the case the summary strip does not render for', () => {
    const t = text(plan({ leaguesRead: 0, startersRead: 0, skipped: [skip('a', 'season_over'), skip('b', 'pre_season')] }))
    expect(t).toContain('0 starters checked across 0 of 2 leagues.')
    expect(t).toContain('2 leagues not checked')
    expect(t).toContain('Season over (1)')
  })

  it('renders nothing extra when every league was read, and keeps the old line for a payload without the list', () => {
    expect(text(plan({ skipped: [] }))).toContain('544 starters checked across 48 leagues.')
    expect(plan({ skipped: [] })).not.toContain('af-gp-skips')
    const legacy = text(plan({ bestBallLeagues: 4, rostersAsOf: '2026-11-11T19:00:00.000Z' }))
    expect(legacy).toContain('4 best-ball leagues skipped')
    expect(legacy).toContain('544 starters checked across 48 leagues.')
  })
})

describe('classifySkippedLeagues — precedence follows the loader', () => {
  const base = {
    ids: ['a', 'b', 'c', 'd', 'e', 'f'],
    overflow: new Set(['f']),
    claimed: new Set(['b', 'c', 'd', 'e', 'f']),
    bestBall: new Set(['c']),
    unsupported: new Set(['c', 'd']),
    loopReasons: new Map([['e', 'eliminated' as const], ['b', 'season_over' as const]]),
    read: new Set(['b']),
    leagueInfo: new Map([['a', { name: 'A', platform: 'espn' }]]),
  }

  it('gives each unread league exactly one reason, first gate wins, and never lists a read league', () => {
    expect(classifySkippedLeagues(base)).toEqual([
      { leagueId: 'a', leagueName: 'A', platform: 'espn', reason: 'no_team' },
      { leagueId: 'c', leagueName: null, platform: null, reason: 'best_ball' },
      { leagueId: 'd', leagueName: null, platform: null, reason: 'unsupported' },
      { leagueId: 'e', leagueName: null, platform: null, reason: 'eliminated' },
      { leagueId: 'f', leagueName: null, platform: null, reason: 'not_read' },
    ])
  })

  it('a claimed league with no other reason is no_roster', () => {
    expect(classifySkippedLeagues({ ...base, ids: ['z'], claimed: new Set(['z']) })[0]!.reason).toBe('no_roster')
  })
})
