'use client'

import { AlertTriangle, ArrowRight, CheckCircle2, X } from 'lucide-react'
import {
  buildHealthCard,
  buildRetentionCard,
  buildCommissionerCard,
  buildRecommendationPresentation,
  buildRecommendationPresentationSet,
  buildEngagementMetric,
  buildRetentionMetric,
  scoreToColorToken,
  type ColorToken,
  type HealthCard,
  type RetentionCard,
  type CommissionerCard,
  type RecommendationPresentationSet,
  type MetricPresentation,
} from '../../lib/decision-os/presentation/index'

// ---------------------------------------------------------------------------
// Payload types — mirrors the ImportPreviewResponse + CanonicalPreview shapes
// returned by /api/leagues/import/preview. All fields optional so the
// component degrades gracefully when data is sparse.
// ---------------------------------------------------------------------------

type PreviewLeague = {
  name?: string
  teamCount?: number
  type?: string
  sport?: string
  season?: number | null
  playoffTeams?: number
  settings?: { ppr?: boolean; superflex?: boolean; tep?: boolean }
}

type PreviewManager = {
  displayName?: string
  wins?: number
  losses?: number
  rosterSize?: number
  pointsFor?: string
}

type PreviewDataQuality = {
  completenessScore?: number
  rosterCoverage?: number
  tier?: string
  sources?: {
    users?: boolean
    rosters?: boolean
    matchups?: boolean
    trades?: boolean
    draftPicks?: boolean
    history?: boolean
  }
  signals?: string[]
}

type PreviewCanonical = {
  reviewRequired?: boolean
  reviewReasons?: string[]
  warnings?: Array<{ code: string; message: string; severity: string }>
  derivedFlags?: {
    dynasty?: boolean
    idp?: boolean
    bestBall?: boolean
    salaryCap?: boolean
    devy?: boolean
    c2c?: boolean
    tournament?: boolean
  }
}

export type CommissionerPreviewPayload = {
  league?: PreviewLeague
  managers?: PreviewManager[]
  dataQuality?: PreviewDataQuality
  transactionCount?: number
  matchupWeeks?: number
  draftPickCount?: number
  canonical?: PreviewCanonical
}

// ---------------------------------------------------------------------------
// Color token → Tailwind CSS class resolution
// Resolves IPM semantic ColorTokens to design-system classes.
// This is the frontend's responsibility per the IPM architecture contract.
// ---------------------------------------------------------------------------

const TOKEN_TEXT: Record<ColorToken, string> = {
  success:         'text-emerald-400',
  healthy:         'text-cyan-400',
  positive:        'text-teal-400',
  warning:         'text-amber-400',
  danger:          'text-orange-400',
  critical:        'text-red-400',
  neutral:         'text-slate-400',
  accent:          'text-cyan-300',
  benchmark_above: 'text-emerald-400',
  benchmark_equal: 'text-cyan-400',
  benchmark_below: 'text-red-400',
  surface:         'text-white/60',
  surface_elevated:'text-white/70',
  muted:           'text-white/40',
}

const TOKEN_DOT: Record<ColorToken, string> = {
  success:         'bg-emerald-400',
  healthy:         'bg-cyan-400',
  positive:        'bg-teal-400',
  warning:         'bg-amber-400',
  danger:          'bg-orange-400',
  critical:        'bg-red-400',
  neutral:         'bg-slate-400',
  accent:          'bg-cyan-300',
  benchmark_above: 'bg-emerald-400',
  benchmark_equal: 'bg-cyan-400',
  benchmark_below: 'bg-red-400',
  surface:         'bg-white/30',
  surface_elevated:'bg-white/40',
  muted:           'bg-white/20',
}

const TOKEN_BAR_GRADIENT: Record<ColorToken, string> = {
  success:         'from-emerald-600 to-emerald-400',
  healthy:         'from-cyan-600 to-cyan-400',
  positive:        'from-teal-600 to-teal-400',
  warning:         'from-amber-600 to-amber-400',
  danger:          'from-orange-600 to-orange-400',
  critical:        'from-red-600 to-red-400',
  neutral:         'from-slate-600 to-slate-400',
  accent:          'from-cyan-600 to-cyan-300',
  benchmark_above: 'from-emerald-600 to-emerald-400',
  benchmark_equal: 'from-cyan-600 to-cyan-400',
  benchmark_below: 'from-red-600 to-red-400',
  surface:         'from-white/10 to-white/5',
  surface_elevated:'from-white/15 to-white/8',
  muted:           'from-white/5 to-white/3',
}

const TOKEN_PROGRESS: Record<ColorToken, string> = {
  success:         'bg-emerald-400',
  healthy:         'bg-cyan-400',
  positive:        'bg-teal-400',
  warning:         'bg-amber-400',
  danger:          'bg-orange-400',
  critical:        'bg-red-400',
  neutral:         'bg-slate-400',
  accent:          'bg-cyan-300',
  benchmark_above: 'bg-emerald-400',
  benchmark_equal: 'bg-cyan-400',
  benchmark_below: 'bg-red-400',
  surface:         'bg-white/20',
  surface_elevated:'bg-white/25',
  muted:           'bg-white/10',
}

const TOKEN_BADGE: Record<ColorToken, string> = {
  success:         'bg-emerald-500/20 text-emerald-300',
  healthy:         'bg-cyan-500/20 text-cyan-300',
  positive:        'bg-teal-500/20 text-teal-300',
  warning:         'bg-amber-500/20 text-amber-300',
  danger:          'bg-orange-500/20 text-orange-300',
  critical:        'bg-red-500/20 text-red-300',
  neutral:         'bg-slate-500/20 text-slate-300',
  accent:          'bg-cyan-500/20 text-cyan-200',
  benchmark_above: 'bg-emerald-500/20 text-emerald-300',
  benchmark_equal: 'bg-cyan-500/20 text-cyan-300',
  benchmark_below: 'bg-red-500/20 text-red-300',
  surface:         'bg-white/5 text-white/50',
  surface_elevated:'bg-white/8 text-white/60',
  muted:           'bg-white/5 text-white/40',
}

// Display labels for workload levels (formatting only, not intelligence)
const WORKLOAD_DISPLAY: Record<string, string> = {
  light: 'Light', moderate: 'Moderate', heavy: 'Heavy', critical: 'Critical',
}

// Color tokens for workload badge (display mapping, not severity computation)
const WORKLOAD_BADGE_TOKEN: Record<string, ColorToken> = {
  light: 'success', moderate: 'warning', heavy: 'danger', critical: 'critical',
}

// ---------------------------------------------------------------------------
// Preview IPM adapter
// Converts the raw import preview API payload to IPM builder inputs, then
// assembles all presentation models. All intelligence derivation is here —
// the React component below renders IPM outputs only.
// ---------------------------------------------------------------------------

type PreviewIpmResult = {
  healthCard: HealthCard
  retentionCard: RetentionCard
  commissionerCard: CommissionerCard
  recommendationSet: RecommendationPresentationSet
  retentionMetric: MetricPresentation
  activityMetric: MetricPresentation
  rosterMetric: MetricPresentation
  tradeMetric: MetricPresentation
  waiverMetric: MetricPresentation
  engagementMetric: MetricPresentation
  hasMeaningfulData: boolean
  totalManagers: number
}

function buildSimpleMetric(
  entityId: string,
  metricKey: string,
  label: string,
  displayValue: string,
  colorToken: ColorToken,
  subtext: string,
  completeness: number,
  progressValue?: number,
): MetricPresentation {
  return {
    metricId: `metric_${entityId}_${metricKey}`,
    label,
    displayValue,
    numericValue: null,
    colorToken,
    severityToken: colorToken === 'success' ? 'positive' : colorToken === 'warning' ? 'standard' : colorToken === 'danger' || colorToken === 'critical' ? 'elevated' : 'advisory',
    trend: null,
    subtext,
    progressValue: progressValue ?? null,
    derivation: [`${metricKey}=${displayValue} → metric`],
    completeness,
  }
}

function buildPreviewIpm(p: CommissionerPreviewPayload): PreviewIpmResult {
  const ENTITY_ID = 'preview'
  const managers = p.managers ?? []
  const totalManagers = managers.length || p.league?.teamCount || 0
  const dq = p.dataQuality ?? {}
  const completeness = dq.completenessScore ?? 50
  const rosterCoverage = dq.rosterCoverage ?? 0
  const txCount = p.transactionCount ?? 0
  const matchupWeeks = p.matchupWeeks ?? 0
  const hasTrades = dq.sources?.trades ?? false
  const hasMatchups = dq.sources?.matchups ?? false
  const canonical = p.canonical ?? {}

  // Roster analysis
  const avgRoster =
    managers.length > 0
      ? managers.reduce((s, m) => s + (m.rosterSize ?? 0), 0) / managers.length
      : 0
  const emptyRosters = managers.filter((m) => (m.rosterSize ?? 0) === 0).length
  const thinRosters = managers.filter((m) => {
    const size = m.rosterSize ?? 0
    return size > 0 && avgRoster > 0 && size < avgRoster * 0.7
  }).length
  const managersAtRisk = emptyRosters + thinRosters
  const inactiveManagers = managers.filter(
    (m) => m.wins === 0 && m.losses === 0 && (m.rosterSize ?? 0) < 5,
  ).length

  // Health score
  let healthScore = completeness
  if (emptyRosters > 0) healthScore -= emptyRosters * 8
  if (canonical.reviewRequired) healthScore -= 10
  if ((canonical.warnings?.length ?? 0) > 3) healthScore -= 5
  healthScore = Math.round(Math.max(0, Math.min(100, healthScore)))

  const healthTierLabel =
    healthScore >= 80 ? 'Strong' : healthScore >= 60 ? 'Good' : healthScore >= 40 ? 'Fair' : 'Needs work'

  // Retention risk (IPM expects lowercase)
  const retentionRisk =
    managersAtRisk > totalManagers * 0.3 || inactiveManagers > 2
      ? 'high'
      : managersAtRisk > 0 || inactiveManagers > 0
        ? 'medium'
        : 'low'

  const riskReasons: string[] = []
  if (managersAtRisk > 0)
    riskReasons.push(
      `${managersAtRisk} manager${managersAtRisk > 1 ? 's' : ''} need${managersAtRisk === 1 ? 's' : ''} attention`,
    )
  if (inactiveManagers > 0)
    riskReasons.push(`${inactiveManagers} inactive manager${inactiveManagers > 1 ? 's' : ''}`)

  // Manager activity
  const activityPct = hasMatchups
    ? Math.round((matchupWeeks / Math.max(17, matchupWeeks + 1)) * 100)
    : (managers.filter((m) => (m.rosterSize ?? 0) > 5).length / Math.max(1, totalManagers)) * 100
  const managerActivityLabel =
    activityPct >= 70 ? 'Active' : activityPct >= 35 ? 'Moderate' : 'Low'
  const activityToken: ColorToken =
    managerActivityLabel === 'Active' ? 'success' : managerActivityLabel === 'Moderate' ? 'healthy' : 'warning'
  const activityDetail =
    totalManagers > 0
      ? `${totalManagers - managersAtRisk} of ${totalManagers} managers active`
      : 'Activity data is being gathered'

  // Trade activity
  const estimatedTrades = hasTrades ? Math.round(txCount * 0.25) : 0
  const tradeActivityLabel =
    estimatedTrades >= 10 ? 'Active' : estimatedTrades >= 3 ? 'Moderate' : 'Low'
  const tradeToken: ColorToken =
    tradeActivityLabel === 'Active' ? 'success' : tradeActivityLabel === 'Moderate' ? 'healthy' : 'warning'
  const tradeDetail = dq.sources?.trades
    ? tradeActivityLabel === 'Low'
      ? 'Trade activity is low this season'
      : 'Managers are actively trading'
    : 'More insights unlock after league activity'

  // Waiver activity
  const waiverActivityLabel =
    txCount >= 30 ? 'Active' : txCount >= 10 ? 'Moderate' : 'Low'
  const waiverToken: ColorToken =
    waiverActivityLabel === 'Active' ? 'success' : waiverActivityLabel === 'Moderate' ? 'healthy' : 'warning'
  const waiverDetail =
    txCount > 0
      ? `${txCount} transactions on record`
      : 'More insights unlock after league activity'

  // Roster completeness
  const rosterToken: ColorToken =
    rosterCoverage >= 80 ? 'success' : rosterCoverage >= 50 ? 'healthy' : 'warning'
  const rosterDetail =
    rosterCoverage >= 80
      ? 'Roster completeness is strong'
      : rosterCoverage >= 50
        ? 'Most rosters are complete'
        : 'Some rosters need players'

  // Engagement score
  const engagementScore = Math.round(
    rosterCoverage * 0.35 +
      Math.min(100, activityPct) * 0.35 +
      (hasTrades
        ? Math.min(100, txCount * 2)
        : txCount > 0
          ? Math.min(100, txCount * 0.5)
          : 0) *
        0.3,
  )
  const engagementTier =
    engagementScore >= 70 ? 'active' : engagementScore >= 45 ? 'moderate' : 'low'
  const engagementDetail =
    engagementScore >= 70
      ? 'League engagement is strong'
      : engagementScore >= 45
        ? 'Engagement is developing'
        : 'Early activity — more data coming'

  // Commissioner workload
  const workloadItems: string[] = []
  if (emptyRosters > 0)
    workloadItems.push(`${emptyRosters} manager${emptyRosters > 1 ? 's' : ''} without rosters`)
  if (thinRosters > 0)
    workloadItems.push(`${thinRosters} under-rostered team${thinRosters > 1 ? 's' : ''}`)
  if (canonical.reviewRequired) workloadItems.push('League settings flagged for review')
  if (!hasMatchups && matchupWeeks === 0)
    workloadItems.push('Matchup schedule not yet available')
  const workloadLevel =
    workloadItems.length >= 3 ? 'heavy' : workloadItems.length >= 1 ? 'moderate' : 'light'

  // Recommendations — structured as IPM inputs
  type RawRec = Parameters<typeof buildRecommendationPresentation>[0]
  const rawRecs: RawRec[] = []
  let recIndex = 0

  if (managersAtRisk > 0) {
    rawRecs.push({
      id: `rec_preview_${recIndex++}_retention_intervention`,
      tier: 'commissioner', category: 'retention_intervention', entityId: ENTITY_ID,
      priority: 'high', severity: 'elevated', confidence: 'high',
      affectedDimensions: ['retention'],
      expectedImpact: `Reach out to ${managersAtRisk} manager${managersAtRisk > 1 ? 's' : ''} who need attention`,
      derivation: [`managersAtRisk=${managersAtRisk} → retention_intervention`],
      evidence: [`${managersAtRisk} manager${managersAtRisk > 1 ? 's' : ''} flagged for roster gaps`],
      benchmarkComparison: null, prerequisites: [],
      recommendedActions: [{ action: 'Send a personal message', rationale: 'Direct outreach improves response rates' }],
      rollbackCriteria: [],
      completeness, uncertainty: [],
    })
  }
  if (tradeActivityLabel === 'Low') {
    rawRecs.push({
      id: `rec_preview_${recIndex++}_trade_activation`,
      tier: 'commissioner', category: 'trade_activation', entityId: ENTITY_ID,
      priority: 'medium', severity: 'standard', confidence: 'medium',
      affectedDimensions: ['engagement'],
      expectedImpact: 'Consider a trade deadline reminder to activate the market',
      derivation: [`tradeActivity=Low → trade_activation`],
      evidence: [`estimatedTrades=${estimatedTrades}`],
      benchmarkComparison: null, prerequisites: [],
      recommendedActions: [{ action: 'Post a trade deadline reminder', rationale: 'Deadlines create urgency' }],
      rollbackCriteria: [],
      completeness, uncertainty: [],
    })
  }
  if (waiverActivityLabel === 'Low' && txCount < 5) {
    rawRecs.push({
      id: `rec_preview_${recIndex++}_waiver_activation`,
      tier: 'commissioner', category: 'waiver_activation', entityId: ENTITY_ID,
      priority: 'medium', severity: 'standard', confidence: 'medium',
      affectedDimensions: ['engagement'],
      expectedImpact: 'Remind managers to check the waiver wire',
      derivation: [`waiverActivity=Low txCount=${txCount} → waiver_activation`],
      evidence: [`${txCount} transactions on record`],
      benchmarkComparison: null, prerequisites: [],
      recommendedActions: [{ action: 'Post waiver wire highlights', rationale: 'Awareness drives pickup activity' }],
      rollbackCriteria: [],
      completeness, uncertainty: [],
    })
  }
  if (rawRecs.length < 2) {
    rawRecs.push({
      id: `rec_preview_${recIndex++}_weekly_recap`,
      tier: 'commissioner', category: 'weekly_recap', entityId: ENTITY_ID,
      priority: 'low', severity: 'advisory', confidence: 'high',
      affectedDimensions: ['engagement'],
      expectedImpact: 'Regular recaps keep managers emotionally invested',
      derivation: [`defaultRec → weekly_recap`],
      evidence: [],
      benchmarkComparison: null, prerequisites: [],
      recommendedActions: [{ action: 'Post a weekly recap', rationale: 'Recaps build community and habit' }],
      rollbackCriteria: [],
      completeness, uncertainty: [],
    })
  }
  if (retentionRisk === 'high') {
    rawRecs.push({
      id: `rec_preview_${recIndex++}_rivalry_engagement`,
      tier: 'commissioner', category: 'rivalry_engagement', entityId: ENTITY_ID,
      priority: 'high', severity: 'elevated', confidence: 'medium',
      affectedDimensions: ['retention', 'engagement'],
      expectedImpact: 'Amplify rivalries to re-engage managers at risk of leaving',
      derivation: [`retentionRisk=high → rivalry_engagement`],
      evidence: riskReasons,
      benchmarkComparison: null, prerequisites: [],
      recommendedActions: [{ action: 'Highlight a season recap or rivalry matchup', rationale: 'Emotional stakes improve retention' }],
      rollbackCriteria: [],
      completeness, uncertainty: [],
    })
  }

  // ── Build IPM presentation models ──────────────────────────────────────────

  const healthCard = buildHealthCard(ENTITY_ID, healthScore, healthTierLabel, {
    completeness,
    derivation: [`completeness=${completeness} emptyRosters=${emptyRosters} reviewRequired=${canonical.reviewRequired ?? false} → healthScore=${healthScore}`],
  })

  const retentionCard = buildRetentionCard(ENTITY_ID, retentionRisk, riskReasons, {
    managersAtRisk,
    totalManagers,
    completeness,
  })

  const commissionerCard = buildCommissionerCard(ENTITY_ID, workloadLevel, workloadItems, {
    completeness,
  })

  const recommendationSet = buildRecommendationPresentationSet(
    rawRecs.map(buildRecommendationPresentation),
    ENTITY_ID,
    'commissioner',
  )

  const retentionMetric: MetricPresentation = {
    ...buildRetentionMetric(ENTITY_ID, retentionRisk, completeness),
    label: 'Retention Risk',
    subtext: managersAtRisk > 0
      ? `${managersAtRisk} manager${managersAtRisk > 1 ? 's' : ''} need attention`
      : 'All managers are active',
  }

  const activityMetric = buildSimpleMetric(
    ENTITY_ID, 'activity', 'Manager Activity', managerActivityLabel,
    activityToken, activityDetail, completeness,
  )

  const rosterMetric = buildSimpleMetric(
    ENTITY_ID, 'roster', 'Roster Completeness', `${rosterCoverage}%`,
    rosterToken, rosterDetail, completeness, rosterCoverage,
  )

  const tradeMetric = buildSimpleMetric(
    ENTITY_ID, 'trade', 'Trade Activity', tradeActivityLabel,
    tradeToken, tradeDetail, completeness,
  )

  const waiverMetric = buildSimpleMetric(
    ENTITY_ID, 'waiver', 'Waiver Activity', waiverActivityLabel,
    waiverToken, waiverDetail, completeness,
  )

  const engagementMetric = buildEngagementMetric(ENTITY_ID, engagementScore, engagementTier, completeness)

  // Override default engagementMetric label and subtext for preview context
  const engagementMetricFull: MetricPresentation = {
    ...engagementMetric,
    label: 'Engagement Score',
    subtext: engagementDetail,
  }

  return {
    healthCard,
    retentionCard,
    commissionerCard,
    recommendationSet,
    retentionMetric,
    activityMetric,
    rosterMetric,
    tradeMetric,
    waiverMetric,
    engagementMetric: engagementMetricFull,
    hasMeaningfulData:
      (p.managers?.length ?? 0) > 0 || (p.dataQuality?.completenessScore ?? 0) > 0,
    totalManagers,
  }
}

// ---------------------------------------------------------------------------
// MetricCard — renders a single MetricPresentation from the IPM layer
// ---------------------------------------------------------------------------

function MetricCard({
  metric,
}: {
  metric: MetricPresentation
}) {
  const colorToken = metric.colorToken
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
          {metric.label}
        </p>
        <span className={`h-2 w-2 shrink-0 rounded-full ${TOKEN_DOT[colorToken]}`} />
      </div>
      <p className={`mt-2 text-xl font-bold ${TOKEN_TEXT[colorToken]}`}>{metric.displayValue}</p>
      {metric.progressValue !== null && metric.progressValue !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full ${TOKEN_PROGRESS[colorToken]}`}
            style={{ width: `${Math.min(100, Math.max(0, metric.progressValue))}%` }}
          />
        </div>
      )}
      <p className="mt-2 text-[12px] leading-5 text-white/50">{metric.subtext}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CommissionerIntelligencePreview
// ---------------------------------------------------------------------------

export type CommissionerIntelligencePreviewProps = {
  leagueName: string
  provider: string
  payload: CommissionerPreviewPayload
  onClose: () => void
  /** Called when the user clicks "Continue to import" — caller closes modal
   *  and scrolls to the commit section. */
  onContinue: () => void
}

export function CommissionerIntelligencePreview({
  leagueName,
  provider,
  payload,
  onClose,
  onContinue,
}: CommissionerIntelligencePreviewProps) {
  const ipm = buildPreviewIpm(payload)
  const {
    healthCard,
    retentionCard,
    commissionerCard,
    recommendationSet,
    retentionMetric,
    activityMetric,
    rosterMetric,
    tradeMetric,
    waiverMetric,
    engagementMetric,
    hasMeaningfulData,
    totalManagers,
  } = ipm

  const league = payload.league ?? {}
  const healthColorToken = scoreToColorToken(healthCard.healthScore)

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto backdrop-blur-sm"
      style={{ background: 'rgba(2, 6, 23, 0.97)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Commissioner Intelligence Preview"
      data-testid="commissioner-intelligence-preview"
    >
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
              Commissioner Intelligence Preview
            </p>
            <h2 className="mt-1 truncate text-2xl font-bold text-white sm:text-3xl">
              {leagueName}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {league.type ? (
                <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200">
                  {league.type}
                </span>
              ) : null}
              {league.sport ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">
                  {league.sport}
                </span>
              ) : null}
              {league.teamCount ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-white/60">
                  {league.teamCount} teams
                </span>
              ) : null}
              {league.season ? (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold text-white/60">
                  {league.season}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-white/40">
                via {provider}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!hasMeaningfulData ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
            <p className="text-[15px] font-semibold text-white/70">Preview ready</p>
            <p className="mt-2 text-[13px] text-white/40">
              More insights unlock after league activity is available.
            </p>
          </div>
        ) : (
          <>
            {/* Health Score */}
            <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
                    League Health Score
                  </p>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className={`text-5xl font-bold ${TOKEN_TEXT[healthColorToken]}`}>
                      {healthCard.healthScore}
                    </span>
                    <span className="text-lg font-semibold text-white/40">/ 100</span>
                  </div>
                  <p className={`mt-1 text-[13px] font-semibold ${TOKEN_TEXT[healthColorToken]}`}>
                    {healthCard.healthTier}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[12px] text-white/40">
                  <p>{payload.dataQuality?.completenessScore ?? 0}% data coverage</p>
                  {totalManagers > 0 ? <p>{totalManagers} managers</p> : null}
                  {(payload.matchupWeeks ?? 0) > 0 ? (
                    <p>{payload.matchupWeeks} matchup weeks</p>
                  ) : null}
                </div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${TOKEN_BAR_GRADIENT[healthColorToken]}`}
                  style={{ width: `${healthCard.healthScore}%` }}
                  data-testid="health-bar"
                />
              </div>
              <p className="mt-2 text-[11px] text-white/30">
                Based on data coverage, roster completeness, and league activity
              </p>
            </div>

            {/* Metrics Grid */}
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard metric={retentionMetric} />
              <MetricCard metric={activityMetric} />
              <MetricCard metric={rosterMetric} />
              <MetricCard metric={tradeMetric} />
              <MetricCard metric={waiverMetric} />
              <MetricCard metric={engagementMetric} />
            </div>

            {/* Commissioner Workload */}
            <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
                  Commissioner Workload
                </p>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TOKEN_BADGE[WORKLOAD_BADGE_TOKEN[commissionerCard.workloadLevel] ?? 'neutral']}`}
                >
                  {WORKLOAD_DISPLAY[commissionerCard.workloadLevel] ?? commissionerCard.workloadLevel}
                </span>
              </div>
              {commissionerCard.workloadItems.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {commissionerCard.workloadItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-white/65">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-[13px] text-white/60">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  No immediate action required — league is in good shape
                </div>
              )}
            </div>

            {/* Recommended Actions */}
            <div className="mb-8 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">
                Recommended Actions
              </p>
              <ol className="mt-3 space-y-2.5">
                {recommendationSet.items.map((rec, i) => (
                  <li key={rec.recommendationId} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-[10px] font-bold text-cyan-300">
                      {i + 1}
                    </span>
                    <span className="text-[13px] leading-5 text-white/75">{rec.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}

        {/* Footer CTAs */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-bold text-black hover:bg-cyan-400"
            data-testid="continue-to-import"
          >
            Continue to import
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white/70 hover:bg-white/10"
          >
            Back
          </button>
        </div>
        <p className="mt-4 text-[11px] text-white/30">
          Intelligence is based on imported data. More insights unlock after league activity begins.
        </p>
      </div>
    </div>
  )
}
