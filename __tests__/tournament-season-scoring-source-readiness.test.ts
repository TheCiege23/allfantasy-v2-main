import { expect, it } from 'vitest'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { assessSeasonScoringSourceReadiness } from '@/lib/tournament/seasonScoringSourceReadiness'

it('shows the NBA default foul gap without treating configured box fields as a live feed', () => {
  const report = assessSeasonScoringSourceReadiness(defaultSeasonRules('NBA', 'nba_points'))
  expect(report).toMatchObject({ source: 'Rolling Insights NBA box', boxContractReady: false, launchReady: false, missing: ['technical_foul', 'flagrant_foul'] })
  expect(report.derived).toContain('fifty_plus_points_bonus')
})

it('keeps activation blocked even when a custom NBA ruleset uses only measured box stats', () => {
  const rules = defaultSeasonRules('NBA', 'nba_points')
  rules.weights = rules.weights.filter(w => w.statKey !== 'technical_foul' && w.statKey !== 'flagrant_foul')
  const report = assessSeasonScoringSourceReadiness(rules)
  expect(report).toMatchObject({ boxContractReady: true, launchReady: false, missing: [] })
  expect(report.blockers).toContain('Actual game starts and complete correction-window refreshes still need a trusted worker.')
})

it('does not imply that NFL game-level scoring is certified', () => {
  expect(assessSeasonScoringSourceReadiness(defaultSeasonRules('NFL', 'ppr'))).toMatchObject({ sport: 'NFL', boxContractReady: false, launchReady: false })
})
