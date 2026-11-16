/**
 * War Room phase 5 — the road ahead on screen (components/core-app/screens/WarCampaign.tsx) and in the
 * Chimmy brief (lib/core-app/warRoomPlanPrompt.ts).
 *
 * Pins: each game shows both results, the swing and the "biggest" tag; opponents appear only as facts
 * (record, their own odds); the tiebreak lists you and the teams within a win with points-for gaps;
 * Spanish mode leaves no English sentence behind; and the brief carries the biggest game only when it
 * is not already the swing game the card names.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { WarCampaign } from '@/components/core-app/screens/WarCampaign'
import type { WarCampaign as WarCampaignView } from '@/lib/core-app/warRoomCampaign'
import { messagesFor, missingMessages } from '@/lib/i18n/messages'
import { warRoomCampaignMessages } from '@/lib/core-app/messages/warRoomCampaign'
import { warRoomPlanMessages } from '@/lib/core-app/messages/warRoomPlan'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import { warPlanPrompt, MAX_PROMPT_CHARS } from '@/lib/core-app/warRoomPlanPrompt'
import type { WarFrontCard } from '@/lib/core-app/warRoomFront'

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

const view: WarCampaignView = {
  kind: 'games',
  playoffPct: 46.2,
  games: [
    { week: 10, opponent: { rosterId: 'a', name: 'Team Taco', wins: 7, losses: 2, ties: 0, playoffPct: 94 }, ifWin: 58.1, ifLose: 37.3, swing: 20.8, biggest: false, small: false },
    { week: 11, opponent: { rosterId: 'c', name: 'Gridiron Goblins', wins: 5, losses: 4, ties: 0, playoffPct: 41 }, ifWin: 63.9, ifLose: 30.2, swing: 33.7, biggest: true, small: false },
    { week: 12, opponent: { rosterId: 'e', name: 'Bench Mob', wins: 1, losses: 8, ties: 0, playoffPct: null }, ifWin: 47.5, ifLose: 45.6, swing: 1.9, biggest: false, small: true },
  ],
  inProgressWeek: null,
  unpricedGames: 2,
  medianGame: true,
  tiebreak: {
    playoffTeams: 6,
    rows: [
      { rosterId: 'b', name: 'Waiver Wire Warriors', isYou: false, seed: 5, wins: 6, losses: 3, ties: 0, pointsFor: 1104.6, pointsGap: 38.2, inField: true },
      { rosterId: 'me', name: 'Mine', isYou: true, seed: 6, wins: 5, losses: 4, ties: 0, pointsFor: 1066.4, pointsGap: 0, inField: true },
      { rosterId: 'c', name: 'Gridiron Goblins', isYou: false, seed: 7, wins: 5, losses: 4, ties: 0, pointsFor: 1054.4, pointsGap: -12, inField: false },
    ],
  },
}

describe('WarCampaign — on screen', () => {
  it('each game: both results, the swing, the biggest tag, and opponent facts', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarCampaign view={view} />))
    expect(t).toContain('The road ahead')
    expect(t).toContain('Your playoff odds today: 46%')
    expect(t).toContain('Week 11 vs Gridiron Goblins')
    expect(t).toContain('5-4 · 41% playoff odds')
    expect(t).toContain('Win: 64%')
    expect(t).toContain('Lose: 30%')
    expect(t).toContain('34-point swing')
    expect(t).toContain('Biggest game left')
    expect(t).toContain('Barely moves your odds')
    // An unmodelled opponent shows a record and no invented odds.
    expect(t).toContain('1-8')
    expect(t).not.toMatch(/1-8 · \d+% playoff odds/)
    expect(t).toContain('2 later games aren’t priced here.')
    expect(t).toContain('median score')
  })

  it('the biggest game is marked on its own card only', () => {
    lang.language = 'en'
    const html = renderToStaticMarkup(<WarCampaign view={view} />)
    expect(html.match(/data-biggest="true"/g)).toHaveLength(1)
    expect(html).toContain('id="war-road"')
  })

  it('the tiebreak: you and the teams within a win, with points-for gaps and the field marked', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarCampaign view={view} />))
    expect(t).toContain('If records tie')
    expect(t).toContain('the top 6 make the playoffs')
    expect(t).toContain('Waiver Wire Warriors')
    expect(t).toContain('+38.2 vs you')
    expect(t).toContain('−12.0 vs you')
    expect(t).toContain('You')
  })

  it.each([
    ['clinched', 'Your playoff spot is clinched'],
    ['eliminated', 'out of the playoff race'],
    ['unplaced', 'can’t be modelled yet'],
    ['no_games', 'No regular-season games left.'],
  ] as const)('nothing to price: %s', (why, says) => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarCampaign view={{ kind: 'none', why, tiebreak: null }} />))
    expect(t).toContain(says)
  })

  it('a game under way is named', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarCampaign view={{ ...view, inProgressWeek: 9 }} />))
    expect(t).toContain('Week 9 is under way')
  })

  it('Spanish: every line translated, no English sentence left', () => {
    lang.language = 'es'
    const t = text(renderToStaticMarkup(<WarCampaign view={{ ...view, inProgressWeek: 9 }} />))
    expect(t).toContain('El camino por delante')
    expect(t).toContain('Semana 11 contra Gridiron Goblins')
    expect(t).toContain('Si ganas: 64%')
    expect(t).toContain('El partido más importante que queda')
    expect(t).toContain('Si hay empate de récord')
    expect(t).not.toMatch(/\b(Week|Win:|Lose:|swing|Biggest|Barely|If records tie|playoff odds|later games|under way)\b/)
    lang.language = 'en'
  })

  it('both catalogs carry every key', () => {
    expect(missingMessages(warRoomCampaignMessages, 'es')).toEqual([])
    expect(missingMessages(warRoomPlanMessages, 'es')).toEqual([])
  })
})

describe('The Chimmy brief carries the road ahead', () => {
  const m = messagesFor(warRoomPlanMessages, 'en')
  const b = messagesFor(warRoomBriefMessages, 'en')
  const card = (swingWeek: number | null): WarFrontCard => ({
    leagueId: 'L',
    leagueName: 'KBFL',
    posture: 'bubble',
    horizon: 'this_season',
    format: 'redraft',
    odds: { playoff: 46.2, bye: null, title: 4 },
    record: { wins: 5, losses: 4, ties: 0 },
    seed: 6,
    teams: 12,
    weeksRemaining: 5,
    orders: swingWeek == null ? [] : [{ kind: 'swing_game', week: swingWeek, opponent: 'Team Taco', ifWin: 58.1, ifLose: 37.3, clinchOnWin: false, href: '/x' }],
    scoutHref: '/x',
  })
  const input = (swingWeek: number | null) => ({ leagueName: 'KBFL', card: card(swingWeek), trades: null, format: null, nextSeason: null, campaign: view })

  it('names the biggest game when it is a later week than the swing game', () => {
    const p = warPlanPrompt(input(10), m, b, 'en')
    expect(p).toContain('Biggest game left: week 11 vs Gridiron Goblins — win 64%, lose 30%.')
    expect(p).toContain('Within a win of me (ties broken by points for): Waiver Wire Warriors 6-3, +38.2 pts for vs me; Gridiron Goblins 5-4, −12.0 pts for vs me.')
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS)
  })

  it('does not repeat it when the swing game already is the biggest', () => {
    const p = warPlanPrompt(input(11), m, b, 'en')
    expect(p).not.toContain('Biggest game left')
  })

  it('in Spanish', () => {
    const p = warPlanPrompt(input(10), messagesFor(warRoomPlanMessages, 'es'), messagesFor(warRoomBriefMessages, 'es'), 'es')
    expect(p).toContain('Partido más importante que queda: semana 11 contra Gridiron Goblins')
    expect(p).toContain('los empates se rompen por puntos a favor')
  })
})
