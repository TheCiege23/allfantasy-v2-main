/**
 * This league's game plan, inline on Scout (War Room step 4c).
 *
 * Before this the league view only LINKED to Game Plan, and that link read every league. Now Scout
 * carries the league's own plan between the opponent banner and the manager cards, in words that fit
 * one league.
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
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'
import type { ScoutData } from '@/lib/core-app/scout'

const NOW = '2026-09-27T15:40:00.000Z'
const league = { leagueId: 'lg1', leagueName: 'The Gauntlet', platform: 'allfantasy', platformLeagueId: null, season: 2026, teamId: null }
const row = (name: string): TriageRow => ({
  player: { sport: 'NFL', externalId: name, sleeperId: name, name, position: 'WR', team: 'NYG', imageUrl: null },
  status: { label: 'Out', tone: 'bad' },
  description: null,
  reportedAt: null,
  leagues: [league],
  kickoff: '2026-09-27T17:00:00.000Z',
  noGame: false,
  inactive: null,
  bye: false,
})
const triage = (over: Partial<GameDayTriage> = {}): GameDayTriage => ({ rows: [], week: { season: 2026, week: 4 }, leaguesRead: 1, startersRead: 9, ...over })

const leaguePlan = (data: GameDayTriage) => (
  <GamePlan data={data} nowIso={NOW} weekHref="/core/week?league=lg1" waiversHref="/core/waivers?league=lg1" showHead={false} scope="league" />
)

const scout: ScoutData = {
  league: { id: 'lg1', name: 'The Gauntlet', sport: 'NFL' },
  you: { managerId: 'me', teamName: 'Mine', standing: null },
  week: { seasonYear: 2026, week: 4 },
  opponent: { managerId: 'rival', teamName: 'Rivals', headToHead: null },
  managers: {
    available: true,
    data: [{ managerId: 'rival', teamName: 'Rivals', ownerName: 'Rival', avatarUrl: null, isYou: false, isNextOpponent: true, standing: null }],
  },
  basis: { available: false, reason: 'no table' },
  format: { kind: 'redraft', elimination: false, bestBall: false, dynasty: false, picks: null },
}

describe('Scout carries this league’s plan', () => {
  it('between the opponent banner and the manager cards', () => {
    const html = renderToStaticMarkup(
      <Scout data={scout} gamePlanHref="/core/war-room?view=plan" matchupHref="/m" tradesHref="/t" leaguePlan={leaguePlan(triage({ rows: [row('Hurt Guy')] }))} />,
    )
    const banner = html.indexOf('af-sc-vs')
    const plan = html.indexOf('Your lineup in this league')
    const cards = html.indexOf('af-sc-list')
    expect(banner).toBeGreaterThan(-1)
    expect(plan).toBeGreaterThan(banner)
    expect(cards).toBeGreaterThan(plan)
    expect(html).toContain('Hurt Guy')
  })

  it('says the header link is every league’s plan, now that this one is on the page', () => {
    const html = renderToStaticMarkup(<Scout data={scout} gamePlanHref="/core/war-room?view=plan" matchupHref="/m" tradesHref="/t" />)
    expect(html).toContain('Every league&#x27;s game plan')
  })

  it('renders without a plan when none was read', () => {
    const html = renderToStaticMarkup(<Scout data={scout} gamePlanHref="/p" matchupHref="/m" tradesHref="/t" leaguePlan={null} />)
    expect(html).not.toContain('Your lineup in this league')
  })
})

describe('Game Plan in league scope', () => {
  it('speaks about this lineup, not “any of your leagues”', () => {
    const html = renderToStaticMarkup(leaguePlan(triage()))
    expect(html).toContain('No starter in this lineup is flagged this week.')
    expect(html).not.toContain('any of your leagues')
  })

  it('drops the leagues-affected tile, which can only read 0 or 1 here', () => {
    expect(renderToStaticMarkup(leaguePlan(triage({ rows: [row('Hurt Guy')] })))).not.toContain('Leagues affected')
  })

  it('keeps the cross-league wording when scope is all (the control)', () => {
    const html = renderToStaticMarkup(<GamePlan data={triage()} nowIso={NOW} weekHref="/w" waiversHref="/wv" showHead={false} />)
    expect(html).toContain('No starter in any of your leagues is flagged this week.')
    expect(html).toContain('Leagues affected')
  })
})
