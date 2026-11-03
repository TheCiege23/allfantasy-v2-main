import { describe, expect, it } from 'vitest'
import { ruleSnapshotFromLeague, effectiveVetoRule } from '@/lib/league-rules-explainer/snapshot'
import { diffRuleSnapshots } from '@/lib/league-rules-explainer/changeKeys'
import { explainLeagueRules, explainRuleChange } from '@/lib/league-rules-explainer/explain'
import { renderRuleText, renderChangeLine } from '@/lib/league-rules-explainer/render'
import { translations } from '@/lib/i18n/translations'

const render = (settings: Record<string, unknown>, language: 'en' | 'es') => {
  const snapshot = ruleSnapshotFromLeague({ platform: 'allfantasy', leagueType: 'dynasty', sport: 'NFL', settings })
  return explainLeagueRules(snapshot).flatMap(section => section.lines.map(line => renderRuleText(line.text, key => translations[language][key] ?? key, language)))
}
describe('trade veto rule explanation', () => {
  it('shows the effective count, percent and legacy default in league vote leagues', () => {
    expect(render({ trade_review_mode: 'league_vote', vetoThreshold: 3 }, 'en').join(' ')).toContain('Veto threshold: 3 votes')
    expect(render({ trade_review_mode: 'league_vote', vetoThreshold: 60, vetoThresholdMode: 'percent' }, 'es').join(' ')).toContain('60%')
    expect(effectiveVetoRule({ conceptRules: { extensions: { vetoThresholdPercent: 40 } } })).toEqual({ mode: 'percent', value: 40 })
    expect(effectiveVetoRule({})).toEqual({ mode: 'count', value: 4 })
  })
  it('omits the veto line when league voting is not the review method', () => {
    expect(render({ trade_review_mode: 'commissioner', vetoThreshold: 3 }, 'en').join(' ')).not.toContain('Veto threshold:')
  })
  it('renders one useful change when the threshold or mode changes and no change for equal rules', () => {
    const before = effectiveVetoRule({ vetoThreshold: 3 })
    const after = effectiveVetoRule({ vetoThreshold: 60, vetoThresholdMode: 'percent' })
    const changes = diffRuleSnapshots({ vetoThreshold: before }, { vetoThreshold: after })
    expect(changes).toEqual([{ key: 'vetoThreshold', before, after }])
    const line = explainRuleChange(changes[0]!)
    expect(line).not.toBeNull()
    expect(renderChangeLine(line!, key => translations.en[key] ?? key, 'en')).toContain('60%')
    expect(diffRuleSnapshots({ vetoThreshold: before }, { vetoThreshold: before })).toEqual([])
  })
})
