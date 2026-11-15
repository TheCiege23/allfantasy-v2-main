/**
 * War Room, simpler (2026-11-14): a headline that says who you play and where you both stand, your three
 * moves first, everything else under one fold, the road ahead said once when nothing moves, and Next
 * season's facts said once.
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
import { WarCampaign } from '@/components/core-app/screens/WarCampaign'
import { engineFacts } from '@/components/core-app/screens/WarStrategyBrief'
import type { ScoutData, ScoutStanding } from '@/lib/core-app/scout'
import type { WarCampaign as Campaign } from '@/lib/core-app/warRoomCampaign'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/\s+/g, ' ')

const standing = (seed: number, w: number, l: number): ScoutStanding => ({
  seed,
  record: { wins: w, losses: l, ties: 0 },
  pointsFor: 1800,
  pointsAgainst: 1900,
  form: ['L', 'W'],
  zone: seed <= 8 ? 'playoff' : 'out',
  gamesBack: null,
  powerRank: seed,
})

function scout(over: Partial<ScoutData> = {}): ScoutData {
  return {
    league: { id: 'lg1', name: 'Sample Dynasty', sport: 'NFL' },
    you: { managerId: 'me', teamName: 'Sample You', standing: standing(12, 2, 7) },
    week: { seasonYear: 2026, week: 10 },
    opponent: { managerId: 'opp', teamName: 'Sample Dolphins', headToHead: null },
    managers: {
      available: true,
      data: [
        { managerId: 'opp', teamName: 'Sample Dolphins', ownerName: 'D', avatarUrl: null, isYou: false, isNextOpponent: true, standing: standing(5, 5, 4), eliminated: null, picks: null },
        { managerId: 'me', teamName: 'Sample You', ownerName: 'Me', avatarUrl: null, isYou: true, isNextOpponent: false, standing: standing(12, 2, 7), eliminated: null, picks: null },
        ...Array.from({ length: 12 }, (_, i) => ({
          managerId: `t${i}`, teamName: `Sample ${i}`, ownerName: null, avatarUrl: null, isYou: false, isNextOpponent: false,
          standing: standing(i < 4 ? i + 1 : i + 2 === 12 ? 14 : i + 2, 4, 5), eliminated: null, picks: null,
        })),
      ],
    },
    basis: { available: false, reason: 'no table' },
    format: { kind: 'dynasty', elimination: false, bestBall: false, dynasty: true, picks: null },
    ...over,
  } as ScoutData
}

const render = (data: ScoutData, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<Scout data={data} gamePlanHref="/p" matchupHref="/m" standingsHref="/s" tradesHref="/t" {...(extra as object)} />)

describe('War Room — the headline', () => {
  it('says who you play and where you both stand', () => {
    const html = render(scout())
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/)![1]
    expect(text(h1).trim()).toBe('This week: Sample Dolphins, 5th at 5-4. You’re 12th of 14.')
    expect(html).toContain('War Room · Sample Dynasty')
    expect(html).not.toContain('Scout · Sample Dynasty')
  })

  it('with no game this week, says where you stand', () => {
    const html = render(scout({ opponent: null }))
    expect(text(html.match(/<h1[^>]*>(.*?)<\/h1>/)![1]).trim()).toBe('You’re 12th of 14 in Sample Dynasty')
  })
})

describe('War Room — your moves first, the rest folded', () => {
  const slots = {
    leaguePlan: <section>PLAN-SLOT</section>,
    tradeIdeas: <section>TRADES-SLOT</section>,
    road: <section>ROAD-SLOT</section>,
    race: <section>RACE-SLOT</section>,
    ready: <section>READY-SLOT</section>,
    chest: <section>CHEST-SLOT</section>,
    brief: <section>BRIEF-SLOT</section>,
  }

  it('opponent, lineup, trades; then one closed fold; then the managers', () => {
    const html = render(scout(), slots)
    const at = (s: string) => html.indexOf(s)
    expect(at('af-sc-vs')).toBeGreaterThan(-1)
    expect(at('PLAN-SLOT')).toBeGreaterThan(at('af-sc-vs'))
    expect(at('TRADES-SLOT')).toBeGreaterThan(at('PLAN-SLOT'))
    const fold = at('data-testid="war-room-more"')
    expect(fold).toBeGreaterThan(at('TRADES-SLOT'))
    // The fold is closed by default and holds every information section, the table included.
    const tag = html.match(/<details[^>]*data-testid="war-room-more"[^>]*>/)![0]
    expect(tag).not.toMatch(/\sopen(=|\s|>)/)
    for (const s of ['af-sc-room', 'ROAD-SLOT', 'RACE-SLOT', 'READY-SLOT', 'CHEST-SLOT', 'BRIEF-SLOT']) {
      expect(at(s), s).toBeGreaterThan(fold)
      expect(at(s), s).toBeLessThan(at('</details>'))
    }
    expect(at('Every manager in this league')).toBeGreaterThan(at('</details>'))
    expect(at('af-sc-list')).toBeGreaterThan(at('Every manager in this league'))
  })

  it('draws no empty fold when there is nothing to put in it', () => {
    const html = render(scout({ managers: { available: false, reason: 'no table' } as ScoutData['managers'] }))
    expect(html).not.toContain('war-room-more')
  })
})

describe('War Room — the road ahead, said once when nothing moves', () => {
  const game = (week: number, small: boolean) => ({
    week,
    opponent: { rosterId: `r${week}`, name: `Opp ${week}`, wins: 5, losses: 4, ties: 0, playoffPct: 70 },
    ifWin: small ? 1 : 60,
    ifLose: small ? 0 : 30,
    swing: small ? 1 : 30,
    biggest: !small,
    small,
  })
  const view = (games: ReturnType<typeof game>[]): Campaign => ({
    kind: 'games', playoffPct: 0.3, games, inProgressWeek: null, unpricedGames: 0, medianGame: false, tiebreak: null,
  })

  it('one sentence, no per-game rows, when no game moves your odds', () => {
    const html = renderToStaticMarkup(<WarCampaign view={view([game(11, true), game(12, true), game(13, true)])} />)
    expect(html).toContain('war-road-quiet')
    expect(text(html)).toContain('You’re at <1% to make the playoffs, and no game you have left moves that much.')
    expect(html).not.toContain('Barely moves your odds')
    expect(html).not.toContain('af-wc-game')
  })

  it('the list, when even one game matters', () => {
    const html = renderToStaticMarkup(<WarCampaign view={view([game(11, true), game(12, false)])} />)
    expect(html).not.toContain('war-road-quiet')
    expect((html.match(/af-wc-game"/g) ?? []).length).toBe(2)
  })
})

describe('War Room — Next season says each fact once', () => {
  it('drops only the exact repeats of the summary line', () => {
    expect(
      engineFacts([
        'Record 2-7 (win% 0.22).',
        'Average starter age 26.5.',
        'Pick capital: 12 future pick(s), 6 early, tier total 87.5.',
        'Average starter age 28.4 is the second-oldest in the league.',
        'Young-asset value share 22% (sustainability signal).',
      ]),
    ).toEqual(['Average starter age 28.4 is the second-oldest in the league.', 'Young-asset value share 22% (sustainability signal).'])
  })
})
