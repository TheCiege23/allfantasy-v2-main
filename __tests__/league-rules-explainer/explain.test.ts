/**
 * The league rules explainer (lib/league-rules-explainer): hand-written, deterministic lines for
 * NFL / NBA / NHL redraft and guillotine leagues, in English and Spanish, built with the app's own
 * translations. Unknown keys and values are omitted — never shown raw.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { leagueRulesCopyEn, leagueRulesCopyEs } from '@/lib/i18n/league-rules-copy'
import {
  CHANGE_GROUP_WINDOW_MS,
  explainLeagueRules,
  explainRuleChange,
  groupSettingsChanges,
} from '@/lib/league-rules-explainer/explain'
import { CHANGEABLE_RULE_KEYS, diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import {
  guillotineAdvancedSnapshot,
  guillotineRulesSnapshot,
  isRulesExplainerLeague,
  normalizeRosterSlots,
  resolveRulesFormat,
  ruleSnapshotFromLeague,
  type RulesLeagueRow,
} from '@/lib/league-rules-explainer/snapshot'
import type { RuleSection, RuleSnapshot, SettingsChangeEvent } from '@/lib/league-rules-explainer/types'

const tEn = (k: string) => translations.en[k] ?? k
const tEs = (k: string) => translations.es[k] ?? translations.en[k] ?? k

function render(sections: RuleSection[], lang: 'en' | 'es'): string[] {
  const t = lang === 'es' ? tEs : tEn
  return sections.flatMap((s) => [renderRuleText(s.title, t, lang), ...s.lines.map((l) => renderRuleText(l.text, t, lang))])
}

function expectClean(lines: string[]) {
  for (const l of lines) {
    expect(l, l).not.toMatch(/leagueRules\./) // a missing translation renders as its key
    expect(l, l).not.toMatch(/\{\{|\}\}/) // an unfilled placeholder
    expect(l, l).not.toMatch(/[{}"[\]]/) // never JSON
    expect(l, l).not.toMatch(/undefined|null|NaN|\[object/)
  }
}

const NFL_REDRAFT: RulesLeagueRow = {
  platform: 'allfantasy',
  sport: 'NFL',
  leagueType: 'redraft',
  leagueSize: 12,
  scoring: 'ppr',
  medianGame: true,
  playoffTeams: 6,
  playoffStartWeek: 15,
  playoffWeeksPerRound: 1,
  tradeDeadlineWeek: 12,
  tradeReviewHours: 24,
  waiverType: 'faab',
  waiverBudget: 100,
  waiverMinBid: 1,
  waiverHours: 48,
  settings: { scoring_mode: 'points', trade_review_mode: 'commissioner' },
}

const NBA_REDRAFT: RulesLeagueRow = {
  platform: 'allfantasy',
  sport: 'NBA',
  leagueType: 'redraft',
  leagueSize: 10,
  playoffTeams: 4,
  playoffStartWeek: 21,
  tradeDeadlineWeek: 18,
  waiverType: 'rolling',
  settings: {
    scoring_mode: 'points',
    playoff_series: { mode: 'series', lengths: [3, 5] },
    sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true },
    af_daily_waiver_schedule: {
      version: 1,
      enabled: true,
      processHour: 3,
      days: { mon: 'free_agents', tue: 'free_agents', wed: 'waivers_then_fa', thu: 'free_agents', fri: 'free_agents', sat: 'faab', sun: 'locked' },
    },
  },
}

const NHL_CATEGORIES: RulesLeagueRow = {
  platform: 'allfantasy',
  sport: 'NHL',
  leagueType: 'redraft',
  leagueSize: 8,
  playoffTeams: 4,
  playoffStartWeek: 22,
  waiverType: 'reverse_standings',
  settings: { scoring_mode: 'h2h_category', category_record_mode: 'most', trade_review_mode: 'league_vote' },
}

const guillotineRow = (sport: string): RulesLeagueRow => ({
  platform: 'allfantasy',
  sport,
  leagueType: 'guillotine',
  leagueVariant: 'guillotine',
  guillotineMode: true,
  leagueSize: 14,
  waiverType: 'faab',
  waiverBudget: 1000,
  tradeDeadlineWeek: null,
  settings: {
    guillotineEndgame: 'final_three',
    guillotineFaabOnChop: 'split',
    guillotine_advanced: { steps: [{ fromWeek: 10, chops: 2 }], overrides: { 12: 0 }, immunity: 'top_scorer' },
  },
})

function withGuillotineConfig(row: RulesLeagueRow): RuleSnapshot {
  return {
    ...ruleSnapshotFromLeague(row),
    ...guillotineRulesSnapshot(
      { teamsPerChop: 1, eliminationEndWeek: 16, tiebreakerOrder: ['season_points', 'random'], statCorrectionHours: 48, dangerMarginPoints: 10, rosterReleaseTiming: 'next_waiver_run' },
      2,
    ),
    endgame: 'final_three',
    faabOnChop: 'split',
  }
}

describe('scope', () => {
  it('covers native redraft, guillotine and dynasty leagues in every sport AF hosts', () => {
    expect(isRulesExplainerLeague(NFL_REDRAFT)).toBe(true)
    expect(isRulesExplainerLeague(NBA_REDRAFT)).toBe(true)
    expect(isRulesExplainerLeague(guillotineRow('NHL'))).toBe(true)
    for (const sport of ['MLB', 'NCAAF', 'NCAAB', 'SOCCER']) expect(isRulesExplainerLeague({ ...NFL_REDRAFT, sport })).toBe(true)
    expect(isRulesExplainerLeague({ ...NFL_REDRAFT, sport: 'CRICKET' })).toBe(false)
    expect(isRulesExplainerLeague({ ...NFL_REDRAFT, platform: 'sleeper' })).toBe(false)
    expect(resolveRulesFormat({ ...NFL_REDRAFT, leagueType: 'dynasty' })).toBe('dynasty')
    expect(resolveRulesFormat({ ...NFL_REDRAFT, leagueType: 'redraft', isDynasty: true })).toBe('dynasty')
    expect(resolveRulesFormat({ ...NFL_REDRAFT, leagueType: 'devy' })).toBe('dynasty')
    expect(isRulesExplainerLeague({ ...NFL_REDRAFT, leagueVariant: 'survivor' })).toBe(false)
    expect(isRulesExplainerLeague({ ...NFL_REDRAFT, bestBallMode: true })).toBe(false)
    expect(resolveRulesFormat({ leagueType: 'redraft', leagueVariant: 'survivor_guillotine', guillotineMode: true })).toBeNull()
  })
})

describe('full rules — NFL redraft', () => {
  const snapshot: RuleSnapshot = {
    ...ruleSnapshotFromLeague(NFL_REDRAFT),
    rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX_WR_RB: 1, K: 1, DEF: 1, BN: 6, IR: 1 },
    scoringValues: { passing_td: 4, interception: -2, rushing_td: 6, receptions: 1, receiving_td: 6 },
  }
  const sections = explainLeagueRules(snapshot)

  it('English', () => {
    const lines = render(sections, 'en')
    expectClean(lines)
    expect(lines).toContain('12 teams compete in this league.')
    expect(lines).toContain('Full PPR: every catch is worth 1 point.')
    expect(lines).toContain('Key values: passing TD 4 pts, interception thrown -2 pts, rushing TD 6 pts, reception 1 pts, and receiving TD 6 pts.')
    expect(lines).toContain('Starting lineup: QB, 2 RB, 2 WR, TE, FLEX (WR/RB), K, and DEF.')
    expect(lines).toContain('6 bench spots.')
    expect(lines).toContain('The top 6 teams make the playoffs, which start in week 15.')
    expect(lines).toContain('The top 2 seeds skip the first round with a bye.')
    expect(lines).toContain('Trades are allowed through week 12. After that, the trade deadline has passed.')
    expect(lines).toContain('The commissioner reviews every trade before it goes through.')
    expect(lines).toContain('The review period lasts 24 hours.')
    expect(lines).toContain('Waiver claims are won by blind bids. Every team gets a $100 budget for the season (FAAB), and the highest bid wins.')
    expect(lines).toContain('The minimum bid is $1.')
    expect(lines).toContain('A dropped player stays on waivers for 48 hours before anyone can add him freely.')
    expect(lines.some((l) => l.includes('median'))).toBe(true)
    // NFL has no daily/weekly switch: no lineups section, no series.
    expect(sections.map((s) => s.id)).not.toContain('lineups')
    expect(sections.map((s) => s.id)).not.toContain('guillotine')
  })

  it('Spanish', () => {
    const lines = render(sections, 'es')
    expectClean(lines)
    expect(lines).toContain('En esta liga compiten 12 equipos.')
    expect(lines).toContain('PPR completo: cada recepción vale 1 punto.')
    expect(lines).toContain('Los reclamos se ganan con ofertas ciegas. Cada equipo tiene un presupuesto de $100 para la temporada (FAAB) y gana la oferta más alta.')
    expect(lines).toContain('Un jugador liberado queda en reclamos durante 48 horas antes de que cualquiera pueda ficharlo libremente.')
    expect(lines.join(' ')).not.toMatch(/waiver/i)
  })

  it('half PPR and standard come from the stored reception value, not a label', () => {
    const half = render(explainLeagueRules({ ...snapshot, scoringValues: { ...snapshot.scoringValues, receptions: 0.5 } }), 'es')
    expect(half).toContain('Medio PPR: cada recepción vale 0,5 puntos.')
    const std = render(explainLeagueRules({ ...snapshot, scoringValues: { passing_td: 4 } , scoringPreset: 'standard' }), 'en')
    expect(std).toContain('Standard scoring: a catch is not worth points by itself.')
  })
})

describe('full rules — NBA redraft (daily lineups, series, daily claim schedule)', () => {
  const sections = explainLeagueRules({
    ...ruleSnapshotFromLeague(NBA_REDRAFT),
    scoringValues: { points: 1, rebounds: 1.2, assists: 1.5 },
  })

  it('English', () => {
    const lines = render(sections, 'en')
    expectClean(lines)
    expect(lines).toContain('Daily lineups: you can change your starters every day, until each player’s game starts.')
    expect(lines).toContain('Playoff rounds are series: round 1 best of 3 and round 2 best of 5.')
    expect(lines).toContain('Waiver claims use a rolling order: a team that wins a claim moves to the back of the line.')
    expect(lines).toContain('Waiver claims are processed on Wednesday and Saturday at 3:00, league time.')
    expect(lines).toContain('Key values: point scored 1 pts, rebound 1.2 pts, and assist 1.5 pts.')
  })

  it('Spanish', () => {
    const lines = render(sections, 'es')
    expectClean(lines)
    expect(lines).toContain('Las rondas de playoffs son series: ronda 1 al mejor de 3 y ronda 2 al mejor de 5.')
    expect(lines).toContain('Los reclamos se procesan los miércoles y sábados a las 3:00, hora de la liga.')
    expect(lines).toContain('Valores clave: punto anotado 1 pts, rebote 1,2 pts y asistencia 1,5 pts.')
    expect(lines.join(' ')).not.toMatch(/waiver/i)
  })

  it('weekly NBA lineups say so', () => {
    const weekly = explainLeagueRules(ruleSnapshotFromLeague({ ...NBA_REDRAFT, settings: { scoring_mode: 'points' } }))
    expect(render(weekly, 'en')).toContain('Weekly lineups: your lineup locks for the whole scoring week.')
  })
})

describe('full rules — NHL categories redraft', () => {
  const sections = explainLeagueRules({ ...ruleSnapshotFromLeague(NHL_CATEGORIES), categories: ['G', 'A', 'SOG', 'SV%'] })
  it('English and Spanish', () => {
    const en = render(sections, 'en')
    expectClean(en)
    expect(en).toContain('Head-to-head categories: each week the team that wins more categories wins the matchup.')
    expect(en).toContain('4 categories count: G, A, SOG, SV%.')
    expect(en).toContain('League members can vote to veto a trade before it goes through.')
    expect(en).toContain('Waiver claims follow reverse standings: the team lowest in the standings claims first.')
    const es = render(sections, 'es')
    expectClean(es)
    expect(es).toContain('Cuentan 4 categorías: G, A, SOG, SV%.')
    expect(es).toContain('Los reclamos siguen la clasificación inversa: reclama primero el equipo más bajo de la clasificación.')
  })
})

describe.each(['NFL', 'NBA', 'NHL'])('full rules — %s guillotine', (sport) => {
  const snapshot = withGuillotineConfig(guillotineRow(sport))
  const sections = explainLeagueRules(snapshot)

  it('has the chop rules and no playoffs', () => {
    const ids = sections.map((s) => s.id)
    expect(ids).toContain('guillotine')
    expect(ids).not.toContain('playoffs')
    const en = render(sections, 'en')
    expectClean(en)
    expect(en).toContain('The lowest-scoring team is chopped every week from week 2 through week 16.')
    expect(en).toContain('The chop grows later in the season: from week 10, 2 a week.')
    expect(en).toContain('Special weeks: week 12: no chop.')
    expect(en).toContain('Last week’s top scorer cannot be chopped the following week.')
    expect(en).toContain('When 3 teams remain, the chops stop and the best total over the next three weeks wins.')
    expect(en).toContain('If the lowest scores tie, the first tiebreaker is: fewer season points is chopped.')
    expect(en).toContain('A chop is final 48 hours after the week ends, so stat corrections can count.')
    expect(en).toContain('A chopped team’s unspent FAAB is shared evenly by every team still alive.')
    expect(en).toContain('A chopped team’s players are released at the next waiver run, so every team can bid on them at the same time.')
    expect(en).toContain('There is no trade deadline.')
  })

  it('Spanish never says waiver', () => {
    const es = render(sections, 'es')
    expectClean(es)
    expect(es).toContain('Cada semana se elimina al equipo con menos puntos, desde la semana 2 hasta la semana 16.')
    expect(es).toContain('Los jugadores de un equipo eliminado pasan a reclamos en el siguiente procesamiento, así que todos pueden pujar por ellos a la vez.')
    expect(es.join(' ')).not.toMatch(/waiver/i)
  })

  it('NBA/NHL guillotine leagues still explain their lineup mode; NFL has none', () => {
    const ids = sections.map((s) => s.id)
    if (sport === 'NFL') expect(ids).not.toContain('lineups')
    else expect(ids).toContain('lineups')
  })
})

describe('the commissioner preview', () => {
  it('frames the popup as what members will see', () => {
    const lines = render(explainLeagueRules(ruleSnapshotFromLeague(NFL_REDRAFT), { isCommissioner: true }), 'en')
    expect(lines[1]).toBe('You are the commissioner. Your members see these rules the first time they open the league.')
    expect(render(explainLeagueRules(ruleSnapshotFromLeague(NFL_REDRAFT)), 'en')).not.toContain(lines[1])
  })
})

describe('unknown keys and values are omitted, never shown raw', () => {
  it('drops a line whose value has no sentence', () => {
    const snapshot = { ...ruleSnapshotFromLeague(NFL_REDRAFT), waiverType: 'mystery_mode', tradeReview: 'jury' } as RuleSnapshot
    const lines = render(explainLeagueRules(snapshot), 'en')
    expectClean(lines)
    expect(lines.join(' ')).not.toMatch(/mystery|jury/)
    expect(lines.some((l) => l.startsWith('Waiver claims'))).toBe(false)
  })

  it('an unknown change key or an unexplainable value yields nothing', () => {
    expect(explainRuleChange({ key: 'rscToken', before: 'a', after: 'b' })).toBeNull()
    expect(explainRuleChange({ key: '__proto__', before: 1, after: 2 })).toBeNull()
    expect(explainRuleChange({ key: 'waiverType', before: 'faab', after: { evil: true } })).toBeNull()
    expect(explainRuleChange({ key: 'endgame', before: 'final_two', after: 'sudden_death' })).toBeNull()
  })

  it('a malformed roster slot never renders', () => {
    const lines = render(explainLeagueRules({ ...ruleSnapshotFromLeague(NFL_REDRAFT), rosterSlots: { QB: 1, '{"x":1}': 2, RB: -1, WR: 1.5 } as Record<string, number> }), 'en')
    expectClean(lines)
    expect(lines).toContain('Starting lineup: QB.')
  })
})

describe('changes', () => {
  it('explains the trade deadline change exactly as the owner specified', () => {
    const line = explainRuleChange({ key: 'tradeDeadlineWeek', before: 12, after: 13 })!
    expect(renderChangeLine(line, tEn, 'en')).toBe('Trade deadline: Week 12 → Week 13 — trades are allowed one week longer.')
    expect(renderChangeLine(line, tEs, 'es')).toBe('Fecha límite de intercambios: Semana 12 → Semana 13 — se puede intercambiar una semana más.')
    const earlier = explainRuleChange({ key: 'tradeDeadlineWeek', before: 13, after: 10 })!
    expect(renderChangeLine(earlier, tEn, 'en')).toBe('Trade deadline: Week 13 → Week 10 — trades close 3 weeks sooner.')
    const removed = explainRuleChange({ key: 'tradeDeadlineWeek', before: 13, after: null })!
    expect(renderChangeLine(removed, tEn, 'en')).toBe('Trade deadline: Week 13 → No deadline — trades are allowed all season.')
  })

  it('Spanish change lines never say waiver', () => {
    const samples = [
      { key: 'waiverType', before: 'rolling', after: 'faab' },
      { key: 'waiverHours', before: 24, after: 48 },
      { key: 'waiverDays', before: null, after: ['wed'] },
      { key: 'waiverProcessHour', before: 2, after: 4 },
      { key: 'releaseTiming', before: 'immediate', after: 'next_waiver_run' },
    ]
    for (const c of samples) {
      const line = explainRuleChange(c)
      expect(line, c.key).not.toBeNull()
      expect(renderChangeLine(line!, tEs, 'es')).not.toMatch(/waiver/i)
    }
  })

  it('every changeable key has a label in both languages', () => {
    for (const key of CHANGEABLE_RULE_KEYS) {
      expect(leagueRulesCopyEn[`leagueRules.label.${key}`], key).toBeTruthy()
      expect(leagueRulesCopyEs[`leagueRules.label.${key}`], key).toBeTruthy()
    }
  })

  it('the Spanish copy has every English key, and none of it says waiver', () => {
    expect(Object.keys(leagueRulesCopyEs).sort()).toEqual(Object.keys(leagueRulesCopyEn).sort())
    for (const [k, v] of Object.entries(leagueRulesCopyEs)) expect(v, k).not.toMatch(/waiver/i)
  })

  it('diffs only rules that changed, from the league row before and after a save', () => {
    const before = ruleSnapshotFromLeague(NFL_REDRAFT)
    const after = ruleSnapshotFromLeague({ ...NFL_REDRAFT, tradeDeadlineWeek: 13, waiverBudget: 200, settings: { ...(NFL_REDRAFT.settings as object) } })
    expect(diffRuleSnapshots(before, after)).toEqual([
      { key: 'tradeDeadlineWeek', before: 12, after: 13 },
      { key: 'waiverBudget', before: 100, after: 200 },
    ])
    expect(diffRuleSnapshots(before, ruleSnapshotFromLeague(NFL_REDRAFT))).toEqual([])
  })

  it('roster slots and guillotine rule pages diff the same way', () => {
    expect(diffRuleSnapshots({ rosterSlots: normalizeRosterSlots({ QB: 1, BN: 0 }) }, { rosterSlots: normalizeRosterSlots({ QB: 1 }) })).toEqual([])
    expect(diffRuleSnapshots(guillotineRulesSnapshot({ teamsPerChop: 1 }), guillotineRulesSnapshot({ teamsPerChop: 2 }))).toEqual([
      { key: 'teamsPerChop', before: 1, after: 2 },
    ])
    const adv = diffRuleSnapshots(
      guillotineAdvancedSnapshot({ steps: [], overrides: {}, immunity: 'off' }),
      guillotineAdvancedSnapshot({ steps: [], overrides: { 9: 0 }, immunity: 'top_scorer' }),
    )
    expect(adv.map((c) => c.key)).toEqual(['chopOverrides', 'chopImmunity'])
    const lines = adv.map((c) => renderChangeLine(explainRuleChange(c)!, tEn, 'en'))
    expect(lines).toEqual([
      'Special chop weeks: None → week 9: no chop',
      'Immunity: Off → Top scorer is safe — Last week’s top scorer cannot be chopped the following week.',
    ])
  })
})

describe('grouping changes into cards', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, 0) + min * 60_000).toISOString()
  const ev = (id: string, min: number, changes: SettingsChangeEvent['changes']): SettingsChangeEvent => ({ id, createdAt: at(min), actorUserId: 'c', changes })

  it('uses a ten-minute window between consecutive saves', () => {
    expect(CHANGE_GROUP_WINDOW_MS).toBe(10 * 60 * 1000)
    const groups = groupSettingsChanges(
      [
        ev('a', 0, [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }]),
        ev('b', 9, [{ key: 'waiverBudget', before: 100, after: 200 }]),
        ev('c', 18, [{ key: 'playoffTeams', before: 6, after: 8 }]),
        ev('d', 29, [{ key: 'teamCount', before: 10, after: 12 }]),
      ],
      { sport: 'NFL' },
    )
    // a-b-c chain (each within 10 minutes of the previous), d stands alone. Newest first.
    expect(groups.map((g) => g.eventIds)).toEqual([['d'], ['a', 'b', 'c']])
    expect(groups[1]!.lastEventId).toBe('c')
  })

  it('a gap just over the window starts a new card', () => {
    const groups = groupSettingsChanges(
      [ev('a', 0, [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }]), ev('b', 10.01, [{ key: 'waiverBudget', before: 100, after: 200 }])],
      { sport: 'NFL' },
    )
    expect(groups).toHaveLength(2)
  })

  it('collapses a key changed twice, and drops a change undone inside the group', () => {
    const [g] = groupSettingsChanges(
      [
        ev('a', 0, [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }, { key: 'waiverBudget', before: 100, after: 150 }]),
        ev('b', 3, [{ key: 'tradeDeadlineWeek', before: 13, after: 14 }, { key: 'waiverBudget', before: 150, after: 100 }]),
      ],
      { sport: 'NFL' },
    )
    expect(g!.lines.map((l) => renderChangeLine(l, tEn, 'en'))).toEqual(['Trade deadline: Week 12 → Week 14 — trades are allowed 2 weeks longer.'])
  })

  it('a group with nothing explainable produces no card', () => {
    expect(groupSettingsChanges([ev('a', 0, [{ key: 'notARule', before: 1, after: 2 }])], { sport: 'NFL' })).toEqual([])
  })
})

describe('every sport and dynasty leagues (2026-10-29)', () => {
  const DYNASTY_NFL: RulesLeagueRow = {
    ...NFL_REDRAFT,
    leagueType: 'dynasty',
    isDynasty: true,
    settings: {
      ...(NFL_REDRAFT.settings as Record<string, unknown>),
      integrity_tanking_penalties: { penalty: 'lottery_odds', lotteryOddsCutPct: 50, pickAtStrike: 2 },
      dynasty_rookie_draft_calendar: { autoOpen: true, autoStartDays: 7 },
    },
  }
  const dynastySnapshot = (): RuleSnapshot => ({
    ...ruleSnapshotFromLeague(DYNASTY_NFL),
    rookieDraftOrder: 'weighted_lottery',
    rookieDraftRounds: 4,
    rookieDraftType: 'linear',
    taxiSlots: 3,
    taxiEligibilityYears: 2,
    futurePicksYearsOut: 3,
  })

  it('a dynasty league explains its rookie draft, taxi squad, future picks and tanking penalty, and keeps its playoffs', () => {
    const sections = explainLeagueRules(dynastySnapshot())
    expect(sections.map((s) => s.id)).toEqual(['overview', 'dynasty', 'scoring', 'playoffs', 'trades', 'waivers'])
    const en = render(sections, 'en')
    expectClean(en)
    expect(en).toEqual(
      expect.arrayContaining([
        'Dynasty: you keep your whole roster from season to season. Each offseason a rookie draft adds the new players.',
        'The rookie draft order is set by a weighted lottery: teams with worse records get better odds at the top picks.',
        'The rookie draft has 4 rounds, in the same order every round.',
        'The rookie draft starts by itself 7 days after it opens.',
        'Each team has 3 taxi squad spots for players in their first two seasons. Players there stay on your team without using roster spots.',
        'Draft picks up to 3 seasons ahead can be traded.',
        'Tanking: when the commissioner confirms a team lost on purpose, that is a strike. Strike 2 costs the team 50% of its rookie-lottery odds; strikes before that are warnings.',
      ]),
    )
    const es = render(sections, 'es')
    expectClean(es)
    for (const l of es) expect(l.toLowerCase()).not.toContain('waiver')
  })

  it('tanking penalties off, a first-strike pick penalty, and no taxi squad read plainly', () => {
    const off = render(explainLeagueRules({ ...dynastySnapshot(), tankingPenalty: { enabled: false, penalty: 'forfeit_pick', atStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 }, taxiSlots: 0 }), 'en')
    expect(off).toEqual(expect.arrayContaining(['This league has no tanking penalties.', 'There is no taxi squad.']))
    const first = render(explainLeagueRules({ ...dynastySnapshot(), tankingPenalty: { enabled: true, penalty: 'forfeit_pick', atStrike: 1, pickRound: 2, lotteryOddsCutPct: 50, faabPercent: 25 } }), 'en')
    expect(first).toContain('Tanking: when the commissioner confirms a team lost on purpose, the team loses its round 2 draft pick.')
  })

  it('a dynasty change is explained like any other', () => {
    const line = explainRuleChange({ key: 'tankingPenalty', before: { enabled: true, penalty: 'forfeit_pick', atStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 }, after: { enabled: true, penalty: 'faab', atStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 } })!
    expect(renderChangeLine(line, tEn, 'en')).toBe(
      'Tanking penalty: Strike 2: its round 1 draft pick → Strike 2: 25% of its FAAB budget — Tanking: when the commissioner confirms a team lost on purpose, that is a strike. Strike 2 costs the team 25% of its FAAB budget; strikes before that are warnings.',
    )
    const start = explainRuleChange({ key: 'rookieDraftAutoStartDays', before: null, after: 7 })!
    expect(renderChangeLine(start, tEn, 'en')).toBe('Rookie draft start: When the commissioner starts it → 7 days after it opens — The rookie draft starts by itself 7 days after it opens.')
  })

  it.each([
    ['MLB', { home_run: 4, rbi: 1, win: 5 }, 'Key values: home run 4 pts, RBI 1 pts.'],
    ['SOCCER', { goal: 6, clean_sheet: 4 }, 'Key values: goal 6 pts and clean sheet 4 pts.'],
  ])('%s scoring names its own key stats (and MLB never calls a pitcher win a goalie win)', (sport, values, _expected) => {
    const lines = render(explainLeagueRules({ ...ruleSnapshotFromLeague({ ...NFL_REDRAFT, sport }), scoringValues: values }), 'en')
    expectClean(lines)
    const keyLine = lines.find((l) => l.startsWith('Key values'))!
    expect(keyLine).toBeTruthy()
    expect(keyLine).not.toContain('goalie win')
    expect(lines.join(' ')).not.toMatch(/catch/i)
  })

  it('a college football league gets the reception line, like the NFL', () => {
    expect(render(explainLeagueRules(ruleSnapshotFromLeague({ ...NFL_REDRAFT, sport: 'NCAAF' })), 'en')).toContain('Full PPR: every catch is worth 1 point.')
  })
})
