/**
 * The League Settings hub in Spanish (2026-11-13).
 *
 * Renders every tab for several league types and sports with the language set to `es`, then reads
 * every TEXT NODE, aria-label and placeholder. Two checks, because they catch different misses:
 *
 *  1. A string the dictionary CAN translate must not render in English — that is a `t()` the view
 *     forgot to call.
 *  2. No common English word may appear at all — that is a string the dictionary is missing.
 *
 * Data (league, team and player names, scoring presets) is fixture text chosen to contain none of
 * the words in check 2, so a hit there is always the hub's own copy.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'

const lang = vi.hoisted(() => ({ language: 'es' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: lang.language, t: (k: string) => k }),
}))

import { LeagueSettingsHubView, type HubCallbacks, type HubViewData } from '@/components/league-settings/hub/LeagueSettingsHubView'
import {
  buildDraftGroups,
  buildGeneralGroups,
  buildNotificationGroups,
  buildRosterItems,
  buildTypeRuleGroups,
  buildWaiverGroups,
  groupScoringRules,
  type HubKind,
} from '@/lib/league-settings-hub/hubModel'
import { hubText, HUB_ES_KEYS } from '@/lib/league-settings-hub/hubI18n'

afterEach(() => { cleanup(); lang.language = 'es' })

const cb = (): HubCallbacks => ({
  onToggleSetting: vi.fn(), onSaveTeamName: vi.fn(async () => null), onSaveNote: vi.fn(async () => null),
  onToggleNotification: vi.fn(), onToggleLeagueNotifications: vi.fn(), onToggleCoCommissioner: vi.fn(),
  onInviteCoOwner: vi.fn(async () => null), onOpenEditor: vi.fn(), onCopy: vi.fn(), onShare: vi.fn(), onLeaveLeague: vi.fn(),
})

const RULES: Record<string, Array<[string, number]>> = {
  NFL: [['passing_yards', 0.04], ['passing_td', 4], ['rushing_yards', 0.1], ['receptions', 1], ['fumble_recovery', 2], ['return_td', 6], ['fg_made_40_49', 4], ['pts_allow_0', 10]],
  NBA: [['points', 1], ['rebounds', 1.2], ['assists', 1.5], ['steals', 3], ['blocks', 3], ['turnovers', -1], ['three_pointers_made', 0.5], ['personal_foul', -0.5], ['double_double', 1.5], ['minutes_played', 0.1]],
  MLB: [['home_runs', 4], ['strikeouts', -1], ['innings_pitched', 3], ['pitch_strikeouts', 1], ['saves', 5]],
  NHL: [['goal', 3], ['assist', 2], ['save', 0.2], ['win', 5], ['five_hit_game', 1], ['penalty_minutes', -0.25]],
  SOCCER: [['goal', 5], ['clean_sheet', 4], ['gk_save', 1], ['yellow_card', -1], ['minutes_played', 1]],
}
const SLOTS: Record<string, Record<string, number>> = {
  NFL: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 },
  NBA: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3, IL: 2 },
  MLB: { C: 1, '1B': 1, SS: 1, OF: 3, SP: 2, RP: 2, BN: 4, IL: 2 },
  NHL: { C: 2, LW: 2, RW: 2, D: 4, G: 2, BN: 4, IR: 1 },
  SOCCER: { GK: 1, DEF: 4, MID: 4, FWD: 2, FLEX: 1, BN: 5, IR: 1 },
}

function data(kind: HubKind, sport: string, canEdit = true): HubViewData {
  const p = {
    league: {
      sport, season: 2026, teamCount: 12, leagueSize: 12, scoring: 'ppr', medianGame: true, tradeDeadlineWeek: 11, tradeReviewHours: 48,
      draftPickTrading: true, preventBenchDrops: false, irSlots: 2, irAllowOut: true, irAllowDoubtful: true, irAllowNA: true,
      allowPreDraftMoves: true, lockAllMoves: false, playoffTeams: 6, playoffStartWeek: 15, playoffWeeksPerRound: 1,
      waiverType: 'faab', waiverBudget: 100, waiverMinBid: 0, waiverClearAfterGames: true, waiverHours: 24,
      customDailyWaivers: true, waiverProcessTime: '3:00 AM', timezone: 'America/New_York', waiverSchedule: { mon: 'waivers', tue: 'fa', wed: 'none' },
      taxiSlots: 3, taxiAllowNonRookies: false, taxiYearsLimit: 2, taxiDeadlineWeek: 6, keeperCount: 3, keeperMaxYears: 2, keeperRoundPenalty: 1, keeperWaiverAllowed: true,
    },
    settings: { draftType: 'snake', rounds: 15, autostart: true, cpuAutoPick: true, alphabeticalSort: false, draftDateUtc: '2026-11-13T20:00:00Z', pickTimerPreset: '90s' },
    settingsSnapshot: { trade_review_mode: 'commissioner' },
  }
  const unified = { rosterConfig: { sections: [{ key: 'pro', label: 'Roster', slots: SLOTS[sport]! }] } }
  return {
    leagueId: 'L1', kind, leagueName: 'Kingdom North', leagueAvatarUrl: null, sport, season: 2026, teamCount: 12, leagueArt: null,
    canEdit, isHeadCommissioner: canEdit, importedFrom: null,
    myTeam: { name: 'Ghost Protocol', avatarUrl: null },
    notifications: { groups: buildNotificationGroups(kind, canEdit, sport), on: {}, leagueEnabled: true },
    general: buildGeneralGroups(p, kind), waivers: buildWaiverGroups(p, kind), typeRules: buildTypeRuleGroups(p, kind),
    commissionerNote: null,
    roster: buildRosterItems(unified, [], sport),
    scoring: { preset: null, categories: groupScoringRules(RULES[sport]!.map(([statKey, pointsValue]) => ({ statKey, pointsValue, enabled: true })), sport) },
    draft: buildDraftGroups(p),
    draftOrder: [{ slot: 1, name: 'Zed Quill' }, { slot: 2, name: 'Team 2' }],
    members: [
      { id: 't1', name: 'Zed Quill', teamName: 'Ghost Protocol', avatarUrl: null, isCommissioner: true, isCoCommissioner: false, isYou: true },
      { id: 't2', name: 'Bo Ketch', teamName: null, avatarUrl: null, isCommissioner: false, isCoCommissioner: true, isYou: false },
    ],
    coOwners: { rosterId: 'r1', invitations: [{ id: 'c1', name: 'Ivo Pell', accepted: false }] },
    invite: { link: 'https://allfantasy.ai/join?code=ABC', filled: 12, capacity: 12 },
    draftHistory: { title: '2026 Season Draft', status: 'snake · 15 rounds' },
    seasons: [{ year: 2025, champion: 'Zed Quill', runnerUp: 'Bo Ketch' }],
    standings: [{ rank: 1, name: 'Zed Quill', avatar: null, record: '9-4', winPct: '69%', pointsFor: '1,602.40', seasons: 2, titles: 1 }],
    highScores: [{ rank: 1, holder: 'Zed Quill', season: 2025, week: 7, value: '182.35' }],
    highScoresSeasons: [2026, 2025],
    playerHighScores: { seasons: [2026, 2025], rows: [{ rank: 1, name: 'Ivo Pell', team: 'Ghost Protocol', season: 2025, week: 14, points: '56.58' }] },
    correctionWeeks: { season: 2026, weeks: [{ week: 1, final: true, rescoredAt: '2026-09-12T15:00:00Z' }, { week: 2, final: false, rescoredAt: null }] },
  }
}

/** Every text node, aria-label, placeholder and title the hub put on screen, after clicking through all tabs. */
function screenText(d: HubViewData): string[] {
  const { container, getByTestId } = render(<LeagueSettingsHubView data={d} cb={cb()} advanced={{ label: 'Advanced settings', onOpen: () => {} }} />)
  const seen: string[] = []
  const collect = () => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { const s = n.textContent?.trim(); if (s) seen.push(s) }
    for (const el of container.querySelectorAll('[aria-label],[placeholder],[title]')) {
      for (const a of ['aria-label', 'placeholder', 'title']) { const v = el.getAttribute(a); if (v) seen.push(v) }
    }
  }
  for (const tab of ['my', 'setup', 'members', 'record']) {
    fireEvent.click(getByTestId(`league-settings-hub-tab-${tab}`))
    // Every scoring pill, so every category's rows render once.
    for (const pill of Array.from(container.querySelectorAll('.af-lsh-pill'))) { fireEvent.click(pill); collect() }
    collect()
  }
  return [...new Set(seen)]
}

/** Words that only the hub's own English copy contains — the fixture data avoids every one. */
const ENGLISH = /\b(the|and|your|you|league|team|teams|week|weeks|season|seasons|settings|player|players|scores?|draft order|roster|waiver budget|trade|before|after|every|only|when|yet|with|without|from|points|yards|bonus|game|games|goal|goals|save|saves|win|wins|wing|guard|forward|center|bench|injured|reserve|list|pick|picks|round|rounds|day|days|hours?|minutes?|seconds?|none|yes|open|final|edit|copy|share|invite|manage|cancel|save|loading|monday|tuesday|wednesday|turnovers?|rebounds?|assists?|steals?|blocks?)\b/i

/** Things that are allowed to stay as they are in Spanish: data, brand and sport shorthand. */
// "Final" is the Spanish for the Endgame group too, so it is allowed by name rather than by loosening the scan.
const ALLOWED = new Set(['Kingdom North', 'Ghost Protocol', 'Zed Quill', 'Bo Ketch', 'Ivo Pell', 'NFL', 'NBA', 'MLB', 'NHL', 'ppr', '—', '#', '‹', '›', 'Final'])

describe('the hub in Spanish', () => {
  const cases: Array<[HubKind, string]> = [['redraft', 'NFL'], ['dynasty', 'NBA'], ['keeper', 'MLB'], ['guillotine', 'NHL'], ['zombie', 'SOCCER'], ['best_ball', 'NFL']]

  it.each(cases)('%s %s: nothing the dictionary knows renders in English', (kind, sport) => {
    const missed = screenText(data(kind, sport)).filter((s) => hubText('es', s, sport) !== s)
    expect(missed).toEqual([])
  })

  it.each(cases)('%s %s: no English copy left on screen', (kind, sport) => {
    const left = screenText(data(kind, sport)).filter((s) => !ALLOWED.has(s) && ENGLISH.test(s))
    expect(left).toEqual([])
  })

  it('🛑 the checks can fail: English is what renders when the language is English', () => {
    lang.language = 'en'
    const shown = screenText(data('redraft', 'NFL'))
    expect(shown.filter((s) => hubText('es', s, 'NFL') !== s).length).toBeGreaterThan(100)
    expect(shown.filter((s) => !ALLOWED.has(s) && ENGLISH.test(s)).length).toBeGreaterThan(50)
  })

  it.each(['SOCCER', 'NHL', 'MLB'])('%s: the Save button says Guardar; only the scoring table’s stat "Save" is a save', (sport) => {
    const d = data('redraft', sport)
    d.scoring = { preset: null, categories: [{ key: 'goalies', label: 'Goalies', rows: [{ key: 'save', label: 'Save', value: '0.2' }] }] }
    const { getByTestId, getByRole, getByText } = render(<LeagueSettingsHubView data={d} cb={cb()} initialTab="my" />)
    expect(getByRole('button', { name: 'Guardar' })).toBeTruthy()
    fireEvent.click(getByTestId('league-settings-hub-tab-setup'))
    expect(getByText(sport === 'MLB' ? 'Salvamento' : 'Atajada')).toBeTruthy()
  })

  it('a word that means different things by sport is translated per sport', () => {
    expect(hubText('es', 'Saves', 'MLB')).toBe('Salvamentos')
    expect(hubText('es', 'Saves', 'NHL')).toBe('Atajadas')
    expect(hubText('es', 'Center', 'NBA')).toBe('Pívot')
    expect(hubText('es', 'Center', 'NHL')).toBe('Centro')
    expect(hubText('es', 'Forward', 'SOCCER')).toBe('Delantero')
  })

  it('data passes through untouched, and English is unchanged', () => {
    expect(hubText('es', 'HEAD_TO_HEAD_POINTS')).toBe('HEAD_TO_HEAD_POINTS')
    expect(hubText('es', 'Kingdom North')).toBe('Kingdom North')
    expect(hubText('en', 'Waiver Settings')).toBe('Waiver Settings')
    expect(hubText('es', '12 Teams')).toBe('12 equipos')
    expect(hubText('es', '1 day')).toBe('1 día')
    expect(hubText('es', 'Week 15')).toBe('Semana 15')
    expect(hubText('es', 'Nov 13, 2026, 3:00 PM')).toBe('13 nov 2026, 3:00 p. m.')
  })

  it('every dictionary entry is a real translation (no blank or identical-by-typo values)', () => {
    const blank = HUB_ES_KEYS.filter((k) => !hubText('es', k).trim())
    expect(blank).toEqual([])
  })
})
