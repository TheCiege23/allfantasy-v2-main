/**
 * War Room phase 8 — the race (lib/core-app/warRoomRace.ts, WarRace.tsx).
 *
 * Pins: only a team still racing gets it; the rows are you plus the teams near the cut or with odds
 * still in play, in seed order, capped with the ones nearest the cut kept; a clinched or eliminated
 * rival is not in the race; the cut line falls between the last seed in and the first out; the
 * remaining-schedule rank and the weeks a rival still plays you are carried through; and the screen,
 * Spanish and the Chimmy brief say it as facts.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import type { SimGame } from '@/lib/core-app/outlookSim'
import type { OutlookTeam } from '@/lib/core-app/seasonOutlook'
import { buildWarRace, MAX_ROWS, type WarRace } from '@/lib/core-app/warRoomRace'
import { WarRace as WarRaceScreen } from '@/components/core-app/screens/WarRace'
import { messagesFor, missingMessages } from '@/lib/i18n/messages'
import { warRoomRaceMessages } from '@/lib/core-app/messages/warRoomRace'
import { warRoomPlanMessages } from '@/lib/core-app/messages/warRoomPlan'
import { warRoomBriefMessages } from '@/lib/core-app/messages/warRoomBrief'
import { warPlanPrompt } from '@/lib/core-app/warRoomPlanPrompt'

function team(seed: number, playoffPct: number, over: Partial<OutlookTeam> = {}): OutlookTeam {
  return {
    rosterId: `t${seed}`,
    name: `Team ${seed}`,
    isYou: false,
    wins: 12 - seed,
    losses: seed - 1,
    ties: 0,
    pointsFor: 1300 - seed * 20,
    seed,
    playoffPct,
    byePct: 0,
    titlePct: 0,
    missPct: 100 - playoffPct,
    range: null,
    status: null,
    modelled: true,
    weeksFitted: 10,
    weeklyMean: 110,
    expectedWins: 5,
    schedule: {
      pastOpponentMu: 110,
      remainingOpponentMu: 100 + seed,
      pastRank: seed,
      remainingRank: 13 - seed,
      leagueMu: 108.4,
      pastGames: 10,
      remainingGames: 3,
    },
    ...over,
  }
}

/** Twelve teams, six make it. You are seed 7, just outside. */
function board(): OutlookTeam[] {
  const odds = [100, 100, 99, 88, 71, 55, 46, 30, 12, 1, 0.5, 0]
  return odds.map((p, i) => {
    const seed = i + 1
    if (seed === 7) return team(7, p, { rosterId: 'me', name: 'Mine', isYou: true })
    if (seed <= 2) return team(seed, p, { status: 'clinched' })
    if (seed >= 11) return team(seed, p, { status: 'eliminated' })
    return team(seed, p)
  })
}

const remaining: SimGame[] = [
  { week: 12, a: 'me', b: 't6' },
  { week: 13, a: 't8', b: 'me' },
  { week: 13, a: 't5', b: 't6' },
  { week: 14, a: 'me', b: 't6' },
]

const build = (over: Partial<Parameters<typeof buildWarRace>[0]> = {}) => {
  const teams = board()
  return buildWarRace({ row: { teams, playoffTeams: 6, you: teams.find((t) => t.isYou)! }, posture: 'bubble', remaining, ...over })
}

describe('buildWarRace', () => {
  it('you plus the teams near the cut or still in play, in seed order; settled teams left out', () => {
    const r = build()
    if (r.kind !== 'race') throw new Error('expected race')
    // In: odds strictly between 2 and 98 (seeds 4–9), or within two of the cut (seeds 5–8). Out: seed 3
    // at 99% and seed 10 at 1% (settled in all but name), 1–2 clinched, 11–12 eliminated.
    expect(r.rows.map((x) => x.seed)).toEqual([4, 5, 6, 7, 8, 9])
    expect(r.rows.map((x) => x.inField)).toEqual([true, true, true, false, false, false])
  })

  it('a rival settled by arithmetic is out of the race even when its odds still read as in play', () => {
    // Clinched or eliminated is decided by the schedule; a simulated percentage can lag it.
    const teams = board().map((t) => (t.seed === 5 ? { ...t, status: 'clinched' as const } : t.seed === 8 ? { ...t, status: 'eliminated' as const } : t))
    const r = buildWarRace({ row: { teams, playoffTeams: 6, you: teams.find((t) => t.isYou)! }, posture: 'bubble', remaining })
    if (r.kind !== 'race') throw new Error('expected race')
    expect(r.rows.map((x) => x.seed)).toEqual([4, 6, 7, 9])
  })

  it('the cap keeps the teams nearest the cut, and always you', () => {
    // Twenty teams, ten in, every one of them still in play — far more than MAX_ROWS. You are seed 20.
    const teams = Array.from({ length: 20 }, (_, i) =>
      i === 19 ? team(20, 3, { rosterId: 'me', name: 'Mine', isYou: true }) : team(i + 1, 50),
    )
    const r = buildWarRace({ row: { teams, playoffTeams: 10, you: teams[19] }, posture: 'long_shot', remaining: null })
    if (r.kind !== 'race') throw new Error('expected race')
    expect(r.rows).toHaveLength(MAX_ROWS)
    expect(r.rows.map((x) => x.rosterId)).toContain('me')
    // The rest are the seven nearest the cut line (10.5): seeds 8–13 and one of 7 / 14.
    const others = r.rows.filter((x) => !x.isYou).map((x) => x.seed)
    expect(others).toEqual(expect.arrayContaining([8, 9, 10, 11, 12, 13]))
    expect(others.every((sd) => sd >= 7 && sd <= 14)).toBe(true)
  })

  it('carries the remaining-schedule rank, the league average, and the weeks each rival still plays you', () => {
    const r = build()
    if (r.kind !== 'race') throw new Error('expected race')
    expect(r.ranked).toBe(12)
    expect(r.leagueAvg).toBe(108.4)
    expect(r.rows.find((x) => x.seed === 6)).toMatchObject({ scheduleRank: 7, opponentAvg: 106, vsYou: [12, 14] })
    expect(r.rows.find((x) => x.seed === 8)).toMatchObject({ vsYou: [13] })
    expect(r.rows.find((x) => x.isYou)).toMatchObject({ vsYou: [] })
    expect(r.rows.find((x) => x.seed === 5)).toMatchObject({ vsYou: [] })
  })

  it('without the schedule the rows still draw, with no head-to-head weeks', () => {
    const r = build({ remaining: null })
    if (r.kind !== 'race') throw new Error('expected race')
    expect(r.rows.every((x) => x.vsYou.length === 0)).toBe(true)
  })

  it('only while you are racing', () => {
    expect(build({ posture: 'clinched' })).toEqual({ kind: 'none', why: 'settled' })
    expect(build({ posture: 'eliminated' })).toEqual({ kind: 'none', why: 'settled' })
    expect(build({ posture: 'unplaced' })).toEqual({ kind: 'none', why: 'unplaced' })
    expect(build({ row: null })).toEqual({ kind: 'none', why: 'unplaced' })
    expect(build({ posture: 'contender' }).kind).toBe('race')
    expect(build({ posture: 'long_shot' }).kind).toBe('race')
  })

  it('an unmodelled rival near the cut is in the race with no odds invented', () => {
    const teams = board().map((t) => (t.seed === 8 ? { ...t, modelled: false } : t))
    const r = buildWarRace({ row: { teams, playoffTeams: 6, you: teams.find((t) => t.isYou)! }, posture: 'bubble', remaining })
    if (r.kind !== 'race') throw new Error('expected race')
    expect(r.rows.find((x) => x.seed === 8)).toMatchObject({ playoffPct: null })
  })
})

describe('WarRace on screen', () => {
  const view = build() as Extract<WarRace, { kind: 'race' }>
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

  it('rows, the cut line, odds, schedule ranks and head-to-head weeks', () => {
    lang.language = 'en'
    const html = renderToStaticMarkup(<WarRaceScreen view={view} />)
    const t = text(html)
    expect(t).toContain('The race')
    expect(t).toContain('the top 6 make it')
    expect(t).toContain('Team 6 in')
    expect(t).toContain('Team 4 in')
    expect(t).toContain('You out')
    expect(t).toContain('plays you in weeks 12, 14')
    expect(t).toContain('plays you in week 13')
    expect(t).toContain('7th hardest of 12')
    expect(t).toContain('opponents avg 106.0 (league 108.4)')
    // The cut rule sits on the first row out — yours here.
    expect(html.match(/data-cut="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-you="true"[^>]*data-cut="true"/)
  })

  it('hardest and easiest read as words', () => {
    lang.language = 'en'
    const rows = view.rows.map((r, i) => (i === 0 ? { ...r, scheduleRank: 1 } : i === 1 ? { ...r, scheduleRank: 12 } : r))
    const t = text(renderToStaticMarkup(<WarRaceScreen view={{ ...view, rows }} />))
    expect(t).toContain('hardest of 12')
    expect(t).toContain('easiest of 12')
  })

  it('a settled team sees nothing', () => {
    expect(renderToStaticMarkup(<WarRaceScreen view={{ kind: 'none', why: 'settled' }} />)).toBe('')
  })

  it('Spanish', () => {
    lang.language = 'es'
    const t = text(renderToStaticMarkup(<WarRaceScreen view={view} />))
    expect(t).toContain('La carrera')
    expect(t).toContain('juega contra ti en las semanas 12, 14')
    expect(t).toContain('7.º más difícil de 12')
    expect(t).not.toMatch(/\b(The race|plays you|hardest|easiest|opponents avg|make it)\b/)
    lang.language = 'en'
  })

  it('catalogs complete', () => {
    expect(missingMessages(warRoomRaceMessages, 'es')).toEqual([])
    expect(missingMessages(warRoomPlanMessages, 'es')).toEqual([])
  })
})

describe('The Chimmy brief carries the race', () => {
  it('each rival as facts', () => {
    const p = warPlanPrompt(
      { leagueName: 'KBFL', card: null, trades: null, format: null, nextSeason: null, race: build() },
      messagesFor(warRoomPlanMessages, 'en'),
      messagesFor(warRoomBriefMessages, 'en'),
      'en',
    )
    expect(p).toContain('The race (top 6 make it; schedule rank 1 = hardest left):')
    expect(p).toContain('Team 6 #6 6-5 55%, schedule 7/12, plays me wk 12/14')
  })
})
