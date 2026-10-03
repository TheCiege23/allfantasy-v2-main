/**
 * War Room step 2, on the rendered markup: Scout's fact cards and opponent banner, and Game Plan's
 * summary strip. Each `it` names the claim a manager would read off the screen.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))

import { Scout } from '@/components/core-app/screens/Scout'
import { GamePlan } from '@/components/core-app/screens/GamePlan'
import type { ScoutData, ScoutedManager, ScoutStanding } from '@/lib/core-app/scout'
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'

const standing = (seed: number, wins: number, losses: number, over: Partial<ScoutStanding> = {}): ScoutStanding => ({
  seed,
  record: { wins, losses, ties: 0 },
  pointsFor: 412.36,
  pointsAgainst: 380,
  form: ['W', 'L', 'W'],
  zone: 'playoff',
  gamesBack: -1,
  powerRank: seed + 1,
  ...over,
})

const manager = (id: string, over: Partial<ScoutedManager> = {}): ScoutedManager => ({
  managerId: id,
  teamName: `Team ${id}`,
  ownerName: `Owner ${id}`,
  avatarUrl: null,
  isYou: false,
  isNextOpponent: false,
  standing: standing(3, 1, 2),
  ...over,
})

function scoutData(over: Partial<ScoutData> = {}): ScoutData {
  return {
    league: { id: 'lg1', name: 'The Gauntlet', sport: 'NFL' },
    you: { managerId: 'mine', teamName: 'My Squad', standing: standing(2, 2, 1) },
    week: { seasonYear: 2026, week: 4 },
    opponent: { managerId: 'rival', teamName: 'Team rival', headToHead: { wins: 0, losses: 1, ties: 0 } },
    managers: {
      available: true,
      data: [
        manager('rival', { isNextOpponent: true, standing: standing(1, 3, 0, { form: ['W', 'W', 'W'] }) }),
        manager('mine', { isYou: true, teamName: 'My Squad', standing: standing(2, 2, 1) }),
        manager('third', { standing: null }),
      ],
    },
    basis: { available: true, data: { season: 2026, throughWeek: 3, seasonComplete: false, orderBasis: 'Order is winning percentage, then points for.' } },
    format: { kind: 'redraft', elimination: false, bestBall: false, dynasty: false, picks: null },
    ...over,
  }
}

const render = (data: ScoutData) =>
  renderToStaticMarkup(<Scout data={data} gamePlanHref="/core/war-room?view=plan&league=lg1" matchupHref="/core/matchup?league=lg1" tradesHref="/core/trades?league=lg1" />)

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
const count = (html: string, s: string) => html.split(s).length - 1

describe('Scout — facts in place of the profile box', () => {
  it('prints seed, record, points and power for a manager on the table', () => {
    const html = render(scoutData())
    expect(html).toContain('#1')
    expect(html).toContain('3-0')
    expect(html).toContain('412.4')
    expect(html).toContain('Playoff spot')
  })

  it('carries no trace of the retired psychology box', () => {
    const html = render(scoutData())
    for (const gone of ['observations', 'profiled', 'Competitive Edge guidance', 'held internally']) {
      expect(html).not.toContain(gone)
    }
  })

  it('says a manager is not on the table rather than inventing a zero line', () => {
    expect(render(scoutData())).toContain('Not on the standings table yet.')
  })

  it('states the basis before the first card', () => {
    const html = render(scoutData())
    expect(html).toContain('Standings through week <span class="af-num">3</span>')
    expect(html.indexOf('Standings through week')).toBeLessThan(html.indexOf('Owner rival'))
  })

  it('gives every other manager a way into the Trade Center, and not your own card', () => {
    const html = render(scoutData())
    // Banner + rival card + third card; none on yours.
    expect(hrefs(html).filter((h) => h === '/core/trades?league=lg1').length).toBe(3)
  })

  it('labels last-five form for a screen reader, not by colour alone', () => {
    expect(render(scoutData())).toContain('aria-label="Last 3: W W W"')
  })
})

describe('Scout — this week’s opponent banner', () => {
  it('names both sides with seed and record, and your head-to-head', () => {
    const html = render(scoutData())
    expect(html).toContain('My Squad')
    expect(html).toContain('#2 · 2-1')
    expect(html).toContain('#1 · 3-0')
    expect(html).toContain('You are <span class="af-num">0-1</span> against them this season.')
  })

  it('hands the projection to Matchup rather than computing one', () => {
    const html = render(scoutData())
    expect(hrefs(html)).toContain('/core/matchup?league=lg1')
    expect(html).toContain('Projected score &amp; win odds')
  })

  it('says you have not played them, rather than printing 0-0', () => {
    const html = render(scoutData({ opponent: { managerId: 'rival', teamName: 'Team rival', headToHead: null } }))
    expect(html).toContain('You have not played them yet this season.')
    expect(html).not.toContain('0-0')
  })

  it('does not render without an opponent', () => {
    expect(render(scoutData({ opponent: null }))).not.toContain('af-sc-vs')
  })
})

describe('Scout — refusals', () => {
  it('prints a non-member’s reason once, not as both the basis and the list', () => {
    const reason = 'scouting reads the managers of a league you are in, and this account is not a member of this one'
    const html = render(
      scoutData({ you: null, opponent: null, managers: { available: false, reason }, basis: { available: false, reason } }),
    )
    expect(count(html, reason)).toBe(1)
  })

  it('does not double a full stop the Standings reason already carries', () => {
    const html = render(scoutData({ basis: { available: false, reason: 'nothing has been scored in 2026 yet.' } }))
    expect(html).toContain('No standings yet: nothing has been scored in 2026 yet.')
    expect(html).not.toContain('yet..')
  })
})

/* ── Game Plan summary ──────────────────────────────────────────────────── */

const NOW = '2026-09-27T15:40:00.000Z'
const league = (id: string) => ({ leagueId: id, leagueName: `League ${id}`, platform: 'allfantasy', platformLeagueId: null, season: 2026, teamId: null })
const row = (name: string, kickoff: string | null, leagues: string[]): TriageRow => ({
  player: { sport: 'NFL', externalId: name, sleeperId: name, name, position: 'WR', team: 'NYG', imageUrl: null },
  status: { label: 'Out', tone: 'bad' },
  description: null,
  reportedAt: null,
  leagues: leagues.map(league),
  kickoff,
  noGame: false,
  inactive: null,
  bye: false,
})

function plan(data: Partial<GameDayTriage>): string {
  const full: GameDayTriage = { rows: [], week: { season: 2026, week: 3 }, leaguesRead: 3, startersRead: 27, ...data }
  return renderToStaticMarkup(<GamePlan data={full} nowIso={NOW} weekHref="/core/week" waiversHref="/core/waivers" showHead={false} />)
}

const stat = (html: string, label: string) => {
  const m = html.match(new RegExp(`<dt>${label}</dt><dd[^>]*>(.*?)</dd>`))
  return m ? m[1].replace(/<[^>]+>/g, '') : null
}

describe('Game Plan — the summary strip', () => {
  const rows = [
    row('Soon', '2026-09-27T17:00:00.000Z', ['A', 'B']),
    row('Later', '2026-09-28T00:20:00.000Z', ['B']),
    row('Gone', '2026-09-27T13:00:00.000Z', ['C']), // kicked off — not something to fix
  ]

  it('counts flagged starters that can still move, leaving out the locked', () => {
    expect(stat(plan({ rows }), 'Flagged starters')).toBe('2')
  })

  it('adds empty slots across leagues, and counts each league once', () => {
    const html = plan({ rows, emptySlots: [{ ...league('B'), count: 2 }, { ...league('D'), count: 1 }] })
    expect(stat(html, 'Empty slots')).toBe('3')
    // A and B from the open rows, B again and D from the empty slots — three distinct, C is locked.
    expect(stat(html, 'Leagues affected')).toBe('3')
  })

  it('names the soonest lock among what can still move', () => {
    expect(stat(plan({ rows }), 'First lock')).toBe('locks in 1h 20m')
  })

  it('says what it skipped and how old the lineups are', () => {
    const html = plan({ rows, bestBallLeagues: 2, unsupportedLeagues: 1, rostersAsOf: '2026-09-27T12:40:00.000Z' })
    // Step 4b: the Player Finder's refresh control carries the stamp (12:40Z is 8:40a ET), with its button.
    expect(html).toContain('Lineups as of 8:40a ET · 3h 0m ago')
    expect(html).toContain('Refresh my lineups')
    expect(html).toContain('2 best-ball leagues skipped')
    expect(html).toContain('1 on a platform we can’t read yet')
  })

  it('is absent when nothing was read at all, so a strip of zeros cannot pass for an all-clear', () => {
    expect(plan({ rows: [], startersRead: 0 })).not.toContain('af-gp-summary')
  })
})
