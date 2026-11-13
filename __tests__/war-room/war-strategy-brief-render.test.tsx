/**
 * How this league is won, and next season — on the rendered markup (WarStrategyBrief.tsx).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WarStrategyBrief } from '@/components/core-app/screens/WarStrategyBrief'
import type { FormatBrief } from '@/lib/core-app/warRoomFormat'
import type { NextSeasonView } from '@/lib/core-app/warRoomNextSeason'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import { missingMessages } from '@/lib/i18n/messages'

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

const brief = (over: Partial<FormatBrief> = {}): FormatBrief => ({
  lineup: [
    { slot: 'QB', count: 1 },
    { slot: 'RB', count: 2 },
    { slot: 'WR', count: 2 },
    { slot: 'TE', count: 1 },
    { slot: 'SUPER_FLEX', count: 1 },
  ],
  twoQb: true,
  scoringNotes: ['Receptions are worth 0.5, not 1.'],
  scarcity: [
    { position: 'TE', starters: 12, avgStarter: 11.2, bestFreeAgent: { name: 'Waiver TE', points: 4.1 }, gap: 7.1, you: 14.3, youVsLeague: 3.1 },
    { position: 'WR', starters: 24, avgStarter: 14, bestFreeAgent: { name: 'Waiver WR', points: 11 }, gap: 3, you: 9.8, youVsLeague: -4.2 },
  ],
  calendar: { playoffTeams: 6, byeTeams: 2, playoffStartWeek: 15, tradeDeadlineWeek: 11, weeksRemaining: 4 },
  basisWeek: { season: '2026', week: 10 },
  scarcityRefusal: null,
  ...over,
})

describe('WarStrategyBrief — how this league is won', () => {
  it('ranks the measured scarcity and names your edge and your hole against the league average', () => {
    const t = text(renderToStaticMarkup(<WarStrategyBrief format={brief()} nextSeason={null} />))
    expect(t).toContain('How this league is won')
    expect(t).toContain('TE: starters average 11.2 · best free agent 4.1 (Waiver TE) · gap 7.1')
    expect(t).toContain('you +3.1')
    expect(t).toContain('Your biggest edge: TE (3.1 a week over the league’s average starter).')
    expect(t).toContain('Your biggest hole: WR (4.2 a week under it).')
    expect(t.indexOf('TE: starters')).toBeLessThan(t.indexOf('WR: starters'))
  })

  it('prints the lineup, superflex, the scoring rules and the calendar', () => {
    const t = text(renderToStaticMarkup(<WarStrategyBrief format={brief()} nextSeason={null} />))
    expect(t).toContain('QB · 2 RB · 2 WR · TE · SUPER_FLEX')
    expect(t).toContain('A second quarterback can start here.')
    expect(t).toContain('Receptions are worth 0.5, not 1.')
    expect(t).toContain('6 teams make the playoffs, top 2 get a bye · playoffs start week 15 · trade deadline week 11 · 4 weeks left in the regular season')
  })

  it('names no edge or hole under a point — small differences are noise, not strategy', () => {
    const t = text(
      renderToStaticMarkup(
        <WarStrategyBrief format={brief({ scarcity: [{ ...brief().scarcity[0]!, youVsLeague: 0.4 }] })} nextSeason={null} />,
      ),
    )
    expect(t).not.toContain('Your biggest edge')
    expect(t).not.toContain('Your biggest hole')
  })

  it('says why scarcity is missing instead of drawing an empty list', () => {
    const t = text(renderToStaticMarkup(<WarStrategyBrief format={brief({ scarcity: [], scarcityRefusal: 'No projection week is on file yet.' })} nextSeason={null} />))
    expect(t).toContain('Scarcity could not be measured: No projection week is on file yet.')
  })
})

describe('WarStrategyBrief — next season', () => {
  it('dynasty: the window, the posture, the numbers and the engine’s own facts', () => {
    const plan: NextSeasonView = {
      kind: 'dynasty',
      window: 'rebuild',
      posture: 'sell_for_youth',
      contendScore: 31.4,
      avgStarterAge: 28.44,
      earlyPickCount: 2,
      facts: ['Average starter age 28.4 is the second-oldest in the league.'],
      missing: [],
    }
    const t = text(renderToStaticMarkup(<WarStrategyBrief format={null} nextSeason={plan} />))
    expect(t).toContain('Next season')
    expect(t).toContain('Rebuild')
    expect(t).toContain('Sell: move aging starters for young players and picks.')
    expect(t).toContain('Average starter age 28.4 · 2 early picks held · contention score 31/100')
    expect(t).toContain('second-oldest in the league')
  })

  it('keeper: who to keep with cost and value, the bubble, who to let go, and the draft plan', () => {
    const plan: NextSeasonView = {
      kind: 'keeper',
      maxKeepers: 2,
      recommended: [{ playerId: 'a', name: 'Puka Nacua', position: 'WR', cost: 'Round 8', surplusRounds: 6, verdict: 'definite_keep' }],
      bubble: [{ playerId: 'b', name: 'Jaylen Warren', position: 'RB', cost: 'Round 10', surplusRounds: 1, verdict: 'borderline' }],
      avoid: [{ playerId: 'c', name: 'Expensive Vet', position: 'RB', cost: 'Round 2', surplusRounds: -3, verdict: 'let_go' }],
      draft: { consumedRounds: [8], priorityPositions: ['TE', 'RB'] },
      needsMoreData: true,
      missing: ['keeper_cost_partial'],
    }
    const t = text(renderToStaticMarkup(<WarStrategyBrief format={null} nextSeason={plan} />))
    expect(t).toContain('Keep (1 of 2 allowed)')
    expect(t).toContain('Puka Nacua, WR — Round 8 · +6 rounds of value')
    expect(t).toContain('On the bubble')
    expect(t).toContain('Let go — they cost more than they’re worth')
    expect(t).toContain('Expensive Vet, RB — Round 2 · −3 rounds of value')
    expect(t).toContain('Rounds your keepers use: 8 · Target first in the draft: TE, RB')
    expect(t).toContain('this plan is partial')
  })

  it('redraft says plainly there is nothing to plan; an unavailable engine says why', () => {
    expect(text(renderToStaticMarkup(<WarStrategyBrief format={null} nextSeason={{ kind: 'none', why: 'one_season', reason: null }} />))).toContain(
      'Nothing carries over in this league',
    )
    expect(
      text(renderToStaticMarkup(<WarStrategyBrief format={null} nextSeason={{ kind: 'none', why: 'unavailable', reason: 'No keeper season for this league' }} />)),
    ).toContain('(No keeper season for this league)')
  })

  it('draws nothing at all when both halves are missing', () => {
    expect(renderToStaticMarkup(<WarStrategyBrief format={null} nextSeason={null} />)).toBe('')
  })

  it('every English string has a Spanish one', () => {
    expect(missingMessages(warRoomBriefMessages, 'es')).toEqual([])
  })
})
