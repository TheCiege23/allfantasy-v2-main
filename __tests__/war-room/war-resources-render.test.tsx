/**
 * War Room phase 6 on screen: the war chest (WarChest.tsx), the trade map inside the trade ideas
 * (WarTradeIdeas.tsx), and the FAAB line in the Chimmy brief.
 *
 * Pins: a non-FAAB league draws nothing; an unrecorded balance reads "not recorded", never $0; the
 * redraft use-it line appears only when the model says so; the trade map shows both sides as facts and
 * counts the overflow; a locked viewer gets the lock and no map; Spanish leaves no English behind.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { WarChest } from '@/components/core-app/screens/WarChest'
import { WarTradeIdeas } from '@/components/core-app/screens/WarTradeIdeas'
import type { WarChest as WarChestView } from '@/lib/core-app/warRoomWarChest'
import type { WarTradesView } from '@/lib/core-app/warRoomTrades'
import type { TradeMap } from '@/lib/core-app/warRoomTradeMap'
import { messagesFor, missingMessages } from '@/lib/i18n/messages'
import { warRoomWarChestMessages } from '@/lib/core-app/messages/warRoomWarChest'
import { warRoomTradeMapMessages } from '@/lib/core-app/messages/warRoomTradeMap'
import { warRoomPlanMessages } from '@/lib/core-app/messages/warRoomPlan'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import { warPlanPrompt } from '@/lib/core-app/warRoomPlanPrompt'

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

const chest: WarChestView = {
  kind: 'faab',
  budget: 100,
  you: 42,
  rank: 2,
  known: 4,
  rows: [
    { rosterId: 'a', name: 'Team Taco', isYou: false, remaining: 88 },
    { rosterId: 'me', name: 'Mine', isYou: true, remaining: 42 },
    { rosterId: 'c', name: 'Gridiron Goblins', isYou: false, remaining: 5 },
    { rosterId: 'd', name: 'Never Synced', isYou: false, remaining: null },
  ],
  weeksRemaining: 2,
  useIt: true,
}

const map: TradeMap = {
  partners: [
    {
      rosterId: 'them',
      name: 'Team Taco',
      theyHave: [{ player: { id: 'w4', name: 'Their WR4', position: 'WR', points: 14 }, upgrade: 8 }],
      theyNeed: [{ position: 'RB', underLeague: -8.4, yourPlayer: { id: 'r4', name: 'My RB4', position: 'RB', points: 14 }, upgrade: 9 }],
    },
  ],
  matched: 3,
  basisWeek: { season: '2026', week: 10 },
}

const tradesView: WarTradesView = {
  leagueId: 'L',
  posture: 'bubble',
  tradeCenterHref: '/core/trades?league=L',
  trades: { mode: 'win_now', rankedBy: 'playoff', ideas: [], basisWeek: null, screened: 120 },
  map,
}

describe('WarChest', () => {
  it('your balance, your rank, everyone’s balance, and unknown as unknown', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarChest view={chest} />))
    expect(t).toContain('War chest')
    expect(t).toContain('You have $42 of $100 in FAAB — 2nd most of the 4 teams with a recorded balance.')
    expect(t).toContain('$88')
    expect(t).toContain('Never Synced not recorded')
    expect(t).not.toMatch(/Never Synced \$0/)
    expect(t).toContain('2 regular-season weeks are left')
  })

  it('the use-it line only when the model sets it', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarChest view={{ ...chest, useIt: false }} />))
    expect(t).not.toContain('buys nothing')
  })

  it('the most money reads as "the most"; an unrecorded own balance says so', () => {
    lang.language = 'en'
    expect(text(renderToStaticMarkup(<WarChest view={{ ...chest, rank: 1 }} />))).toContain('the most of the 4 teams')
    expect(text(renderToStaticMarkup(<WarChest view={{ ...chest, you: null, rank: null }} />))).toContain('Your FAAB balance isn’t recorded')
  })

  it('a league without FAAB draws nothing; FAAB with no balances says so', () => {
    lang.language = 'en'
    expect(renderToStaticMarkup(<WarChest view={{ kind: 'none', why: 'not_faab' }} />)).toBe('')
    expect(text(renderToStaticMarkup(<WarChest view={{ kind: 'none', why: 'not_read' }} />))).toContain('aren’t recorded')
  })

  it('Spanish', () => {
    lang.language = 'es'
    const t = text(renderToStaticMarkup(<WarChest view={chest} />))
    expect(t).toContain('Fondo de guerra')
    expect(t).toContain('Tienes $42 de $100 de FAAB — el 2.º que más tiene de los 4 equipos con saldo registrado.')
    expect(t).toContain('sin registro')
    expect(t).not.toMatch(/\b(You have|not recorded|War chest|weeks are left|buys nothing)\b/)
    lang.language = 'en'
  })
})

describe('The trade map in the trade ideas', () => {
  it('both sides as facts, with the overflow counted', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarTradeIdeas view={tradesView} access={null} />))
    expect(t).toContain('Trade map')
    expect(t).toContain('on week 10 projections')
    expect(t).toContain('Has Their WR4 (WR, 14.0) on the bench — +8.0 over your weakest WR starter.')
    expect(t).toContain('Their RB starters average 8.4 under the league; your bench RB My RB4 would start for them (+9.0).')
    expect(t).toContain('2 more teams fit.')
  })

  it('no map, no block', () => {
    lang.language = 'en'
    expect(text(renderToStaticMarkup(<WarTradeIdeas view={{ ...tradesView, map: null }} access={null} />))).not.toContain('Trade map')
  })

  it('a locked viewer sees the lock and no map', () => {
    lang.language = 'en'
    const locked = { unlocked: false } as Parameters<typeof WarTradeIdeas>[0]['access']
    const t = text(renderToStaticMarkup(<WarTradeIdeas view={tradesView} access={locked} />))
    expect(t).not.toContain('Trade map')
    expect(t).not.toContain('Their WR4')
  })

  it('Spanish', () => {
    lang.language = 'es'
    const t = text(renderToStaticMarkup(<WarTradeIdeas view={tradesView} access={null} />))
    expect(t).toContain('Mapa de cambios')
    expect(t).toContain('Tiene a Their WR4 (WR, 14.0) en la banca')
    expect(t).not.toMatch(/\b(Trade map|on the bench|under the league|more teams fit)\b/)
    lang.language = 'en'
  })

  it('catalogs complete', () => {
    expect(missingMessages(warRoomWarChestMessages, 'es')).toEqual([])
    expect(missingMessages(warRoomTradeMapMessages, 'es')).toEqual([])
    expect(missingMessages(warRoomPlanMessages, 'es')).toEqual([])
  })
})

describe('The Chimmy brief carries the war chest', () => {
  const m = messagesFor(warRoomPlanMessages, 'en')
  const b = messagesFor(warRoomBriefMessages, 'en')
  const input = (c: WarChestView | null) => ({ leagueName: 'KBFL', card: null, trades: null, format: null, nextSeason: null, warChest: c })

  it('balance and rank, plus the redraft line when it applies', () => {
    expect(warPlanPrompt(input(chest), m, b, 'en')).toContain('FAAB: $42 of $100 left, rank 2 of 4 — redraft, so it buys nothing after the season.')
    expect(warPlanPrompt(input({ ...chest, useIt: false }), m, b, 'en')).toContain('FAAB: $42 of $100 left, rank 2 of 4.')
  })

  it('nothing when there is no balance of yours to state', () => {
    expect(warPlanPrompt(input({ ...chest, you: null, rank: null }), m, b, 'en')).not.toContain('FAAB')
    expect(warPlanPrompt(input({ kind: 'none', why: 'not_faab' }), m, b, 'en')).not.toContain('FAAB')
  })
})
