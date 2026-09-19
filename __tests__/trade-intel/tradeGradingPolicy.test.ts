import {
  historicalEvidenceIsAsOfTrade,
  resolveTradeGradingPolicy,
  TRADE_GRADE_DIMENSION_FRAMEWORK,
} from '@/lib/trade-intel/tradeGradingPolicy'
import { assessTradeGradeReadiness } from '@/lib/decision-os/trade/tradeGradeReadiness'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { CROWN_BONUS, CROWN_PENALTY_PLAYERS } from '@/lib/trade-intel/kingOfTheHill'
import { PROTECTION_SLOTS, tradeLockNote } from '@/lib/trade-intel/pirate'

describe('trade grading policy', () => {
  test('every receipt declares ten primary and twenty secondary dimensions', () => {
    expect(TRADE_GRADE_DIMENSION_FRAMEWORK.primary).toHaveLength(10)
    expect(TRADE_GRADE_DIMENSION_FRAMEWORK.secondary).toHaveLength(20)
    const ids = [
      ...TRADE_GRADE_DIMENSION_FRAMEWORK.primary.map((d) => d.id),
      ...TRADE_GRADE_DIMENSION_FRAMEWORK.secondary.map((d) => d.id),
    ]
    expect(new Set(ids).size).toBe(30)
  })

  test('contract dynasty variant overrides its generic dynasty lifecycle label', () => {
    const rules = readFormatRules({ leagueType: 'dynasty', leagueVariant: 'salary_cap', isDynasty: true })
    expect(rules.concept).toBe('salary_cap')
    expect(rules.notes.join(' ')).toMatch(/contract/i)
  })

  test('stored concept aliases recover KOTH and Pirate from their base shells', () => {
    const settings = (tag: string) => ({ conceptRules: { extensions: { aliasTags: [tag] } } })
    expect(readFormatRules({ leagueType: 'redraft', settings: settings('king_of_the_hill') }).concept).toBe('king_of_the_hill')
    expect(readFormatRules({ leagueType: 'dynasty', settings: settings('pirate_vampire') }).concept).toBe('pirate')
  })

  test('redraft requires a paired playoff simulation and has no future picks', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'redraft', bestBall: false, tradesEnabled: true })
    expect(policy.primaryOutcome).toBe('playoff_probability')
    expect(policy.allowsFuturePicks).toBe(false)
    expect(policy.requiredEvidence).toContain('paired_outcome_simulation')
  })

  test('dynasty keeps current odds and multi-year value in one policy', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'dynasty', bestBall: false, tradesEnabled: true })
    expect(policy.lifecycle).toBe('multi_season')
    expect(policy.primaryOutcome).toBe('championship_window')
    expect(policy.allowsFuturePicks).toBe(true)
  })

  test('guillotine replaces playoffs with survival inputs', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'guillotine', bestBall: false, tradesEnabled: true })
    expect(policy.primaryOutcome).toBe('survival_probability')
    expect(policy.requiredEvidence).toContain('field_and_chop_line')
    expect(policy.requiredEvidence).not.toContain('best_ball_weekly_distribution')
  })

  test('a guillotine best-ball overlay uses automatic rosters for survival', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'guillotine', bestBall: true, tradesEnabled: true })
    expect(policy.primaryOutcome).toBe('survival_probability')
    expect(policy.rosterMethod).toBe('automatic_optimal_lineup')
    expect(policy.requiredEvidence).toContain('best_ball_weekly_distribution')
  })

  test('best ball is an overlay and respects disabled trades', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'dynasty', bestBall: true, tradesEnabled: false })
    expect(policy.format).toBe('best_ball')
    expect(policy.lifecycle).toBe('multi_season')
    expect(policy.rosterMethod).toBe('automatic_optimal_lineup')
    expect(assessTradeGradeReadiness(policy, {}).reason).toMatch(/disabled/)
  })

  test('salary cap requires legality and contract evidence before value', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'salary_cap', bestBall: false, tradesEnabled: true })
    expect(policy.format).toBe('salary_cap')
    expect(policy.primaryOutcome).toBe('cap_adjusted_championship_window')
    expect(policy.requiredEvidence).toEqual(expect.arrayContaining(['contract_terms', 'cap_ledgers', 'dead_money_rules']))
  })

  test('the supplied Survivor Guillotine variant is a distinct phase-driven policy', () => {
    const policy = resolveTradeGradingPolicy({
      concept: 'survivor',
      bestBall: false,
      tradesEnabled: false,
      survivorMode: true,
      guillotineMode: true,
    })
    expect(policy.format).toBe('survivor_guillotine')
    expect(policy.primaryOutcome).toBe('survival_probability')
    expect(assessTradeGradeReadiness(policy, {}).reason).toMatch(/disabled/)
  })

  test('Zombie grades require both participant states and infection evidence', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'zombie', bestBall: false, tradesEnabled: true })
    expect(policy.primaryOutcome).toBe('infection_adjusted_survival')
    expect(policy.requiredEvidence).toEqual(expect.arrayContaining(['infection_state', 'counterparty_state', 'immunity_and_items']))
  })

  test('tournament value ends at advancement and roster-reset boundaries', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'tournament', bestBall: false, tradesEnabled: false })
    expect(policy.primaryOutcome).toBe('advancement_probability')
    expect(policy.allowsFuturePicks).toBe(false)
    expect(policy.requiredEvidence).toEqual(expect.arrayContaining(['advancement_rules', 'roster_expiry']))
  })

  test('King of the Hill prices the crown, three-player loss, and playoff cutoff', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'king_of_the_hill', bestBall: false, tradesEnabled: true })
    expect(policy.format).toBe('king_of_the_hill')
    expect(policy.primaryOutcome).toBe('crown_adjusted_championship_odds')
    expect(policy.requiredEvidence).toEqual(expect.arrayContaining(['crown_holder', 'weekly_score_distributions', 'faab_market']))
    expect(CROWN_BONUS).toBe(10)
    expect(CROWN_PENALTY_PLAYERS).toBe(3)
  })

  test('Pirate uses a league-wide Thursday-to-Monday lock and three protections', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'pirate', bestBall: false, tradesEnabled: true })
    expect(policy.format).toBe('pirate')
    expect(policy.primaryOutcome).toBe('steal_adjusted_championship_odds')
    expect(policy.allowsFuturePicks).toBeNull()
    expect(policy.requiredEvidence).toEqual(expect.arrayContaining(['trade_window', 'protection_state', 'steal_exposure']))
    expect(PROTECTION_SLOTS).toBe(3)
    expect(tradeLockNote({ inLockWindow: true, playerProtected: true })).toMatch(/entire league/i)
    expect(tradeLockNote({ inLockWindow: true, playerProtected: false })).toMatch(/cannot execute/i)
  })

  test('contextual grades fail closed while an as-of market comparison may remain available', () => {
    const policy = resolveTradeGradingPolicy({ concept: 'redraft', bestBall: false, tradesEnabled: true })
    const readiness = assessTradeGradeReadiness(policy, {
      team_identity: 'available',
      league_rules: 'available',
      trade_rules: 'available',
      as_of_asset_values: 'available',
    })
    expect(readiness.marketComparisonAllowed).toBe(true)
    expect(readiness.contextualGradeAllowed).toBe(false)
    expect(readiness.missingRequired).toContain('roster_before')
    expect(readiness.missingRequired).toContain('paired_outcome_simulation')
  })

  test('historical evidence must have existed no later than the trade', () => {
    expect(historicalEvidenceIsAsOfTrade({
      tradeCreatedAt: '2024-09-20T12:00:00.000Z',
      evidenceCapturedAt: '2024-09-20T11:59:00.000Z',
      maxAgeMs: 5 * 60 * 1000,
    })).toBe(true)
    expect(historicalEvidenceIsAsOfTrade({
      tradeCreatedAt: '2024-09-20T12:00:00.000Z',
      evidenceCapturedAt: '2026-09-20T12:00:00.000Z',
    })).toBe(false)
    expect(historicalEvidenceIsAsOfTrade({
      tradeCreatedAt: '2024-09-20T12:00:00.000Z',
      evidenceCapturedAt: '2024-08-20T12:00:00.000Z',
      maxAgeMs: 24 * 60 * 60 * 1000,
    })).toBe(false)
  })
})
