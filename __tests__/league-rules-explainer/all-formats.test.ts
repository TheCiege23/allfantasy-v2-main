/**
 * The rules explainer beyond redraft and guillotine (widened 2026-10-28): keeper, dynasty / devy / C2C,
 * best ball, the specialty games, every hosted sport, and imported leagues — in both languages, with
 * nothing raw on screen and nothing stated that the league does not run.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import {
  importedRuleSnapshot,
  isImportedRulesLeague,
  resolveRulesConcept,
  resolveRulesFormat,
  ruleSnapshotFromLeague,
  type RulesLeagueRow,
} from '@/lib/league-rules-explainer/snapshot'
import { RULES_CONCEPTS, RULES_EXPLAINER_SPORTS, type RuleSection, type RuleSnapshot } from '@/lib/league-rules-explainer/types'

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k

function render(sections: RuleSection[], lang: 'en' | 'es'): string[] {
  return sections.flatMap((s) => [renderRuleText(s.title, t(lang), lang), ...s.lines.map((l) => renderRuleText(l.text, t(lang), lang))])
}

function expectClean(lines: string[], lang: 'en' | 'es') {
  for (const l of lines) {
    expect(l, l).not.toMatch(/leagueRules\./)
    expect(l, l).not.toMatch(/\{\{|\}\}/)
    expect(l, l).not.toMatch(/[{}"[\]]/)
    expect(l, l).not.toMatch(/undefined|null|NaN|\[object/)
    if (lang === 'es') expect(l.toLowerCase(), l).not.toContain('waiver')
  }
}

const base: RulesLeagueRow = {
  platform: 'allfantasy',
  sport: 'NFL',
  leagueType: 'redraft',
  leagueSize: 12,
  scoring: 'ppr',
  playoffTeams: 6,
  playoffStartWeek: 15,
  tradeDeadlineWeek: 11,
  tradeReviewHours: 24,
  waiverType: 'faab',
  waiverBudget: 100,
  settings: { scoring_mode: 'points', trade_review_mode: 'commissioner' },
}

const dynasty: RulesLeagueRow = {
  ...base,
  leagueType: 'dynasty',
  isDynasty: true,
  draftPickTrading: true,
  settings: {
    ...(base.settings as object),
    pick_trade_deadline: { mode: 'week', week: 16 },
    pick_terms_rule: { enabled: true },
    taxi_stealing: { enabled: true, protectHours: 48, claimsPerSeason: 2 },
    taxi_max_years: 3,
  },
}

/** The read path adds the dynasty config's taxi squad (lib/taxi/TaxiSettingsService.ts). */
const withTaxi = (row: RulesLeagueRow, taxi: Partial<RuleSnapshot> = { taxiSlots: 4, taxiEligibilityYears: 1, taxiDeadlineWeek: 8 }): RuleSnapshot => ({ ...ruleSnapshotFromLeague(row), ...taxi })

const keeper: RulesLeagueRow = { ...base, leagueType: 'keeper', keeperCount: 2, keeperCostSystem: 'inflation', keeperMaxYears: 3, draftPickTrading: false }

const has = (lines: string[], s: string) => expect(lines, `missing: ${s}\n${lines.join('\n')}`).toContain(s)

describe('formats', () => {
  it('names each format, most specific first', () => {
    expect(resolveRulesFormat(base)).toBe('redraft')
    expect(resolveRulesFormat(keeper)).toBe('keeper')
    expect(resolveRulesFormat(dynasty)).toBe('dynasty')
    expect(resolveRulesFormat({ ...base, leagueVariant: 'devy_dynasty' })).toBe('dynasty')
    expect(resolveRulesFormat({ ...base, leagueVariant: 'merged_devy_c2c' })).toBe('dynasty')
    expect(resolveRulesFormat({ ...base, bestBallMode: true })).toBe('best_ball')
    expect(resolveRulesFormat({ ...base, leagueVariant: 'big_brother' })).toBe('specialty')
    expect(resolveRulesFormat({ ...base, survivorMode: true })).toBe('specialty')
    // IDP is a scoring modifier on whatever format it sits on.
    expect(resolveRulesFormat({ ...base, leagueVariant: 'idp' })).toBe('redraft')
    expect(resolveRulesFormat({ ...base, leagueVariant: 'dynasty_idp' })).toBe('dynasty')
    expect(resolveRulesConcept({ ...base, leagueVariant: 'merged_devy_c2c' })).toBe('c2c')
    expect(resolveRulesConcept({ ...base, leagueVariant: 'devy_dynasty' })).toBe('devy')
    expect(resolveRulesConcept({ ...base, leagueVariant: 'survivor_guillotine', guillotineMode: true })).toBe('survivor_guillotine')
    expect(resolveRulesConcept(base)).toBeNull()
  })
})

describe('a dynasty league', () => {
  const sections = explainLeagueRules(withTaxi(dynasty))
  const en = render(sections, 'en')

  it('explains carryover, the taxi squad, taxi stealing and the pick rules', () => {
    expect(sections.map((s) => s.id)).toEqual(['overview', 'scoring', 'lineups', 'dynasty', 'playoffs', 'trades', 'waivers'])
    has(en, 'Dynasty: your whole roster carries over from season to season, and each offseason adds a rookie draft.')
    has(en, 'The taxi squad holds up to 4 young players without using a roster spot. Taxi players cannot start.')
    has(en, 'Only rookies can go on the taxi squad.')
    has(en, 'A player can spend up to 3 seasons on the taxi squad.')
    has(en, 'Moves onto the taxi squad close after week 8.')
    has(en, 'Other teams can claim your taxi players. You have 48 hours to protect a player by promoting him, and each team gets 2 claims a season.')
    has(en, 'Future draft picks can be traded.')
    has(en, 'Trades of only draft picks close after week 16. A trade with any player in it follows the trade deadline.')
    has(en, 'A traded pick can carry terms, like top-3 protection or a condition on another team.')
    expectClean(en, 'en')
    expectClean(render(sections, 'es'), 'es')
  })

  it('says there is no taxi squad and nothing more about it', () => {
    const none = render(explainLeagueRules(withTaxi(dynasty, { taxiSlots: 0, taxiEligibilityYears: 2 })), 'en')
    has(none, 'This league has no taxi squad.')
    expect(none.some((l) => l.includes('claim your taxi players') || l.includes('can go on the taxi squad'))).toBe(false)
  })

  it('says picks cannot be traded and drops the pick deadline and terms', () => {
    const off = render(explainLeagueRules(withTaxi({ ...dynasty, draftPickTrading: false })), 'en')
    has(off, 'Draft picks cannot be traded.')
    expect(off.some((l) => l.includes('only draft picks') || l.includes('carry terms'))).toBe(false)
  })

  it('names Devy and C2C instead of plain dynasty', () => {
    const devy = render(explainLeagueRules(withTaxi({ ...dynasty, leagueVariant: 'devy_dynasty' })), 'en')
    has(devy, 'Devy dynasty: a dynasty league where you can also roster college players before they turn pro.')
    const c2c = render(explainLeagueRules(withTaxi({ ...dynasty, leagueVariant: 'merged_devy_c2c' })), 'es')
    has(c2c, translations.es['leagueRules.overview.concept.c2c']!)
  })
})

describe('a keeper league', () => {
  it('explains how many, what they cost and for how long, and that picks do not trade', () => {
    const sections = explainLeagueRules(ruleSnapshotFromLeague(keeper))
    const en = render(sections, 'en')
    expect(sections.map((s) => s.id)).toEqual(['overview', 'scoring', 'lineups', 'keeper', 'playoffs', 'trades', 'waivers'])
    has(en, 'Each team can keep up to 2 players into next season.')
    has(en, 'A kept player costs an earlier pick each year you keep him.')
    has(en, 'A player can be kept for up to 3 seasons in a row.')
    has(en, 'Draft picks cannot be traded.')
    expectClean(en, 'en')
    expectClean(render(sections, 'es'), 'es')
  })
})

describe('formats with their own game', () => {
  it('best ball sets no lineups, and states no trades or waivers it may not run', () => {
    const sections = explainLeagueRules(ruleSnapshotFromLeague({ ...base, sport: 'NBA', bestBallMode: true }))
    expect(sections.map((s) => s.id)).toEqual(['overview', 'scoring'])
    has(render(sections, 'en'), 'Best ball: there are no lineups to set. Your best possible lineup is scored for you every week.')
  })

  it('a specialty game gets the basics, scoring and roster only', () => {
    for (const variant of ['survivor', 'big_brother', 'zombie', 'tournament', 'salary_cap']) {
      const sections = explainLeagueRules(ruleSnapshotFromLeague({ ...base, leagueVariant: variant }))
      expect(sections.map((s) => s.id), variant).toEqual(['overview', 'scoring'])
      expect(render(sections, 'en'), variant).toContain(translations.en[`leagueRules.overview.concept.${variant}`])
    }
  })
})

describe('every sport and concept reads cleanly in both languages', () => {
  const rows: RulesLeagueRow[] = []
  for (const sport of RULES_EXPLAINER_SPORTS) for (const row of [base, keeper, dynasty, { ...base, bestBallMode: true }]) rows.push({ ...row, sport })
  for (const concept of RULES_CONCEPTS) rows.push({ ...base, leagueVariant: concept === 'c2c' ? 'merged_devy_c2c' : concept === 'devy' ? 'devy_dynasty' : concept })

  it.each(['en', 'es'] as const)('%s', (lang) => {
    for (const row of rows) {
      const snap = resolveRulesFormat(row) === 'dynasty' ? withTaxi(row) : ruleSnapshotFromLeague(row)
      const lines = render(explainLeagueRules(snap, { isCommissioner: true }), lang)
      expect(lines.length).toBeGreaterThan(0)
      expectClean(lines, lang)
    }
  })

  it('every concept has its own overview sentence in both languages', () => {
    for (const c of RULES_CONCEPTS) {
      expect(translations.en[`leagueRules.overview.concept.${c}`], c).toBeTruthy()
      expect(translations.es[`leagueRules.overview.concept.${c}`], c).toBeTruthy()
    }
  })

  it('daily lineups are explained for MLB too', () => {
    const mlb = ruleSnapshotFromLeague({ ...base, sport: 'MLB', settings: { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } })
    expect(mlb.lineupMode).toBe('daily')
  })
})

describe('imported leagues', () => {
  const sleeper: RulesLeagueRow = {
    platform: 'sleeper',
    sport: 'NFL',
    leagueType: 'redraft',
    leagueSize: 10,
    scoring: 'half_ppr',
    // Schema defaults an import never writes: none of these may be stated.
    waiverType: 'faab',
    waiverBudget: 100,
    tradeReviewHours: 48,
    playoffTeams: 4,
    tradeDeadlineWeek: 11,
    settings: { roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'BN', 'BN', 'IR'], playoff_teams: 6, playoff_week_start: 15 },
  }

  it('states the platform, scoring, roster and playoff field, and nothing the import does not carry', () => {
    expect(isImportedRulesLeague(sleeper)).toBe(true)
    const snap = importedRuleSnapshot(sleeper)
    expect(snap).toMatchObject({ importedFrom: 'sleeper', playoffTeams: 6, playoffStartWeek: 15, rosterSlots: { QB: 1, RB: 2, WR: 2, FLEX: 1, BN: 2, IR: 1 } })
    expect(snap.waiverBudget).toBeUndefined()
    expect(snap.tradeDeadlineWeek).toBeUndefined()
    const sections = explainLeagueRules(snap, { isCommissioner: true })
    expect(sections.map((s) => s.id)).toEqual(['overview', 'scoring', 'roster', 'playoffs'])
    const en = render(sections, 'en')
    has(en, 'This league runs on Sleeper. These are the rules it brought with it; the commissioner changes rules there.')
    expect(en.some((l) => l.includes('You are the commissioner'))).toBe(false)
    expectClean(en, 'en')
    expectClean(render(sections, 'es'), 'es')
  })

  it('leaves out playoffs when the import names no playoff field, rather than saying there are none', () => {
    const sections = explainLeagueRules(importedRuleSnapshot({ ...sleeper, settings: {} }))
    expect(sections.map((s) => s.id)).not.toContain('playoffs')
  })

  it('a platform we do not name reads generically', () => {
    has(render(explainLeagueRules(importedRuleSnapshot({ ...sleeper, platform: 'newco' })), 'en'), translations.en['leagueRules.overview.importedGeneric']!)
  })
})

describe('changes to the new rules', () => {
  const line = (key: string, before: unknown, after: unknown, lang: 'en' | 'es' = 'en') => {
    const c = explainRuleChange({ key, before, after })
    return c ? renderChangeLine(c, t(lang), lang) : null
  }

  it('explains each, with what it means', () => {
    expect(line('keeperCount', 2, 3)).toBe('Keepers per team: 2 players → 3 players — each team can keep one more player.')
    expect(line('pickTradeDeadline', 'same', 16)).toBe('Pick trade deadline: With the trade deadline → After week 16 — Trades of only draft picks close after week 16. A trade with any player in it follows the trade deadline.')
    expect(line('taxiStealing', null, { hours: 24, claims: 0 })).toBe('Taxi stealing: Off → On, 24 hours to protect — Other teams can claim your taxi players. You have 24 hours to protect a player by promoting him, and claims are unlimited.')
    expect(line('taxiStealing', { hours: 24, claims: 1 }, null)).toBe('Taxi stealing: On, 24 hours to protect → Off — taxi players are safe; no one can claim them.')
    expect(line('pickTerms', false, true)).toContain('A traded pick can carry terms')
    expect(line('taxiMaxYears', 2, null)).toBe('Seasons on the taxi squad: 2 seasons → No limit')
    for (const l of [line('keeperCount', 2, 1, 'es'), line('pickTradeDeadline', 'open', 'same', 'es'), line('taxiStealing', null, { hours: 48, claims: 3 }, 'es')]) {
      expect(l).toBeTruthy()
      expect(l!.toLowerCase()).not.toContain('waiver')
      expect(l).not.toMatch(/leagueRules\.|\{\{/)
    }
  })

  it('a save that changes them produces the change, from the league row before and after', () => {
    const before = ruleSnapshotFromLeague(dynasty)
    const after = ruleSnapshotFromLeague({ ...dynasty, settings: { ...(dynasty.settings as object), pick_trade_deadline: { mode: 'open' }, taxi_stealing: { enabled: false } } })
    expect(diffRuleSnapshots(before, after)).toEqual([
      { key: 'pickTradeDeadline', before: 16, after: 'open' },
      { key: 'taxiStealing', before: { hours: 48, claims: 2 }, after: null },
    ])
    const kBefore = ruleSnapshotFromLeague(keeper)
    expect(diffRuleSnapshots(kBefore, ruleSnapshotFromLeague({ ...keeper, keeperCount: 4 }))).toEqual([{ key: 'keeperCount', before: 2, after: 4 }])
  })

  it('a garbled stored value is dropped, never shown', () => {
    expect(explainRuleChange({ key: 'taxiStealing', before: null, after: { hours: 'soon' } })).toBeNull()
    expect(explainRuleChange({ key: 'keeperCost', before: 'free', after: 'barter' })).toBeNull()
    expect(explainRuleChange({ key: 'pickTradeDeadline', before: 'same', after: 'whenever' })).toBeNull()
  })
})
