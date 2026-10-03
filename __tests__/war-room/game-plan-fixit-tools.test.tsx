/**
 * Game Plan's fix-it tools (War Room step 4b): refresh the lineups, open his card, and see who to start
 * instead. Each one hands off to the surface that already owns the job rather than re-deciding it here.
 */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))

import { GamePlan } from '@/components/core-app/screens/GamePlan'
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'

const NOW = '2026-09-27T15:40:00.000Z'
const league = (id: string) => ({ leagueId: id, leagueName: `League ${id}`, platform: 'allfantasy', platformLeagueId: null, season: 2026, teamId: null })
const row = (name: string, kickoff: string, leagues: string[], sport = 'NFL'): TriageRow => ({
  player: { sport, externalId: `x-${name}`, sleeperId: name, name, position: 'WR', team: 'NYG', imageUrl: null },
  status: { label: 'Out', tone: 'bad' },
  description: null,
  reportedAt: null,
  leagues: leagues.map(league),
  kickoff,
  noGame: false,
  inactive: null,
  bye: false,
})

const plan = (data: Partial<GameDayTriage>) =>
  renderToStaticMarkup(
    <GamePlan
      data={{ rows: [], week: { season: 2026, week: 3 }, leaguesRead: 2, startersRead: 20, rostersAsOf: '2026-09-27T14:40:00.000Z', ...data }}
      nowIso={NOW}
      weekHref="/core/week"
      waiversHref="/core/waivers"
      showHead={false}
    />,
  )
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'))

describe('Refresh my lineups', () => {
  it('renders the Player Finder’s control with the oldest lineup’s time', () => {
    const html = plan({ rows: [row('Soon', '2026-09-27T17:00:00.000Z', ['A'])] })
    expect(html).toContain('Lineups as of 10:40a ET · 1h 0m ago')
    expect(html).toContain('>Refresh my lineups</button>')
  })

  it('brings its own stylesheet, so it is styled outside the Player Finder too', () => {
    expect(readFileSync('components/core-app/player-finder/RefreshLineups.tsx', 'utf8')).toContain("import '@/components/core-app/af-refresh-lineups.css'")
    expect(readFileSync('components/core-app/af-player-finder.css', 'utf8')).not.toContain('.af-pf-refresh-btn')
  })
})

describe('his card', () => {
  it('links the player name to the Player Finder card, sport-qualified', () => {
    const html = plan({ rows: [row('Josh Allen', '2026-09-27T17:00:00.000Z', ['A'])] })
    expect(hrefs(html)).toContain('/core/players?q=Josh%20Allen&player=NFL%3Ax-Josh%20Allen')
  })
})

describe('who to start instead', () => {
  it('opens that league’s My Team for a one-league row', () => {
    const html = plan({ rows: [row('Soon', '2026-09-27T17:00:00.000Z', ['A'])] })
    expect(hrefs(html)).toContain('/core/my-team?league=A')
    expect(html).toContain('Who to start instead')
  })

  it('opens My Team’s every-lineup view when he starts in several leagues', () => {
    const html = plan({ rows: [row('Soon', '2026-09-27T17:00:00.000Z', ['A', 'B'])] })
    expect(hrefs(html)).toContain('/core/my-team')
    expect(hrefs(html)).not.toContain('/core/my-team?league=A')
  })

  it('offers nothing once he has kicked off — nothing of his can move', () => {
    const html = plan({ rows: [row('Gone', '2026-09-27T13:00:00.000Z', ['A'])] })
    // The link element, not the words — the footer names My Team in a sentence on every render.
    expect(html).not.toContain('class="af-gp-swap"')
  })

  it('no longer tells the reader a swap would be invented', () => {
    const html = plan({ rows: [row('Soon', '2026-09-27T17:00:00.000Z', ['A'])] })
    expect(html).not.toContain('would be invented')
    expect(html).toContain('Who to start instead is My Team')
  })
})
