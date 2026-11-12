/**
 * The Front, on the rendered markup — what a manager reads off the War Room home.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))

import { WarFront } from '@/components/core-app/screens/WarFront'
import type { WarFront as WarFrontData, WarFrontCard } from '@/lib/core-app/warRoomFront'
import { warRoomFrontMessages } from '@/lib/core-app/messages/warRoomFront'
import { missingMessages } from '@/lib/i18n/messages'

const card = (over: Partial<WarFrontCard>): WarFrontCard => ({
  leagueId: 'L',
  leagueName: 'League',
  posture: 'bubble',
  horizon: 'this_season',
  format: 'redraft',
  odds: { playoff: 48.4, bye: 6, title: 4.2 },
  record: { wins: 5, losses: 4, ties: 0 },
  seed: 6,
  teams: 12,
  weeksRemaining: 4,
  orders: [],
  ...over,
  scoutHref: over.scoutHref ?? `/core/war-room?league=${over.leagueId ?? 'L'}`,
})

const front = (cards: WarFrontCard[], available = true): WarFrontData => {
  const counts = { bubble: 0, contender: 0, long_shot: 0, clinched: 0, eliminated: 0, unplaced: 0 }
  for (const c of cards) counts[c.posture] += 1
  return { available, cards, counts }
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

describe('The Front — rendered', () => {
  it('a bubble card shows its odds, record, seed and its orders as links to where you act', () => {
    const html = renderToStaticMarkup(
      <WarFront
        data={front([
          card({
            leagueId: 'b',
            leagueName: 'KBFL',
            orders: [
              { kind: 'swing_game', week: 10, opponent: 'Team Rival', ifWin: 71.2, ifLose: 28.9, clinchOnWin: false, href: '/core/season-outlook?league=b' },
              { kind: 'trade_deadline', week: 12, weeksLeft: 2, intent: 'buy', href: '/core/trades?league=b' },
            ],
          }),
        ])}
      />,
    )
    const t = text(html)
    expect(t).toContain('On the bubble')
    expect(t).toContain('KBFL')
    expect(t).toContain('48%')
    expect(t).toContain('5–4 · #6 of 12 · 4 weeks left')
    expect(t).toContain('Week 10 vs Team Rival is your swing game: win → 71%, lose → 29%.')
    expect(t).toContain('Trade deadline in 2 weeks (week 12)')
    expect(html).toContain('href="/core/trades?league=b"')
    expect(html).toContain('href="/core/war-room?league=b"')
  })

  it('formats tiny and near-certain odds the way Season Outlook does', () => {
    const t = text(renderToStaticMarkup(<WarFront data={front([card({ posture: 'contender', odds: { playoff: 99.8, bye: null, title: 0.3 } })])} />))
    expect(t).toContain('>99%')
    expect(t).toContain('<1%')
    // No byes in this league: no bye cell at all.
    expect(t).not.toContain('Bye')
  })

  it('a keeper card says the roster carries over', () => {
    const t = text(renderToStaticMarkup(<WarFront data={front([card({ posture: 'long_shot', horizon: 'carries_over', format: 'keeper' })])} />))
    expect(t).toContain('Keeper · roster carries over')
  })

  it('unplaced teams are grouped at the end with their reason, not dropped and not full cards', () => {
    const html = renderToStaticMarkup(
      <WarFront
        data={front([
          card({ leagueId: 'b', leagueName: 'Placed League' }),
          card({
            leagueId: 'g',
            leagueName: 'Guillotine Gauntlet',
            posture: 'unplaced',
            odds: null,
            record: null,
            orders: [{ kind: 'unplaced', why: 'too_few_weeks', reason: null, weeksFitted: 2, href: '/core/season-outlook?league=g' }],
          }),
        ])}
      />,
    )
    const t = text(html)
    expect(t).toContain('1 team not placed — which, and why')
    expect(t).toContain('Guillotine Gauntlet — Not placed yet: only 2 weeks of scores to model')
    expect(html.match(/class="af-wf-card"/g)).toHaveLength(1)
    expect(html.indexOf('Placed League')).toBeLessThan(html.indexOf('Guillotine Gauntlet'))
  })

  it('counts every posture present, and only those', () => {
    const t = text(
      renderToStaticMarkup(
        <WarFront data={front([card({ posture: 'bubble' }), card({ leagueId: 'c', posture: 'contender' }), card({ leagueId: 'd', posture: 'contender' })])} />,
      ),
    )
    expect(t).toContain('1 on the bubble')
    expect(t).toContain('2 contenders')
    expect(t).not.toContain('long shot')
  })

  it('every English string has a Spanish one', () => {
    expect(missingMessages(warRoomFrontMessages, 'es')).toEqual([])
    const es = warRoomFrontMessages.es!
    expect(es.posture!('bubble')).toBe('En la burbuja')
    expect(es.orderSwingGame!(10, 'Team Taco', '80', '44', false)).toContain('contra Team Taco')
  })

  it('a failed outlook read is one line with a way to the full board — no cards', () => {
    const html = renderToStaticMarkup(<WarFront data={front([card({ posture: 'unplaced', odds: null })], false)} />)
    expect(text(html)).toContain('Playoff odds could not be read right now')
    expect(html).toContain('href="/core/season-outlook"')
    expect(html).not.toContain('af-wf-card')
    expect(html).not.toContain('not placed')
  })
})
