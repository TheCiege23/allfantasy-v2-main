import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  isScoringAuthorityUnchanged,
  PRODUCTION_SCORING_AUTHORITY,
  FORBIDDEN_IN_SCORING,
  FUTURE_SCORING_MIGRATION_REQUIREMENTS,
} from '@/lib/sports-data-gateway/scoring/scoringAuthorityBoundary'

/**
 * Phase 5H-f — the production scoring boundary is intact. Certified sports facts ≠ scoring authority; certified
 * statistics / projections / valuations / injuries / availability NEVER become a scoring input. This is the load-
 * bearing invariant of the phase and is enforced by a filesystem scan of the real scoring engines.
 */
const root = process.cwd()

// The production scoring engines (the authoritative scorers). None may import a certified/canonical fact module.
const SCORING_FILES = [
  'lib/redraft/scoringEngine.ts',
  'lib/redraft/playerWeeklyScoreService.ts',
  'lib/redraft/standingsEngine.ts',
  'lib/scoring-engine/ScoringCalculator.ts',
  'lib/nfl-scoring/scoringKeyBridge.ts',
]

describe('5H-f — scoring authority unchanged', () => {
  it('declares certified stats as observational-only and authority unchanged', () => {
    expect(isScoringAuthorityUnchanged()).toBe(true)
    expect(PRODUCTION_SCORING_AUTHORITY.scoringAuthorityChangedInPhase5Hf).toBe(false)
    expect(PRODUCTION_SCORING_AUTHORITY.certifiedStatsRole).toContain('observational')
    // the authoritative stat store remains PlayerGameLogCache → PlayerWeeklyScore
    const tables = PRODUCTION_SCORING_AUTHORITY.stages.map((s) => s.table).join(' ')
    expect(tables).toContain('PlayerGameLogCache')
    expect(tables).toContain('PlayerWeeklyScore')
  })
  it('the future scoring-authority migration is DESIGN-ONLY with unmet targets (never claimed passed)', () => {
    expect(FUTURE_SCORING_MIGRATION_REQUIREMENTS.status).toContain('DESIGN_ONLY')
    expect(FUTURE_SCORING_MIGRATION_REQUIREMENTS.parityThresholds.projectionOrValueContamination).toBe(0)
  })
})

describe('5H-f — no production scoring engine imports a certified/canonical fact module', () => {
  it('scoring engines never import certified stats / canonical value/image / persistence / factual domains', () => {
    const offenders: string[] = []
    for (const rel of SCORING_FILES) {
      const f = path.join(root, rel)
      if (!fs.existsSync(f)) continue
      const src = fs.readFileSync(f, 'utf8')
      for (const forbidden of FORBIDDEN_IN_SCORING) {
        if (src.includes(forbidden)) offenders.push(`${rel} imports ${forbidden}`)
      }
    }
    expect(offenders, `scoring boundary breach — a scorer imports a certified/canonical fact module: ${offenders.join(', ')}`).toEqual([])
  })
})
