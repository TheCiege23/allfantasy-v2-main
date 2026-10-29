import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LABEL_DEFAULTS,
  POSITION_COLORS,
  ROSTER_LABELS,
  SCORING_LABELS,
  customScoringStartingPoint,
  plainRulesLabel,
  positionPath,
} from '@/lib/league-labels/catalog'
import {
  WIZARD_PRESET_TO_SCORING_LABEL,
  liveRulesForScoringLabel,
  matchRosterLabel,
  scoringLabelIdForNba,
  scoringLabelIdForNflPreset,
  scoringLabelIdForWizard,
} from '@/lib/league-labels/liveValues'
import { KNOWN_VALUE_DIFFERENCES, computeValueDifferences, describeDifference } from '@/lib/league-labels/valueDifferences'
import { findScoringPresetRule, receptionPointsForScoringPresetId } from '@/lib/league-creation-preset/scoring-presets'
import { nflScoringSeedForCreate } from '@/lib/nfl-scoring/nflScoringSeedForCreate'
import { NFL_ROSTER_TEMPLATES } from '@/lib/nfl-roster/NflRosterTemplates'

const PUBLIC = path.join(process.cwd(), 'public')

describe('label catalogue ↔ live presets', () => {
  it('every difference between a label and its backing preset is a reviewed, listed one (and none are stale)', () => {
    const actual = computeValueDifferences().map(describeDifference).sort()
    expect(actual).toEqual([...KNOWN_VALUE_DIFFERENCES].sort())
  })

  it('the difference check can fail: a label value that disagrees with its preset is reported', () => {
    const half = SCORING_LABELS.find((s) => s.id === 'half')!
    const rec = half.values.find((v) => v.key === 'rec')!
    const original = rec.value
    try {
      ;(rec as { value: number }).value = 0.75
      expect(computeValueDifferences().map(describeDifference)).toContain('scoring:half:reception design=0.75 live=0.5')
    } finally {
      ;(rec as { value: number }).value = original
    }
  })

  it('backed NFL labels read the same rules creation seeds', () => {
    for (const [wizardId, labelId] of Object.entries(WIZARD_PRESET_TO_SCORING_LABEL)) {
      const rule = findScoringPresetRule(wizardId)
      expect(rule, wizardId).toBeDefined()
      const label = SCORING_LABELS.find((s) => s.id === labelId)!
      if (label.backing?.kind !== 'nfl') continue
      const seed = nflScoringSeedForCreate({ scoringPresetId: wizardId })
      expect(seed.presetKey, wizardId).toBe(label.backing.presetKey)
      expect(receptionPointsForScoringPresetId(wizardId)).toBe(liveRulesForScoringLabel(label)!.reception)
    }
  })

  it('TE Premium is Full PPR plus 0.5 per TE catch, exactly what the create wizard seeds', () => {
    const seed = nflScoringSeedForCreate({ scoringPresetId: 'fb_full_ppr', tePremiumPoints: 0.5 })
    const te = SCORING_LABELS.find((s) => s.id === 'te')!
    expect(liveRulesForScoringLabel(te)).toEqual(seed.rules)
    expect(scoringLabelIdForWizard({ scoringPresetId: 'fb_full_ppr', tePremiumPoints: 0.5 })).toBe('te')
    expect(scoringLabelIdForWizard({ scoringPresetId: 'fb_half_ppr', tePremiumPoints: 0.5 })).toBe('custom')
  })
})

describe('label catalogue contents', () => {
  it('has the 12 scoring and 9 roster options from the handoff, each with its art shipped', () => {
    expect(SCORING_LABELS.map((s) => s.id)).toEqual(['std', 'half', 'ppr', 'te', 'six', 'fd', 'bonus', 'pts', 'ptsb', 'cat9', 'cat8', 'custom'])
    expect(ROSTER_LABELS.map((r) => r.id)).toEqual(['nfl-std', 'nfl-sf', 'nfl-2qb', 'nfl-3wr', 'nfl-skill', 'nfl-idp', 'nba-std', 'nba-small', 'nba-deep'])
    for (const s of SCORING_LABELS) expect(existsSync(path.join(PUBLIC, s.plate)), s.plate).toBe(true)
    for (const r of ROSTER_LABELS) expect(existsSync(path.join(PUBLIC, r.strip)), r.strip).toBe(true)
    for (const p of Object.keys(POSITION_COLORS)) expect(existsSync(path.join(PUBLIC, positionPath(p))), p).toBe(true)
  })

  it('roster start counts match the handoff table', () => {
    const counts = Object.fromEntries(ROSTER_LABELS.map((r) => [r.id, [r.starters.length, r.bench, r.injured]]))
    expect(counts).toEqual({
      'nfl-std': [9, 7, 1], 'nfl-sf': [10, 7, 1], 'nfl-2qb': [10, 7, 1], 'nfl-3wr': [10, 7, 1], 'nfl-skill': [9, 6, 1],
      'nfl-idp': [13, 8, 1], 'nba-std': [10, 3, 1], 'nba-small': [7, 3, 1], 'nba-deep': [10, 6, 2],
    })
  })

  it('defaults, custom starting point and the plain text label', () => {
    expect(LABEL_DEFAULTS).toEqual({ NFL: { scoring: 'half', roster: 'nfl-std' }, NBA: { scoring: 'pts', roster: 'nba-std' } })
    expect(customScoringStartingPoint('NFL')).toBe('half')
    expect(customScoringStartingPoint('NBA')).toBe('pts')
    expect(plainRulesLabel('half', 'nfl-std')).toBe('Half PPR · Standard roster')
    expect(plainRulesLabel('custom', 'nfl-sf')).toBe('Custom · Superflex roster')
  })
})

describe('resolving a league to its labels', () => {
  it('maps settings presets, and edited rules always read CUSTOM', () => {
    expect(scoringLabelIdForNflPreset({ presetKey: 'af_default', rulesMatchPreset: true })).toBe('half')
    expect(scoringLabelIdForNflPreset({ presetKey: 'af_default', rulesMatchPreset: false })).toBe('custom')
    expect(scoringLabelIdForNflPreset({ presetKey: 'custom', rulesMatchPreset: true })).toBe('custom')
    expect(scoringLabelIdForNflPreset({ presetKey: 'espn_ppr', rulesMatchPreset: true })).toBeNull()
    expect(scoringLabelIdForNflPreset({ presetKey: 'af_ppr', rulesMatchPreset: true, tePremiumPoints: 0.5 })).toBe('te')
    expect(scoringLabelIdForNba({ presetKey: 'af_default', rulesMatchPreset: true })).toBe('pts')
    expect(scoringLabelIdForNba({ scoringMode: 'h2h_category', categoryPresetId: 'nba_9cat' })).toBe('cat9')
    expect(scoringLabelIdForNba({ scoringMode: 'h2h_category', categoryPresetId: 'nba_8cat_standard' })).toBe('cat8')
    expect(scoringLabelIdForNba({ scoringMode: 'h2h_category', categoryPresetId: 'nba_8cat' })).toBe('custom')
  })

  it('matches a roster by its starters and says whether bench/IR match the art', () => {
    const redraft = NFL_ROSTER_TEMPLATES.find((t) => t.key === 'redraft')!.slots
    const m = matchRosterLabel('NFL', redraft)!
    expect(m.label.id).toBe('nfl-std')
    expect(m.exact).toBe(false)
    expect(matchRosterLabel('NFL', { ...redraft, BN: 7 })!.exact).toBe(true)
    expect(matchRosterLabel('NFL', { QB: 3 })).toBeNull()
  })
})
