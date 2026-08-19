/**
 * Source-invariant tests for CommissionerIntelligencePreview.
 *
 * Verifies structural contracts, IPM builder usage, customer-facing language,
 * and architecture rules (no local intelligence computation in the component).
 * Does not require a JSDOM environment.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const componentSrc = fs.readFileSync(
  path.resolve(root, 'components/league-import/CommissionerIntelligencePreview.tsx'),
  'utf8',
)
const flowSrc = fs.readFileSync(
  path.resolve(root, 'components/unified-import-ui/LeagueImportFlow.tsx'),
  'utf8',
)

// ── Structural exports ────────────────────────────────────────────────────────

describe('CommissionerIntelligencePreview — component structure', () => {
  it('exports the component and payload type', () => {
    expect(componentSrc).toContain('export function CommissionerIntelligencePreview(')
    expect(componentSrc).toContain('export type CommissionerPreviewPayload')
    expect(componentSrc).toContain('export type CommissionerIntelligencePreviewProps')
  })

  it('renders as a fixed modal overlay with correct aria attributes', () => {
    expect(componentSrc).toContain('fixed inset-0 z-50')
    expect(componentSrc).toContain('role="dialog"')
    expect(componentSrc).toContain('aria-modal="true"')
    expect(componentSrc).toContain('aria-label="Commissioner Intelligence Preview"')
    expect(componentSrc).toContain('data-testid="commissioner-intelligence-preview"')
  })

  it('shows the Commissioner Intelligence Preview heading', () => {
    expect(componentSrc).toContain('Commissioner Intelligence Preview')
  })
})

// ── IPM builder usage ─────────────────────────────────────────────────────────

describe('CommissionerIntelligencePreview — IPM builder integration', () => {
  it('imports buildHealthCard from the IPM presentation layer', () => {
    expect(componentSrc).toContain('buildHealthCard')
    expect(componentSrc).toContain("from '../../lib/decision-os/presentation/index'")
  })

  it('imports buildRetentionCard from the IPM presentation layer', () => {
    expect(componentSrc).toContain('buildRetentionCard')
  })

  it('imports buildCommissionerCard from the IPM presentation layer', () => {
    expect(componentSrc).toContain('buildCommissionerCard')
  })

  it('imports buildRecommendationPresentation and buildRecommendationPresentationSet', () => {
    expect(componentSrc).toContain('buildRecommendationPresentation')
    expect(componentSrc).toContain('buildRecommendationPresentationSet')
  })

  it('imports buildEngagementMetric and buildRetentionMetric', () => {
    expect(componentSrc).toContain('buildEngagementMetric')
    expect(componentSrc).toContain('buildRetentionMetric')
  })

  it('imports scoreToColorToken for health color resolution', () => {
    expect(componentSrc).toContain('scoreToColorToken')
  })

  it('calls buildHealthCard with health score and tier label', () => {
    expect(componentSrc).toContain('buildHealthCard(')
    expect(componentSrc).toContain('healthCard.healthScore')
    expect(componentSrc).toContain('healthCard.healthTier')
  })

  it('calls buildRetentionCard and renders from retentionCard', () => {
    expect(componentSrc).toContain('buildRetentionCard(')
    expect(componentSrc).toContain('retentionCard')
  })

  it('calls buildCommissionerCard and renders from commissionerCard', () => {
    expect(componentSrc).toContain('buildCommissionerCard(')
    expect(componentSrc).toContain('commissionerCard.workloadLevel')
    expect(componentSrc).toContain('commissionerCard.workloadItems')
  })

  it('renders recommendations from IPM presentationSet.items', () => {
    expect(componentSrc).toContain('recommendationSet.items.map(')
    expect(componentSrc).toContain('rec.title')
    expect(componentSrc).toContain('rec.recommendationId')
  })

  it('renders MetricCard instances from MetricPresentation IPM shapes', () => {
    expect(componentSrc).toContain('metric.label')
    expect(componentSrc).toContain('metric.displayValue')
    expect(componentSrc).toContain('metric.colorToken')
    expect(componentSrc).toContain('metric.subtext')
  })
})

// ── No local intelligence computation ────────────────────────────────────────

describe('CommissionerIntelligencePreview — no local score/severity derivation', () => {
  it('does not contain a local deriveIntelligence() function', () => {
    expect(componentSrc).not.toContain('function deriveIntelligence(')
  })

  it('does not define a local TIER_COLORS map', () => {
    expect(componentSrc).not.toContain('TIER_COLORS')
  })

  it('does not define a local SENTIMENT_TEXT or SENTIMENT_DOT map', () => {
    expect(componentSrc).not.toContain('SENTIMENT_TEXT')
    expect(componentSrc).not.toContain('SENTIMENT_DOT')
  })

  it('does not define local Intelligence type with local health derivation', () => {
    expect(componentSrc).not.toContain('type Intelligence = {')
  })

  it('does not compute severity inline in JSX (no ternary color chains in component body)', () => {
    expect(componentSrc).not.toContain("healthScore >= 80 ? 'strong'")
    expect(componentSrc).not.toContain("retentionRisk === 'Low' ? 'good'")
    expect(componentSrc).not.toContain("managerActivity === 'Active' ? 'good'")
  })

  it('all intelligence derivation is encapsulated in the adapter (buildPreviewIpm)', () => {
    expect(componentSrc).toContain('function buildPreviewIpm(')
    expect(componentSrc).toContain('buildPreviewIpm(payload)')
  })
})

// ── Health score section ──────────────────────────────────────────────────────

describe('CommissionerIntelligencePreview — health score section', () => {
  it('displays League Health Score heading with health bar testid', () => {
    expect(componentSrc).toContain('League Health Score')
    expect(componentSrc).toContain('data-testid="health-bar"')
    expect(componentSrc).toContain('/ 100')
  })

  it('derives health score with penalties for empty rosters and review required', () => {
    expect(componentSrc).toContain('emptyRosters * 8')
    expect(componentSrc).toContain('canonical.reviewRequired')
    expect(componentSrc).toContain('healthScore -= 10')
  })

  it('maps health score ranges to tier labels in the adapter', () => {
    expect(componentSrc).toContain("'Strong'")
    expect(componentSrc).toContain("'Good'")
    expect(componentSrc).toContain("'Fair'")
    expect(componentSrc).toContain("'Needs work'")
  })

  it('resolves health bar color from IPM scoreToColorToken, not a local tier map', () => {
    expect(componentSrc).toContain('scoreToColorToken(healthCard.healthScore)')
    expect(componentSrc).not.toContain('TIER_COLORS[')
  })
})

// ── Metrics grid ──────────────────────────────────────────────────────────────

describe('CommissionerIntelligencePreview — metrics grid', () => {
  it('renders all six metric cards via MetricPresentation shapes', () => {
    expect(componentSrc).toContain('retentionMetric')
    expect(componentSrc).toContain('activityMetric')
    expect(componentSrc).toContain('rosterMetric')
    expect(componentSrc).toContain('tradeMetric')
    expect(componentSrc).toContain('waiverMetric')
    expect(componentSrc).toContain('engagementMetric')
  })

  it('metric card labels are present in the adapter', () => {
    expect(componentSrc).toContain('Retention Risk')
    expect(componentSrc).toContain('Manager Activity')
    expect(componentSrc).toContain('Roster Completeness')
    expect(componentSrc).toContain('Trade Activity')
    expect(componentSrc).toContain('Waiver Activity')
    expect(componentSrc).toContain('Engagement Score')
  })

  it('uses customer-friendly language for metric states', () => {
    expect(componentSrc).toContain('All managers are active')
    expect(componentSrc).toContain('need attention')
    expect(componentSrc).toContain('Roster completeness is strong')
    expect(componentSrc).toContain('Trade activity is low this season')
    expect(componentSrc).toContain('Managers are actively trading')
    expect(componentSrc).toContain('League engagement is strong')
    expect(componentSrc).toContain('More insights unlock after league activity')
  })

  it('renders progress bar from metric.progressValue (not raw intel field)', () => {
    expect(componentSrc).toContain('metric.progressValue')
    expect(componentSrc).not.toContain('progress={intel.rosterCoverage}')
    expect(componentSrc).not.toContain('progress={intel.engagementScore}')
  })

  it('MetricCard resolves colors from colorToken, not local sentiment map', () => {
    expect(componentSrc).toContain('TOKEN_TEXT[colorToken]')
    expect(componentSrc).toContain('TOKEN_DOT[colorToken]')
    expect(componentSrc).not.toContain('SENTIMENT_BAR[sentiment]')
  })
})

// ── Workload and recommendations ──────────────────────────────────────────────

describe('CommissionerIntelligencePreview — workload and recommendations', () => {
  it('renders Commissioner Workload section from commissionerCard', () => {
    expect(componentSrc).toContain('Commissioner Workload')
    expect(componentSrc).toContain('commissionerCard.workloadLevel')
    expect(componentSrc).toContain('commissionerCard.workloadItems')
  })

  it('has workload level display labels', () => {
    expect(componentSrc).toContain("'Light'")
    expect(componentSrc).toContain("'Moderate'")
    expect(componentSrc).toContain("'Heavy'")
  })

  it('shows no-action message when workload is light', () => {
    expect(componentSrc).toContain('No immediate action required — league is in good shape')
  })

  it('renders Recommended Actions section from IPM recommendationSet', () => {
    expect(componentSrc).toContain('Recommended Actions')
    expect(componentSrc).toContain('recommendationSet.items.map(')
  })

  it('includes weekly_recap recommendation category in adapter', () => {
    expect(componentSrc).toContain('weekly_recap')
  })

  it('includes retention_intervention recommendation category for at-risk managers', () => {
    expect(componentSrc).toContain('retention_intervention')
  })
})

// ── CTAs and graceful degradation ─────────────────────────────────────────────

describe('CommissionerIntelligencePreview — CTAs and graceful degradation', () => {
  it('has Continue to import and Back buttons', () => {
    expect(componentSrc).toContain('Continue to import')
    expect(componentSrc).toContain('data-testid="continue-to-import"')
    expect(componentSrc).toContain('onContinue')
    expect(componentSrc).toContain('onClose')
  })

  it('shows graceful placeholder when no meaningful data is available', () => {
    expect(componentSrc).toContain('hasMeaningfulData')
    expect(componentSrc).toContain('More insights unlock after league activity is available.')
  })

  it('uses no backend or internal architecture terminology', () => {
    expect(componentSrc).not.toContain('Canonical World')
    expect(componentSrc).not.toContain('Decision OS')
    expect(componentSrc).not.toContain('shadow')
    expect(componentSrc).not.toContain('parity')
    expect(componentSrc).not.toContain('provenance')
    expect(componentSrc).not.toContain('canonicalBridge')
  })
})

// ── Color token resolution ────────────────────────────────────────────────────

describe('CommissionerIntelligencePreview — color token resolution', () => {
  it('has a TOKEN_TEXT map resolving ColorTokens to Tailwind text classes', () => {
    expect(componentSrc).toContain('TOKEN_TEXT')
    expect(componentSrc).toContain("text-emerald-400")
    expect(componentSrc).toContain("text-amber-400")
    expect(componentSrc).toContain("text-red-400")
  })

  it('has a TOKEN_DOT and TOKEN_PROGRESS map for indicator colors', () => {
    expect(componentSrc).toContain('TOKEN_DOT')
    expect(componentSrc).toContain('TOKEN_PROGRESS')
  })

  it('has a WORKLOAD_DISPLAY lookup for workload level labels', () => {
    expect(componentSrc).toContain('WORKLOAD_DISPLAY')
  })
})

// ── LeagueImportFlow integration ──────────────────────────────────────────────

describe('LeagueImportFlow — intelligence modal integration', () => {
  it('imports CommissionerIntelligencePreview', () => {
    expect(flowSrc).toContain('CommissionerIntelligencePreview')
    expect(flowSrc).toContain('CommissionerPreviewPayload')
  })

  it('tracks modal open state and stores raw payload', () => {
    expect(flowSrc).toContain('intelligenceModalOpen')
    expect(flowSrc).toContain('setIntelligenceModalOpen')
    expect(flowSrc).toContain('rawPayload')
  })

  it('opens the modal on successful preview', () => {
    expect(flowSrc).toContain('setIntelligenceModalOpen(true)')
  })

  it('resets modal state at the start of a new preview run', () => {
    expect(flowSrc).toContain('setIntelligenceModalOpen(false)')
  })

  it('renders the modal when intelligenceModalOpen and previewInfo are both set', () => {
    expect(flowSrc).toContain('intelligenceModalOpen && previewInfo &&')
  })

  it('wires onContinue to close modal and scroll to preview section', () => {
    expect(flowSrc).toContain('onContinue={() => {')
    expect(flowSrc).toContain('setIntelligenceModalOpen(false)')
    expect(flowSrc).toContain('previewSectionRef.current?.scrollIntoView')
  })

  it('resets modal when user switches provider tabs', () => {
    expect(flowSrc).toMatch(/setDiscoveredLeagues\(\[\]\)\s*\n\s*setIntelligenceModalOpen\(false\)/)
  })
})
