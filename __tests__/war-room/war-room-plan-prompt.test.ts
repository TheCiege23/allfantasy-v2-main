/**
 * War Room phase 4 — the war plan brief handed to Chimmy (lib/core-app/warRoomPlanPrompt.ts).
 *
 * Pins: the brief carries what the War Room computed, in the viewer's language; a paid trade idea is
 * only in it when the viewer has trade ideas at all (a locked viewer's `trades` is null); the length
 * stays under budget by dropping the least decisive lines first, never the request; and the request
 * names its sources and asks Chimmy to say what it is unsure of.
 */

import { describe, expect, it } from 'vitest'

import { messagesFor, missingMessages } from '@/lib/i18n/messages'
import { warRoomPlanMessages } from '@/lib/core-app/messages/warRoomPlan'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import { MAX_PROMPT_CHARS, warPlanPrompt, type WarPlanInput } from '@/lib/core-app/warRoomPlanPrompt'
import type { WarFrontCard } from '@/lib/core-app/warRoomFront'
import type { WarTrades } from '@/lib/core-app/warRoomTrades'
import type { FormatBrief } from '@/lib/core-app/warRoomFormat'

const en = { m: messagesFor(warRoomPlanMessages, 'en'), b: messagesFor(warRoomBriefMessages, 'en') }
const es = { m: messagesFor(warRoomPlanMessages, 'es'), b: messagesFor(warRoomBriefMessages, 'es') }

const card: WarFrontCard = {
  leagueId: 'L',
  leagueName: 'KBFL',
  posture: 'bubble',
  horizon: 'this_season',
  format: 'redraft',
  odds: { playoff: 48.4, bye: 6, title: 4.2 },
  record: { wins: 5, losses: 4, ties: 0 },
  seed: 6,
  teams: 12,
  weeksRemaining: 4,
  orders: [
    { kind: 'swing_game', week: 10, opponent: 'Team Taco', ifWin: 71.2, ifLose: 28.9, clinchOnWin: false, href: '/x' },
    { kind: 'what_decides', text: 'Get to 8 wins', href: '/x' },
    { kind: 'trade_deadline', week: 12, weeksLeft: 2, intent: 'buy', href: '/x' },
  ],
  scoutHref: '/x',
}

const trades: WarTrades = {
  mode: 'win_now',
  rankedBy: 'playoff',
  basisWeek: null,
  screened: 100,
  ideas: [
    {
      partnerRosterId: 'p',
      partnerName: 'Gridiron Goblins',
      send: { id: 's', name: 'Rachaad White', position: 'RB', team: null, age: 26 },
      receive: { id: 'r', name: 'Jakobi Meyers', position: 'WR', team: null, age: 28 },
      youGainPerWeek: 4.2,
      partnerGainPerWeek: 1.1,
      playoffDelta: 6.3,
      titleDelta: 1.4,
      partnerPlayoffPct: 62,
    },
  ],
}

const format: FormatBrief = {
  lineup: [],
  twoQb: false,
  scoringNotes: [],
  scarcity: [
    { position: 'TE', starters: 12, avgStarter: 11.2, bestFreeAgent: { name: 'x', points: 4.1 }, gap: 7.1, you: 14.3, youVsLeague: 3.1 },
    { position: 'WR', starters: 24, avgStarter: 14, bestFreeAgent: { name: 'y', points: 11 }, gap: 3, you: 9.8, youVsLeague: -4.2 },
  ],
  calendar: { playoffTeams: 6, byeTeams: 2, playoffStartWeek: 15, tradeDeadlineWeek: 12, weeksRemaining: 4 },
  basisWeek: null,
  scarcityRefusal: null,
}

const input = (over: Partial<WarPlanInput> = {}): WarPlanInput => ({ leagueName: 'KBFL', card, trades, format, nextSeason: null, ...over })

describe('warPlanPrompt — what the War Room computed, as a brief', () => {
  it('carries posture, odds, record, the swing game, what decides it, the deadline, the trade, the edge and the hole', () => {
    const t = warPlanPrompt(input(), en.m, en.b, 'en')
    expect(t.split('\n')[0]).toBe('War plan for KBFL.')
    for (const s of [
      'Situation: on the playoff bubble.',
      'Odds: playoffs 48%, bye 6%, title 4%.',
      'Record 5-4, seed 6/12, 4 weeks left.',
      'Swing game: week 10 vs Team Taco — win 71%, lose 29%.',
      'What decides it: Get to 8 wins',
      'Trade deadline: week 12 (2 weeks away).',
      'Best trade found: send Rachaad White, get Jakobi Meyers from Gridiron Goblins (+6.3 playoff odds).',
      'My biggest edge: TE (3.1 pts/week over the league',
      'My biggest hole: WR (4.2 pts/week under it).',
      'Scarcest position here: TE',
    ]) {
      expect(t).toContain(s)
    }
  })

  it('ends with the request, which names its sources and asks for uncertainty', () => {
    const t = warPlanPrompt(input(), en.m, en.b, 'en')
    const last = t.split('\n').at(-1)!
    expect(last).toContain('three moves that matter most')
    expect(last).toContain('Season Outlook simulation')
    expect(last).toContain('say what you’re unsure of')
  })

  it('🛑 a viewer without trade ideas (locked → trades null) never gets a trade line', () => {
    const t = warPlanPrompt(input({ trades: null }), en.m, en.b, 'en')
    expect(t).not.toContain('Best trade found')
    expect(t).not.toContain('Gridiron Goblins')
  })

  it('a dynasty or keeper read comes from the next-season engines, in their labels', () => {
    const dyn = warPlanPrompt(
      input({ nextSeason: { kind: 'dynasty', window: 'rebuild', posture: 'sell_for_youth', contendScore: 30, avgStarterAge: 28, earlyPickCount: 1, facts: [], missing: [] } }),
      en.m,
      en.b,
      'en',
    )
    expect(dyn).toContain('Dynasty read: Rebuild; Sell: move aging starters for young players and picks.')
    const keep = warPlanPrompt(
      input({
        nextSeason: {
          kind: 'keeper',
          maxKeepers: 2,
          recommended: [
            { playerId: 'a', name: 'Puka Nacua', position: 'WR', cost: 'Round 8', surplusRounds: 6, verdict: 'definite_keep' },
            { playerId: 'b', name: 'Bucky Irving', position: 'RB', cost: 'Round 12', surplusRounds: 5, verdict: 'keep' },
          ],
          bubble: [],
          avoid: [],
          draft: null,
          needsMoreData: false,
          missing: [],
        },
      }),
      en.m,
      en.b,
      'en',
    )
    expect(keep).toContain('Keeper read: keep Puka Nacua, Bucky Irving (limit 2).')
  })

  it('in Spanish, the whole brief is Spanish — it goes out as the user’s own words', () => {
    const t = warPlanPrompt(input(), es.m, es.b, 'es')
    expect(t).toContain('Plan de guerra para KBFL.')
    expect(t).toContain('Situación: en la burbuja de playoffs.')
    expect(t).toContain('Mejor cambio encontrado: enviar a Rachaad White, recibir a Jakobi Meyers de Gridiron Goblins (+6.3 prob. de playoffs).')
    expect(t).toContain('Escribe mi plan de guerra')
    expect(t).not.toContain('Situation:')
  })

  it('stays under the length budget by dropping the least decisive lines first — never the request', () => {
    const long = 'L'.repeat(700)
    const t = warPlanPrompt(
      input({
        trades: { ...trades, mode: 'win_now', ideas: [{ ...(trades as Extract<WarTrades, { mode: 'win_now' }>).ideas[0]!, partnerName: long }] },
        card: { ...card, orders: card.orders.map((o) => (o.kind === 'what_decides' ? { ...o, text: long } : o)) },
      }),
      en.m,
      en.b,
      'en',
    )
    expect(t.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
    expect(t).toContain('War plan for KBFL.')
    expect(t).toContain('three moves that matter most')
    // The scarcest-position line is the first to go; posture and odds are the last.
    expect(t).not.toContain('Scarcest position here')
    expect(t).toContain('Situation: on the playoff bubble.')
    expect(t).toContain('Odds: playoffs 48%')
  })

  it('an unplaced league with nothing computed still makes a valid request', () => {
    const t = warPlanPrompt({ leagueName: 'New League', card: null, trades: null, format: null, nextSeason: null }, en.m, en.b, 'en')
    expect(t.split('\n')).toHaveLength(2)
  })

  it('every English string has a Spanish one', () => {
    expect(missingMessages(warRoomPlanMessages, 'es')).toEqual([])
  })
})
