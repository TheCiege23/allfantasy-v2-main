/**
 * Trades that move your odds, on the rendered markup (components/core-app/screens/WarTradeIdeas.tsx).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))

import { WarTradeIdeas } from '@/components/core-app/screens/WarTradeIdeas'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { WarTrades, WarTradesView, WinNowIdea } from '@/lib/core-app/warRoomTrades'
import { warRoomTradesMessages } from '@/lib/core-app/messages/warRoomTrades'
import { missingMessages } from '@/lib/i18n/messages'

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

const view = (trades: WarTrades): WarTradesView => ({ leagueId: 'L', posture: 'bubble', trades, tradeCenterHref: '/core/trades?league=L' })

const idea = (over: Partial<WinNowIdea> = {}): WinNowIdea => ({
  partnerRosterId: 'them',
  partnerName: 'Team Taco',
  send: { id: 's', name: 'Rachaad White', position: 'RB', team: 'TB', age: 26 },
  receive: { id: 'r', name: 'Jakobi Meyers', position: 'WR', team: 'LV', age: 28 },
  youGainPerWeek: 4.2,
  partnerGainPerWeek: 1.1,
  playoffDelta: 6.3,
  titleDelta: 1.4,
  partnerPlayoffPct: 62.4,
  ...over,
})

const open: CoreDepthAccess = {
  depth: 'trade_depth',
  unlocked: true,
  hasPlan: true,
  preLaunchFree: false,
  startsAt: '2027-01-01T00:00:00.000Z',
  planName: 'AF Pro',
  label: 'Trade depth',
  upgradePath: '/pricing',
} as CoreDepthAccess

describe('WarTradeIdeas — rendered', () => {
  it('a win-now idea: the deal, its playoff-odds change, both lineups, the partner as a fact, a way to build it', () => {
    const html = renderToStaticMarkup(
      <WarTradeIdeas view={view({ mode: 'win_now', rankedBy: 'playoff', ideas: [idea()], basisWeek: { season: '2026', week: 10 }, screened: 2816 })} access={open} />,
    )
    const t = text(html)
    expect(html).toContain('id="war-trades"')
    expect(t).toContain('Send Rachaad White (RB), get Jakobi Meyers (WR) from Team Taco')
    expect(t).toContain('+6.3 playoff odds')
    expect(t).toContain('+4.2 pts/week for you · +1.1 for them')
    expect(t).toContain('They’re at 62% playoff odds.')
    expect(t).toContain('week 10 projections')
    expect(t).toContain('One projection week stands in for the rest of the season.')
    expect(html).toContain('href="/core/trades?league=L"')
  })

  it('a clinched team reads title odds', () => {
    const t = text(renderToStaticMarkup(<WarTradeIdeas view={view({ mode: 'win_now', rankedBy: 'title', ideas: [idea()], basisWeek: null, screened: 10 })} access={open} />))
    expect(t).toContain('+1.4 title odds')
    expect(t).not.toContain('playoff odds ·')
  })

  it('nothing found says how much was checked — "none" is not "never looked"', () => {
    const t = text(renderToStaticMarkup(<WarTradeIdeas view={view({ mode: 'win_now', rankedBy: 'playoff', ideas: [], basisWeek: null, screened: 2816 })} access={open} />))
    expect(t).toContain('No 1-for-1 swap lifts your odds without weakening the other team’s lineup — 2,816 checked.')
  })

  it('sell ideas name the veteran, the decline age and who gains — and ask for youth and picks without pricing them', () => {
    const t = text(
      renderToStaticMarkup(
        <WarTradeIdeas
          view={view({
            mode: 'sell',
            basisWeek: null,
            ideas: [
              {
                player: { id: 'v', name: 'Derrick Henry', position: 'RB', team: 'BAL', age: 32 },
                agingFrom: 27,
                partners: [{ rosterId: 'them', name: 'Team Taco', gainPerWeek: 7.5, playoffPct: 81 }],
              },
            ],
          })}
          access={open}
        />,
      ),
    )
    expect(t).toContain('Derrick Henry, RB, age 32 (RB usually declines from 27)')
    expect(t).toContain('Team Taco: +7.5 pts/week to their lineup · 81% playoff odds')
    expect(t).toContain('Ask for young players and picks')
  })

  it('closed and none states each say their own thing', () => {
    expect(text(renderToStaticMarkup(<WarTradeIdeas view={view({ mode: 'closed', deadlineWeek: 11 })} access={open} />))).toContain('Trades closed after week 11.')
    expect(text(renderToStaticMarkup(<WarTradeIdeas view={view({ mode: 'none', why: 'redraft_out', reason: null })} access={open} />))).toContain(
      'nothing carries over',
    )
    expect(
      text(renderToStaticMarkup(<WarTradeIdeas view={view({ mode: 'none', why: 'not_priced', reason: 'No projection week is on file yet.' })} access={open} />)),
    ).toContain('could not be priced: No projection week is on file yet.')
  })

  it('🛑 a locked viewer sees the lock and no ideas — the page never sent them', () => {
    const locked = { ...open, unlocked: false, hasPlan: false } as CoreDepthAccess
    const html = renderToStaticMarkup(<WarTradeIdeas view={null} access={locked} />)
    expect(html).toContain('core-lock-trade_depth')
    expect(text(html)).not.toContain('Send ')
  })

  it('a failed read with an open plan draws nothing at all', () => {
    expect(renderToStaticMarkup(<WarTradeIdeas view={null} access={open} />)).toBe('')
  })

  it('every English string has a Spanish one', () => {
    expect(missingMessages(warRoomTradesMessages, 'es')).toEqual([])
  })
})
