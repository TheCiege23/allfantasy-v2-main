/**
 * War Room phase 7 — playoff readiness (lib/core-app/warRoomPlayoffReady.ts, WarPlayoffReady.tsx).
 *
 * Pins: only a team still in the title race gets it; the playoff weeks agree with the season
 * timeline's own rule; the lineup is the FULL-STRENGTH one, so a hurt starter is shown as hurt rather
 * than vanishing; reserve and taxi players are neither starters nor backups; a ruled-out player is not
 * a backup; byes are only the ones inside the playoff weeks; the thinnest spots are ranked by the drop
 * to the next man up; and the Chimmy brief carries it.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import type { ScenarioModel, ScenarioPlayer } from '@/lib/core-app/outlookScenario'
import type { OutlookTeam } from '@/lib/core-app/seasonOutlook'
import { buildSeasonTimeline } from '@/lib/core-app/seasonTimeline'
import { buildPlayoffReady, MAX_THIN, playoffWeeks, type PlayoffReady } from '@/lib/core-app/warRoomPlayoffReady'
import { WarPlayoffReady } from '@/components/core-app/screens/WarPlayoffReady'
import { messagesFor, missingMessages } from '@/lib/i18n/messages'
import { warRoomPlayoffReadyMessages } from '@/lib/core-app/messages/warRoomPlayoffReady'
import { warRoomPlanMessages } from '@/lib/core-app/messages/warRoomPlan'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import { warPlanPrompt } from '@/lib/core-app/warRoomPlanPrompt'

// Starting slots only, as `startingSlots` gives the real model.
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
let n = 0
const p = (name: string, position: string, points: number, over: Partial<ScenarioPlayer> = {}): ScenarioPlayer => ({
  id: `${name}-${n++}`,
  name,
  position,
  team: 'NYG',
  points,
  slot: 'B',
  injury: null,
  byeWeek: 7,
  age: 26,
  ...over,
})

function roster(): ScenarioPlayer[] {
  return [
    p('Josh Allen', 'QB', 24, { slot: 'S' }),
    p('Backup QB', 'QB', 14),
    p('Bijan Robinson', 'RB', 21, { slot: 'S', injury: { status: 'Out', kind: 'out' } }),
    p('RB Two', 'RB', 15, { slot: 'S' }),
    p('RB Three', 'RB', 9),
    p('Ja’Marr Chase', 'WR', 20, { slot: 'S', byeWeek: 15 }),
    p('WR Two', 'WR', 14, { slot: 'S' }),
    p('WR Three', 'WR', 13, { slot: 'S' }),
    p('WR Four', 'WR', 12.5),
    p('Trey McBride', 'TE', 13, { slot: 'S', injury: { status: 'Questionable', kind: 'risk' } }),
    // A TE on IR outscores the starter but is not on the field; a taxi TE is not a backup.
    p('IR TE', 'TE', 16, { slot: 'I' }),
    p('Taxi TE', 'TE', 11, { slot: 'T' }),
    // A ruled-out RB on the bench is not the next man up.
    p('Hurt RB', 'RB', 12, { injury: { status: 'Out', kind: 'out' } }),
  ]
}

function model(over: Partial<ScenarioModel> = {}): ScenarioModel {
  return {
    leagueId: 'L',
    basisWeek: { season: '2026', week: 11 },
    refusal: null,
    slots: SLOTS,
    teams: [{ rosterId: 'me', name: 'Mine', isYou: true, players: roster() }],
    freeAgents: [],
    sim: {} as ScenarioModel['sim'],
    seed: 1,
    weeks: [11, 12, 13, 14],
    youRosterId: 'me',
    ...over,
  }
}

const you = { rosterId: 'me', isYou: true, playoffPct: 91.2, byePct: 58.4, titlePct: 18.3 } as OutlookTeam
const build = (over: Partial<Parameters<typeof buildPlayoffReady>[0]> = {}) =>
  buildPlayoffReady({ model: model(), row: { you, byeTeams: 2 }, posture: 'contender', playoffStartWeek: 15, playoffTeams: 6, ...over })

describe('playoffWeeks — the season timeline’s rule', () => {
  it.each([
    [4, [15, 16]],
    [6, [15, 16, 17]],
    [8, [15, 16, 17]],
    [12, [15, 16, 17, 18]],
  ])('%i teams', (teams, weeks) => {
    expect(playoffWeeks(15, teams)).toEqual(weeks)
    const t = buildSeasonTimeline({ settings: { playoff_start_week: 15, playoff_teams: teams }, currentWeek: 11 })
    expect(t.phases.find((ph) => ph.key === 'championship')?.when).toBe(`WK ${weeks[weeks.length - 1]}`)
  })

  it('no start week, no playoff weeks', () => {
    expect(playoffWeeks(null, 6)).toEqual([])
  })
})

describe('buildPlayoffReady', () => {
  it('only for a team still in the title race, with dates and a readable roster', () => {
    expect(build({ posture: 'long_shot' })).toEqual({ kind: 'none', why: 'out_of_it' })
    expect(build({ posture: 'eliminated' })).toEqual({ kind: 'none', why: 'out_of_it' })
    expect(build({ row: null })).toEqual({ kind: 'none', why: 'out_of_it' })
    expect(build({ playoffStartWeek: null })).toEqual({ kind: 'none', why: 'no_dates' })
    expect(build({ model: model({ refusal: 'no rosters' }) })).toEqual({ kind: 'none', why: 'not_priced' })
    expect(build({ model: null })).toEqual({ kind: 'none', why: 'not_priced' })
    expect(build({ posture: 'bubble' }).kind).toBe('ready')
    expect(build({ posture: 'clinched' }).kind).toBe('ready')
  })

  it('🛑 the full-strength lineup: a starter ruled out today is listed — as hurt — not dropped', () => {
    const r = build()
    if (r.kind !== 'ready') throw new Error('expected ready')
    const names = r.starters.map((s) => s.player.name)
    expect(names).toContain('Bijan Robinson')
    expect(r.injured.map((s) => [s.player.name, s.injury?.status])).toEqual([
      ['Bijan Robinson', 'Out'],
      ['Trey McBride', 'Questionable'],
    ])
  })

  it('reserve and taxi players are neither starters nor backups; a ruled-out player is not a backup', () => {
    const r = build()
    if (r.kind !== 'ready') throw new Error('expected ready')
    expect(r.starters.map((s) => s.player.name)).not.toContain('IR TE')
    const te = r.starters.find((s) => s.player.position === 'TE')!
    expect(te.backup).toBeNull()
    expect(te.dropOff).toBe(13)
    const rb = r.starters.find((s) => s.player.name === 'Bijan Robinson')!
    expect(rb.backup?.name).toBe('RB Three')
    expect(rb.dropOff).toBe(12)
  })

  it('byes only inside the playoff weeks', () => {
    expect(build()).toMatchObject({ weeks: [15, 16, 17], onBye: [expect.objectContaining({ byeWeeks: [15] })] })
    const r = build({ playoffStartWeek: 16 })
    if (r.kind !== 'ready') throw new Error('expected ready')
    expect(r.onBye).toEqual([])
  })

  it('the thinnest spots: biggest drop to the next man up first, capped', () => {
    const r = build()
    if (r.kind !== 'ready') throw new Error('expected ready')
    // TE 13 (nobody behind), Bijan 21 → RB Three 9 = 12, QB 24 → 14 = 10.
    expect(r.thinnest.map((s) => [s.player.name, s.dropOff])).toEqual([
      ['Trey McBride', 13],
      ['Bijan Robinson', 12],
      ['Josh Allen', 10],
    ])
    expect(r.thinnest.length).toBeLessThanOrEqual(MAX_THIN)
  })

  it('odds: title first, bye only where the league has byes', () => {
    expect(build()).toMatchObject({ odds: { title: 18.3, playoff: 91.2, bye: 58.4 } })
    expect(build({ row: { you, byeTeams: 0 } })).toMatchObject({ odds: { bye: null } })
  })
})

describe('WarPlayoffReady on screen', () => {
  const view = build() as Extract<PlayoffReady, { kind: 'ready' }>
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

  it('weeks, odds, byes, injuries, thinnest spots, and the basis', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarPlayoffReady view={view} />))
    expect(t).toContain('Your playoffs: weeks 15–17.')
    expect(t).toContain('Title odds 18% · playoffs 91% · bye 58%')
    expect(t).toContain('Ja’Marr Chase (WR) — bye in week 15')
    expect(t).toContain('Bijan Robinson (RB) — Out')
    expect(t).toContain('TE: no one behind Trey McBride — losing him costs all 13.0 pts/week.')
    expect(t).toContain('RB: losing Bijan Robinson means starting RB Three — 12.0 pts/week less.')
    expect(t).toContain('week 11 projections')
  })

  it('a team out of the race sees nothing; other gaps say why', () => {
    lang.language = 'en'
    expect(renderToStaticMarkup(<WarPlayoffReady view={{ kind: 'none', why: 'out_of_it' }} />)).toBe('')
    expect(text(renderToStaticMarkup(<WarPlayoffReady view={{ kind: 'none', why: 'no_dates' }} />))).toContain('doesn’t state when its playoffs start')
  })

  it('all clear reads as all clear', () => {
    lang.language = 'en'
    const t = text(renderToStaticMarkup(<WarPlayoffReady view={{ ...view, onBye: [], injured: [], thinnest: [] }} />))
    expect(t).toContain('No starter of yours is on bye')
    expect(t).toContain('No starter of yours carries an injury designation')
    expect(t).toContain('your depth holds')
  })

  it('Spanish', () => {
    lang.language = 'es'
    const t = text(renderToStaticMarkup(<WarPlayoffReady view={view} />))
    expect(t).toContain('Preparación para playoffs')
    expect(t).toContain('Tus playoffs: semanas 15–17.')
    expect(t).toContain('descansa en la semana 15')
    // The feed's designation words go through Game Plan's table.
    expect(t).toContain('Bijan Robinson (RB) — Fuera')
    expect(t).toContain('Trey McBride (TE) — Dudoso')
    expect(t).not.toMatch(/\b(Your playoffs|Title odds|bye in week|losing|no one behind|projections)\b/)
    lang.language = 'en'
  })

  it('catalog complete', () => {
    expect(missingMessages(warRoomPlayoffReadyMessages, 'es')).toEqual([])
    expect(missingMessages(warRoomPlanMessages, 'es')).toEqual([])
  })
})

describe('The Chimmy brief carries playoff readiness', () => {
  const m = messagesFor(warRoomPlanMessages, 'en')
  const b = messagesFor(warRoomBriefMessages, 'en')
  it('weeks, byes, injuries and the thinnest spot', () => {
    const prompt = warPlanPrompt({ leagueName: 'KBFL', card: null, trades: null, format: null, nextSeason: null, playoffReady: build() }, m, b, 'en')
    expect(prompt).toContain(
      'Playoff weeks 15–17. Starters on bye then: Ja’Marr Chase (week 15). Injury designations now: Bijan Robinson (Out), Trey McBride (Questionable). Thinnest spot: TE — losing Trey McBride costs 13.0 pts/week to the next man up.',
    )
  })
  it('nothing for a team out of the race', () => {
    const prompt = warPlanPrompt({ leagueName: 'KBFL', card: null, trades: null, format: null, nextSeason: null, playoffReady: { kind: 'none', why: 'out_of_it' } }, m, b, 'en')
    expect(prompt).not.toContain('Playoff weeks')
  })
})
