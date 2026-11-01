/**
 * Dynasty rules the popup did not yet say (2026-10-29): how the rookie draft order is set, its rounds,
 * whether it starts by itself, and what a confirmed tanking strike costs. Plus each new sport's key
 * stats, and college football's reception line. English and Spanish, nothing raw on screen.
 */
import { describe, expect, it } from 'vitest'
import { translations } from '@/lib/i18n/translations'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { renderChangeLine, renderRuleText } from '@/lib/league-rules-explainer/render'
import { dynastyRulesFromConfig, ruleSnapshotFromLeague, type RulesLeagueRow } from '@/lib/league-rules-explainer/snapshot'
import type { RuleSection, RuleSnapshot } from '@/lib/league-rules-explainer/types'

const t = (lang: 'en' | 'es') => (k: string) => (lang === 'es' ? translations.es[k] ?? translations.en[k] : translations.en[k]) ?? k
const render = (sections: RuleSection[], lang: 'en' | 'es') =>
  sections.flatMap((s) => [renderRuleText(s.title, t(lang), lang), ...s.lines.map((l) => renderRuleText(l.text, t(lang), lang))])
function expectClean(lines: string[], lang: 'en' | 'es') {
  for (const l of lines) {
    expect(l, l).not.toMatch(/leagueRules\.|\{\{|\}\}|[{}"[\]]|undefined|null|NaN|\[object/)
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
  waiverType: 'faab',
  waiverBudget: 100,
  settings: { scoring_mode: 'points' },
}
const dynastyRow: RulesLeagueRow = {
  ...base,
  leagueType: 'dynasty',
  isDynasty: true,
  settings: {
    scoring_mode: 'points',
    integrity_tanking_penalties: { penalty: 'lottery_odds', lotteryOddsCutPct: 50, pickAtStrike: 2 },
    dynasty_rookie_draft_calendar: { autoOpen: true, autoStartDays: 7 },
  },
}
const dynasty = (over: Partial<RuleSnapshot> = {}): RuleSnapshot => ({
  ...ruleSnapshotFromLeague(dynastyRow),
  ...dynastyRulesFromConfig({ rookiePickOrderMethod: 'weighted_lottery', rookieDraftRounds: 4, rookieDraftType: 'linear' }),
  ...over,
})
const dynastySection = (s: RuleSnapshot, lang: 'en' | 'es' = 'en') => render(explainLeagueRules(s).filter((x) => x.id === 'dynasty'), lang)

describe('the dynasty section names the rookie draft and the tanking penalty', () => {
  it('in English', () => {
    const lines = dynastySection(dynasty())
    expectClean(lines, 'en')
    expect(lines).toEqual(
      expect.arrayContaining([
        'The rookie draft order is set by a weighted lottery.',
        'The rookie draft has 4 rounds, in the same order every round.',
        'The rookie draft starts by itself 7 days after it opens.',
        'Tanking: when the commissioner confirms a team lost on purpose, that is a strike. Strike 2 costs the team 50% of its rookie-lottery odds; strikes before that are warnings.',
      ]),
    )
  })

  it('explains that an auction uses the weighted result for nominations, not player selection', () => {
    const lines = dynastySection(dynasty({ rookieDraftType: 'auction' }))
    expect(lines).toContain('A weighted lottery sets the rookie auction nomination order; winning bids award players.')
    expect(lines).toContain('The rookie auction has 4 roster slots per team.')
    expect(dynastySection(dynasty({ rookieDraftType: 'auction' }), 'es')).toContain('La subasta de novatos tiene 4 puestos por equipo.')
  })

  it('in Spanish', () => {
    const lines = dynastySection(dynasty(), 'es')
    expectClean(lines, 'es')
    expect(lines).toContain('El draft de novatos empieza solo 7 días después de abrirse.')
  })

  it('penalties off, a first-strike pick penalty, and a draft the commissioner starts read plainly', () => {
    const off = dynastySection(dynasty({ tankingPenalty: { enabled: false, penalty: 'forfeit_pick', atStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 }, rookieDraftAutoStartDays: null }))
    expect(off).toContain('This league has no tanking penalties.')
    expect(off.join(' ')).not.toContain('starts by itself')
    const first = dynastySection(dynasty({ tankingPenalty: { enabled: true, penalty: 'forfeit_pick', atStrike: 1, pickRound: 2, lotteryOddsCutPct: 50, faabPercent: 25 } }))
    expect(first).toContain('Tanking: when the commissioner confirms a team lost on purpose, the team loses its round 2 draft pick.')
  })

  it('a league with no dynasty config reads the settings page defaults', () => {
    expect(dynastyRulesFromConfig(null)).toEqual({ rookieDraftOrder: 'max_pf', rookieDraftRounds: 4, rookieDraftType: 'linear', pickTradeYears: 3 })
  })
})

describe('changes to them get a "What changed" line', () => {
  it('the tanking penalty and the rookie draft start', () => {
    const en = t('en')
    const pen = explainRuleChange({
      key: 'tankingPenalty',
      before: { enabled: true, penalty: 'forfeit_pick', atStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 },
      after: { enabled: true, penalty: 'faab', atStrike: 2, pickRound: 1, lotteryOddsCutPct: 50, faabPercent: 25 },
    })!
    expect(renderChangeLine(pen, en, 'en')).toBe(
      'Tanking penalty: Strike 2: its round 1 draft pick → Strike 2: 25% of its FAAB budget — Tanking: when the commissioner confirms a team lost on purpose, that is a strike. Strike 2 costs the team 25% of its FAAB budget; strikes before that are warnings.',
    )
    const start = explainRuleChange({ key: 'rookieDraftAutoStartDays', before: null, after: 7 })!
    expect(renderChangeLine(start, en, 'en')).toBe('Rookie draft start: When the commissioner starts it → 7 days after it opens — The rookie draft starts by itself 7 days after it opens.')
    expect(renderChangeLine(explainRuleChange({ key: 'rookieDraftRounds', before: 4, after: 5 })!, en, 'en')).toBe('Rookie draft rounds: 4 rounds → 5 rounds')
  })
})

describe('each new sport names its own key stats', () => {
  it.each([
    ['MLB', { home_run: 4, rbi: 1, win: 5 }, ['home run 4 pts', 'RBI 1 pts']],
    ['SOCCER', { goal: 6, clean_sheet: 4 }, ['goal 6 pts', 'clean sheet 4 pts']],
    ['NCAAB', { points: 1, rebounds: 1.2 }, ['point scored 1 pts', 'rebound 1.2 pts']],
  ])('%s', (sport, values, expected) => {
    const lines = render(explainLeagueRules({ ...ruleSnapshotFromLeague({ ...base, sport }), scoringValues: values }), 'en')
    expectClean(lines, 'en')
    const key = lines.find((l) => l.startsWith('Key values'))!
    for (const e of expected) expect(key).toContain(e)
    expect(key).not.toContain('goalie win')
  })

  it('college football gets the reception line, like the NFL', () => {
    expect(render(explainLeagueRules(ruleSnapshotFromLeague({ ...base, sport: 'NCAAF' })), 'en')).toContain('Full PPR: every catch is worth 1 point.')
  })
})
