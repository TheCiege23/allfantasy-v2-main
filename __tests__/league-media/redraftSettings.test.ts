/**
 * lib/league-media/redraftSettings.ts — who gets the redraft Settings page, and that every eyebrow is
 * real league data (no sport-default week, no deadline after the playoffs).
 */
import { describe, expect, it } from 'vitest'
import { buildRedraftSettingsView, type RedraftSettingsLeague } from '@/lib/league-media/redraftSettings'

const base: RedraftSettingsLeague = {
  platform: 'allfantasy',
  sport: 'NFL',
  leagueType: 'redraft',
  leagueVariant: null,
  isDynasty: false,
  playoffStartWeek: 15,
  tradeDeadlineWeek: 12,
  settings: {},
}

describe('buildRedraftSettingsView', () => {
  it('themes a native redraft league in each of the seven sports', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']) {
      expect(buildRedraftSettingsView({ ...base, sport }, 'Regular season')?.sport).toBe(sport.toLowerCase())
    }
  })

  it('keeps the default page for dynasty, keeper, best ball, guillotine, IDP and imported leagues', () => {
    expect(buildRedraftSettingsView({ ...base, leagueType: 'dynasty', isDynasty: true }, 'Regular season')).toBeNull()
    expect(buildRedraftSettingsView({ ...base, leagueVariant: 'keeper' }, 'Regular season')).toBeNull()
    expect(buildRedraftSettingsView({ ...base, bestBallMode: true }, 'Regular season')).toBeNull()
    expect(buildRedraftSettingsView({ ...base, guillotineMode: true }, 'Regular season')).toBeNull()
    expect(buildRedraftSettingsView({ ...base, leagueVariant: 'idp' }, 'Regular season')).toBeNull()
    expect(buildRedraftSettingsView({ ...base, platform: 'sleeper' }, 'Regular season')).toBeNull()
    expect(buildRedraftSettingsView({ ...base, sport: 'CRICKET' }, 'Regular season')).toBeNull()
  })

  it('writes the season eyebrows from the chosen weeks', () => {
    const v = buildRedraftSettingsView(base, 'Regular season')!
    expect(v.sections.general.when).toBe('Before the draft')
    expect(v.sections.draft.when).toBe('Draft day')
    expect(v.sections['waivers-trades'].when).toBe('Weeks 1–14 · trade deadline Wk 12')
    expect(v.sections.playoffs.when).toBe('From Week 15')
    expect(v.subPages.trades).toEqual({ when: 'Weeks 1–14 · trade deadline Wk 12', stage: 'now' })
  })

  it('never prints a week the league did not choose, nor a deadline at or after the playoffs', () => {
    const none = buildRedraftSettingsView({ ...base, playoffStartWeek: null, tradeDeadlineWeek: null }, 'Regular season')!
    expect(none.sections['waivers-trades'].when).toBe('All season')
    expect(none.sections.playoffs.when).toBe('Season’s end')
    const late = buildRedraftSettingsView({ ...base, tradeDeadlineWeek: 16 }, 'Regular season')!
    expect(late.sections['waivers-trades'].when).toBe('Weeks 1–14')
    const fromJson = buildRedraftSettingsView({ ...base, playoffStartWeek: null, settings: { playoff_structure: { playoff_start_week: 20 } } }, 'Regular season')!
    expect(fromJson.sections.playoffs.when).toBe('From Week 20')
  })

  it('stages the timeline from the lifecycle phase', () => {
    const stages = (phase: Parameters<typeof buildRedraftSettingsView>[1]) => {
      const v = buildRedraftSettingsView(base, phase)!
      return ['general', 'roster-scoring', 'draft', 'waivers-trades', 'playoffs'].map((id) => v.sections[id].stage)
    }
    expect(stages('Setup')).toEqual(['now', 'now', 'next', 'next', 'next'])
    expect(stages('Regular season')).toEqual(['done', 'done', 'done', 'now', 'next'])
    expect(stages('Playoffs')).toEqual(['done', 'done', 'done', 'done', 'now'])
    expect(stages('Offseason')).toEqual(['done', 'done', 'done', 'done', 'done'])
    const v = buildRedraftSettingsView(base, 'Setup')!
    expect(v.sections.members.stage).toBeUndefined()
  })

  it('speaks Spanish, and never says «waiver»', () => {
    const v = buildRedraftSettingsView(base, 'Regular season', 'es')!
    expect(v.sections.general.when).toBe('Antes del draft')
    expect(v.sections['waivers-trades'].when).toBe('Semanas 1–14 · fecha límite de intercambios Sem 12')
    const all = [...Object.values(v.sections).map((s) => s.when), ...Object.values(v.subPages).map((s) => s?.when ?? '')]
    expect(all.filter((s) => /waiver/i.test(s))).toEqual([])
  })
})
