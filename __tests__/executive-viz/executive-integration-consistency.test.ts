/**
 * Fantasy OS Suite — Phase V3.1: Executive Integration & End-to-End consistency.
 *
 * Durable, source-level invariants that keep the seven Executive Analytics Workspaces feeling like ONE
 * product rather than seven independent ones. These are deliberately semantic/structural (not visual
 * snapshots) so they stay meaningful as the workspaces evolve.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { WAIVER_RESOURCE_STRATEGY_DEFERRED } from '@/lib/executive-viz/waiverDecisionViewModel'
import { DRAFT_VALUE_ANALYTICS_DEFERRED } from '@/lib/executive-viz/draftDecisionViewModel'
import { PLATFORM_TREND_ANALYTICS_DEFERRED } from '@/lib/executive-viz/platformFocusViewModel'
import { TRADE_POSITION_ANALYTICS_DEFERRED } from '@/lib/executive-viz/tradeMarketViewModel'
import {
  PRIORITY_RANK,
  statusFromPriority,
  statusFromSeverity,
  statusFromScore,
  titleCase,
} from '@/lib/executive-viz/recommendationPresentation'

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), 'components', 'executive-viz', ...segments), 'utf8')
}
function readLib(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), 'lib', 'executive-viz', ...segments), 'utf8')
}

const FLAGSHIPS = [
  'LeagueHealthMap.tsx',
  'ChampionshipTrajectory.tsx',
  'LeagueMomentum.tsx',
  'TradeOpportunityMatrix.tsx',
  'WaiverImpactSequence.tsx',
  'DraftDecisionLadder.tsx',
  'PlatformFocus.tsx',
]

const ALL_VIZ = [
  ...FLAGSHIPS,
  'SupportingExecutiveViz.tsx',
  'ManagerSupportingViz.tsx',
  'LeagueSupportingViz.tsx',
  'TradeSupportingViz.tsx',
  'WaiverSupportingViz.tsx',
  'DraftSupportingViz.tsx',
  'PlatformSupportingViz.tsx',
]

describe('Step 5 — visualization consistency: every workspace composes the shared engine', () => {
  it('every flagship uses ExecutiveVisualizationShell with the dominant treatment', () => {
    for (const f of FLAGSHIPS) {
      const src = read(f)
      expect(src, f).toContain('ExecutiveVisualizationShell')
      expect(src, f).toMatch(/dominant/)
    }
  })

  it('no customer-facing visualization imports a raw chart library — all reuse ExecutiveCharts/Shell', () => {
    for (const f of ALL_VIZ) {
      const src = read(f)
      expect(src, f).not.toMatch(/from ['"]recharts['"]/)
      expect(src, f).not.toMatch(/from ['"]d3['"]/)
    }
  })
})

describe('Step 4 — terminology consistency: one word for "urgent"', () => {
  it('flagship urgency chips all say "urgent", never "high priority"', () => {
    // The three flagships that show an urgency count chip.
    for (const f of ['ChampionshipTrajectory.tsx', 'WaiverImpactSequence.tsx', 'DraftDecisionLadder.tsx']) {
      const src = read(f)
      expect(src, f).toMatch(/urgentCount\} urgent|urgentDecisions\} urgent/)
      // the chip itself must not label the count "high priority" (inconsistent wording)
      expect(src, f).not.toMatch(/urgentCount\} high priority/)
    }
  })
})

describe('Step 6 — truthfulness: every deferral is an explicit marker, not a fabrication', () => {
  it('all four workspaces with unavailable contracts expose a consistent *_DEFERRED marker', () => {
    for (const marker of [
      WAIVER_RESOURCE_STRATEGY_DEFERRED,
      DRAFT_VALUE_ANALYTICS_DEFERRED,
      PLATFORM_TREND_ANALYTICS_DEFERRED,
      TRADE_POSITION_ANALYTICS_DEFERRED,
    ]) {
      expect(marker.deferred).toBe(true)
      expect(typeof marker.reason).toBe('string')
      expect(marker.reason.length).toBeGreaterThan(40)
    }
  })

  it('the three "no fabricated history/series" flags are asserted at the contract level', () => {
    // waiver: no timeline; draft: no value curve / pick data; platform: no pulse.
    expect(readLib('waiverDecisionViewModel.ts')).toContain('hasTemporalData: false')
    expect(readLib('draftDecisionViewModel.ts')).toMatch(/hasValueSeries: false/)
    expect(readLib('draftDecisionViewModel.ts')).toMatch(/hasPickData: false/)
    expect(readLib('platformFocusViewModel.ts')).toContain('hasPlatformHistory: false')
  })
})

describe('Step 2 — information architecture: every recommendation has one executive home', () => {
  it('the Manager Weekly Decision Timeline excludes waiver + draft (owned by Waiver OS / Draft OS)', () => {
    const src = readLib('managerSeasonViewModel.ts')
    expect(src).toContain('TIMELINE_EXCLUDED_CATEGORIES')
    expect(src).toMatch(/'waiver_opportunity',\s*'draft_preparation'/)
  })

  it('the by-category distribution lives only in Platform OS (Decision Focus was removed)', () => {
    expect(readLib('managerSeasonViewModel.ts')).not.toContain('export function buildDecisionFocus')
    expect(read('ManagerSupportingViz.tsx')).not.toContain('DecisionFocusCard')
    expect(readLib('platformFocusViewModel.ts')).toContain('platformFocusBars')
  })
})

describe('Step 7 — provider abstraction: no provider terminology in rendered strings', () => {
  it('no customer-facing visualization renders a provider name outside a code comment', () => {
    for (const f of ALL_VIZ) {
      const src = read(f)
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*/, ''))
        .join('\n')
      expect(codeOnly, f).not.toMatch(/\b(Sleeper|ESPN|Yahoo|Fantrax|Fleaflicker|MFL)\b/)
    }
  })
})

describe('Step 1 (V4.0) — recommendation-presentation helpers are shared, not duplicated', () => {
  it('the shared helpers map priority/severity/score to status consistently, and no view model redefines them', () => {
    expect(statusFromPriority('critical')).toBe('critical')
    expect(statusFromPriority('high')).toBe('at_risk')
    expect(statusFromSeverity('low')).toBe('healthy')
    expect(statusFromScore(90)).toBe('excellent')
    expect(statusFromScore(20)).toBe('critical')
    expect(titleCase('trade_coaching')).toBe('Trade Coaching')
    expect(PRIORITY_RANK.critical).toBeGreaterThan(PRIORITY_RANK.low)

    // No view model may re-declare the shared helpers (single source of truth).
    for (const vm of [
      'commissionerLeagueHealthViewModel.ts', 'managerSeasonViewModel.ts', 'leagueMomentumViewModel.ts',
      'tradeMarketViewModel.ts', 'waiverDecisionViewModel.ts', 'draftDecisionViewModel.ts', 'platformFocusViewModel.ts',
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), 'lib', 'executive-viz', vm), 'utf8')
      expect(src, vm).not.toMatch(/function statusFromPriority\(|function statusFromScore\(|function statusFromSeverity\(|function titleCase\(/)
      expect(src, vm).not.toMatch(/const PRIORITY_RANK\b/)
    }
  })
})
