/**
 * Playoff play-in week (lib/playoff-brackets/playIn.ts): the last one or two playoff spots decided in
 * a game the week before the playoffs. It is a bye plan, so the bracket engine plays it as one — these
 * pin the plans, that a saved plan is recognised as a play-in, the engine playing it from seeding to
 * champion with the play-in named, the bracket card offering and saving it, and the standings screen
 * saying so.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn() }))
const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.language]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.language, t, setLanguage: () => {} }) }
})

import { detectPlayIn, playInFor, playInOptions } from '@/lib/playoff-brackets/playIn'
import { checkByePlan, naturalByePlan, validByePlans } from '@/lib/playoff-brackets/byePlan'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffMatchupState,
  type NflRedraftPlayoffRuntimeState,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { readPlayoffFormat } from '@/lib/league/native/nativeScreenModels'
import { PlayoffBracketFormatCard } from '@/components/league-settings/PlayoffBracketFormatCard'
import { translations } from '@/lib/i18n/translations'

describe('the plans', () => {
  it('six teams, one spot: #6 v #7 in week 1, then the usual six-team bracket', () => {
    const p = playInFor(6, 1)!
    expect(p).toMatchObject({ qualifiers: 6, spots: 1, seeds: 7, plan: [2, 2, 1, 1, 1, 0, 0], games: [[6, 7]] })
    const c = checkByePlan(p.seeds, p.plan)
    expect(c.ok && c.roundCount).toBe(4)
    expect(c.ok && c.rounds.map((r) => r.games)).toEqual([1, 2, 2, 1])
  })

  it('six teams, two spots: #5 v #8 and #6 v #7', () => {
    expect(playInFor(6, 2)).toMatchObject({ seeds: 8, plan: [2, 2, 1, 1, 0, 0, 0, 0], games: [[5, 8], [6, 7]] })
  })

  it('other fields: four, eight and twelve teams', () => {
    expect(playInFor(4, 1)!.plan).toEqual([1, 1, 1, 0, 0])
    expect(playInFor(8, 2)!.plan).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0])
    const twelve = playInFor(12, 1)!
    expect(twelve.games).toEqual([[12, 13]])
    expect(checkByePlan(twelve.seeds, twelve.plan).ok).toBe(true)
  })

  it('never a play-in that is just a bigger bracket, takes a bye seed, or passes 16 seeds', () => {
    expect(playInFor(2, 2)).toBeNull() // every seed would be in it: that is the four-team bracket
    expect(playInFor(16, 1)).toBeNull()
    expect(playInFor(15, 2)).toBeNull()
    expect(playInFor(6, 3)).toBeNull()
    expect(playInFor(1, 1)).toBeNull()
    expect(playInOptions(6).map((p) => p.spots)).toEqual([1, 2])
  })

  it('a saved plan is recognised as a play-in, and nothing else is', () => {
    expect(detectPlayIn(7, [2, 2, 1, 1, 1, 0, 0])).toMatchObject({ qualifiers: 6, spots: 1 })
    expect(detectPlayIn(8, [2, 2, 1, 1, 0, 0, 0, 0])).toMatchObject({ qualifiers: 6, spots: 2 })
    expect(detectPlayIn(4, naturalByePlan(4))).toBeNull()
    expect(detectPlayIn(8, [2, 2, 1, 1, 0, 0, 0, 0].slice(0, 7))).toBeNull()
    // A commissioner's double bye for eight teams is a bye plan, not a play-in.
    expect(detectPlayIn(8, [3, 2, 1, 1, 0, 0, 0, 0])).toBeNull()
    expect(detectPlayIn(7, null)).toBeNull()
    // Every play-in is one of the plans the bracket card already accepts as valid.
    expect(validByePlans(7, 50).some((p) => p.join() === playInFor(6, 1)!.plan.join())).toBe(true)
  })
})

describe('the engine plays it', () => {
  const teams = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      rosterId: `t${String(i + 1).padStart(2, '0')}`,
      displayName: `Team ${i + 1}`,
      ownerId: `o${i + 1}`,
      wins: 13 - i,
      losses: i,
      pointsFor: 2000 - i * 37,
      pointsAgainst: 1500,
    }))
  const build = (byePlan: number[], playoffTeams: number) =>
    buildNflRedraftPlayoffRuntimeState({
      leagueId: 'L',
      seasonId: 'S',
      season: 2026,
      week: 15,
      rules: {
        general: { season: 2026, sport: 'NFL', teamCount: 10 },
        playoffs: { teamCount: playoffTeams, startWeek: 15, seedingRules: 'standings', standingsTiebreakers: ['win_pct', 'points_for'], byePlan },
        schedule: { regularSeasonLength: 14, playoffTransitionPoint: 15 },
      },
      teams: teams(10),
      now: new Date('2026-12-01T00:00:00Z'),
    })
  // The lower seed always wins here, so the play-in winner is the #7 seed and upsets carry through.
  const score = (m: NflRedraftPlayoffMatchupState) =>
    m.bye || m.complete || !m.homeRosterId || !m.awayRosterId ? m : { ...m, homeScore: 90, awayScore: 110, status: 'final' as const }

  it('round 1 is the play-in, #6 v #7, and the rounds after keep the six-team names', () => {
    const p = playInFor(6, 1)!
    const base = build(p.plan, p.seeds)
    const bracket = generateNflRedraftPlayoffBracket({ state: base }).bracket
    expect(bracket.rounds.map((r) => r.roundName)).toEqual(['Play-in', 'Quarterfinal', 'Semifinal', 'Championship'])
    const [game] = bracket.rounds[0].matchups
    expect(bracket.rounds[0].matchups).toHaveLength(1)
    expect([game.homeSeed, game.awaySeed]).toEqual([6, 7])
  })

  it('plays from the play-in to a champion; the play-in loser goes out in week one', () => {
    const p = playInFor(6, 1)!
    let state: NflRedraftPlayoffRuntimeState = build(p.plan, p.seeds)
    state = { ...state, bracket: generateNflRedraftPlayoffBracket({ state }).bracket }
    for (let week = 1; week <= 4; week += 1) {
      state = { ...state, bracket: { ...state.bracket, rounds: state.bracket.rounds.map((r) => (r.roundNumber === week ? { ...r, matchups: r.matchups.map(score) } : r)) } }
      const next = advanceNflRedraftPlayoffRound({ state })
      if (!next.ok) throw new Error(`week ${week}: ${next.code}`)
      state = next.state
    }
    const quarter = state.bracket.rounds[1].matchups
    expect(quarter.flatMap((m) => [m.homeRosterId, m.awayRosterId])).toContain('t07') // the play-in winner made it
    expect(quarter.flatMap((m) => [m.homeRosterId, m.awayRosterId])).not.toContain('t06')
    const final = finalizeNflRedraftPlayoffChampion({ state })
    expect(final.ok).toBe(true)
  })

  it('positive control: the same seven-team field without a play-in keeps its normal names', () => {
    const bracket = generateNflRedraftPlayoffBracket({ state: build(naturalByePlan(7), 7) }).bracket
    expect(bracket.rounds[0].roundName).not.toBe('Play-in')
  })
})

describe('the standings screen', () => {
  it('says "6 + play-in" and counts the extra week', () => {
    const f = readPlayoffFormat({ playoff_structure: { playoff_team_count: 7, first_round_byes: 2 }, playoff_bye_plan: [2, 2, 1, 1, 1, 0, 0] }, 15)
    expect(f.playIn).toEqual({ qualifiers: 6, games: [[6, 7]] })
    expect(f.weeks).toBe(4)
    expect(readPlayoffFormat({ playoff_structure: { playoff_team_count: 6, first_round_byes: 2 } }, 15)).not.toHaveProperty('playIn')
  })
})

describe('the bracket card', () => {
  const opt = (seeds: number, plan: number[]) => {
    const c = checkByePlan(seeds, plan)
    if (!c.ok) throw new Error(c.error)
    return { rounds: c.rounds, roundCount: c.roundCount, finalWeek: 14 + c.roundCount, fitsSeason: 14 + c.roundCount <= 18 }
  }
  const view = (teams: number, over: Record<string, unknown> = {}) => ({
    playoffTeams: teams,
    savedPlayoffTeams: teams,
    maxTeams: 12,
    plan: naturalByePlan(teams),
    options: validByePlans(teams).map((plan) => ({ plan, natural: plan.join() === naturalByePlan(teams).join(), description: '', ...opt(teams, plan) })),
    playIn: playInOptions(6).map((p) => ({ ...p, ...opt(p.seeds, p.plan) })),
    savedPlayIn: null,
    playoffStartWeek: 15,
    weeksPerRound: 1,
    lastWeek: 18,
    isPremium: true,
    locked: false,
    ...over,
  })
  const fetchMock = vi.fn()
  const json = (b: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(b) })
  beforeEach(() => {
    lang.language = 'en'
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('offers a play-in for the last spot, and saves seven seeds with its plan', async () => {
    fetchMock.mockReturnValueOnce(json(view(6))).mockReturnValueOnce(json({ ok: true })).mockReturnValueOnce(json(view(7)))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={6} canEdit />)
    const section = await screen.findByTestId('playoff-play-in')
    expect(section.textContent).toContain('Play-in for the last spot')
    expect(section.textContent).toContain('Play-in: #6 v #7')
    expect(section.textContent).toContain('Play-in in week 15 · final in week 18')
    fireEvent.click(screen.getByTestId('playoff-play-in-1'))
    fireEvent.click(screen.getByText('Save bracket format'))
    await screen.findByText('Bracket format saved')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ playoffTeams: 7, byePlan: [2, 2, 1, 1, 1, 0, 0] })
  })

  it('without AF Commissioner the play-in offers the upgrade', async () => {
    fetchMock.mockReturnValueOnce(json(view(6, { isPremium: false })))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={6} canEdit />)
    fireEvent.click(await screen.findByTestId('playoff-play-in-2'))
    expect(screen.queryByText('Save bracket format')).toBeNull()
    expect(screen.getByText('Upgrade to AF Commissioner')).toBeTruthy()
  })

  it('a saved play-in reads "6 playoff teams + play-in" and can be turned off', async () => {
    const saved = playInFor(6, 1)!
    fetchMock
      .mockReturnValueOnce(json(view(7, { plan: saved.plan, savedPlayIn: { qualifiers: 6, spots: 1 } })))
      .mockReturnValueOnce(json({ ok: true }))
      .mockReturnValueOnce(json(view(6)))
    render(<PlayoffBracketFormatCard leagueId="L" playoffTeams={7} canEdit />)
    expect(await screen.findByText('6 playoff teams + play-in')).toBeTruthy()
    expect((screen.getByTestId('playoff-play-in-1') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByTestId('playoff-play-in-none'))
    fireEvent.click(screen.getByText('Save bracket format'))
    await screen.findByText('Bracket format saved')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ playoffTeams: 6, byePlan: naturalByePlan(6) })
  })

  it('every play-in string has a Spanish translation', () => {
    const keys = Object.keys(translations.en).filter((k) => k.startsWith('lsHub.po.pi.'))
    expect(keys.length).toBe(8)
    for (const k of keys) expect(translations.es[k], k).toBeTruthy()
  })
})
