'use client'

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { KpiCard, RecommendationCard, InfoCard, ActivityMixDonut } from '@/components/commissioner-os/cards'
import { participationSlices } from '@/lib/commissioner-ui/charts/deriveChartSeries'
import { getSeverityStyle, SEVERITY_LABELS } from '@/components/commissioner-os/cards/severityStyles'
import { EmptyState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { CommissionerRecommendationContract } from '@/lib/commissioner-ui/contracts'
import type { LeagueHealthDetail, LeagueHealthRisk, LeagueHealthEvidencePoint } from '@/lib/commissioner-ui/league-health/decision-os-client'
import { ShieldCheck } from 'lucide-react'

export interface LeagueHealthViewProps {
  detail: LeagueHealthDetail
  risks: LeagueHealthRisk[]
  evidence: LeagueHealthEvidencePoint[]
  recommendations: CommissionerRecommendationContract[]
  dataMode: CommissionerDataMode
}

/**
 * League Health owns all League Health intelligence — this component
 * renders it, it never computes it. Every value arrives already computed
 * as props from the League Health Decision OS client.
 */
export function LeagueHealthView({ detail, risks, evidence, recommendations, dataMode }: LeagueHealthViewProps) {
  const scoreStyle = getSeverityStyle(detail.tier)
  // Only worth a column if at least one risk carries it — see the header comment below.
  const showRiskAge = risks.some((risk) => risk.ageInDays != null)
  const participation = participationSlices(detail.participation)

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {/* Health Score + deduction breakdown */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_2fr]">
        <div
          className="flex flex-col items-center justify-center gap-1 rounded-[var(--radius-generous)] border p-6 text-center"
          style={{ borderColor: scoreStyle.border, background: 'var(--panel)' }}
        >
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            League Health Score
          </span>
          <span className="text-metric font-bold" style={{ color: scoreStyle.text, fontSize: 'var(--text-display)' }}>
            {detail.score}
          </span>
          <span className="text-xs font-semibold" style={{ color: scoreStyle.text }}>
            {SEVERITY_LABELS[detail.tier]}
          </span>
        </div>

        {/*
          * Was a "Deduction Breakdown" — Baseline 100 minus a list of penalties down to the final
          * score. No such model exists: the pipeline computes one number and no decomposition, so
          * every line in that card was invented to make the arithmetic land on the real total. What
          * replaces it is the league's own narrative evidence, which is real and is the closest
          * honest answer to "why is the score what it is".
          */}
        <InfoCard title="What drives this score">
          {evidence.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              No narrative signals were available for this league.
            </p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((point) => (
                <li key={point.label}>
                  <span className="block text-xs font-semibold" style={{ color: 'var(--text)' }}>
                    {point.label}
                  </span>
                  <span className="text-xs">{point.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </InfoCard>
      </div>

      {/*
        * Four real readings, replacing four sub-scores of which exactly one was real. Retention and
        * commissioner load are BANDS, not numbers — the pipeline bands them — so they render as
        * labels; showing "89" for a category would invent precision. "Managers active" names its own
        * denominator because `totalManagers` counts managers seen in the lookback window, not the
        * league's team count.
        */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Engagement score" value={String(detail.score)} />
        <KpiCard label="Retention risk" value={SEVERITY_LABELS[detail.retentionRisk]} severity={detail.retentionRisk} />
        <KpiCard label="Commissioner load" value={SEVERITY_LABELS[detail.commissionerWorkload]} severity={detail.commissionerWorkload} />
        <KpiCard
          label="Managers active in window"
          value={`${detail.participation.activeManagers} of ${detail.participation.totalManagers}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {/* Risk table */}
          <div>
            <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Risk Analysis
            </h2>
            {risks.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No active risks." description="The league is in good shape." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Risk</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    {/*
                      * Rendered only when something actually tracks it. Risks are recomputed from the
                      * current window on every request, so there is no first-seen timestamp to age
                      * from — a permanent "0d" column would read as "found today, every day".
                      */}
                    {showRiskAge ? <TableHead>Age</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {risks.map((risk) => {
                    const style = getSeverityStyle(risk.severity)
                    return (
                      <TableRow key={risk.id}>
                        <TableCell>{risk.description}</TableCell>
                        <TableCell>{risk.category}</TableCell>
                        <TableCell>
                          <span style={{ color: style.text }}>{SEVERITY_LABELS[risk.severity]}</span>
                        </TableCell>
                        {showRiskAge ? <TableCell>{risk.ageInDays == null ? '—' : `${risk.ageInDays}d`}</TableCell> : null}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Recommendations */}
          <div>
            <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Recommendations
            </h2>
            {recommendations.length === 0 ? (
              <EmptyState title="No open recommendations." description="The league is in good shape." />
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    title={rec.title}
                    rationale={rec.rationale}
                    severity={rec.severity}
                    confidence={rec.confidence}
                    expectedImpact={rec.expectedImpact}
                    primaryActionLabel={rec.primaryActionLabel}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/*
          * The "View Evidence" dialog that stood here is gone, not moved: it hid the league's
          * narrative behind a click, and that narrative is now the primary content of the "What
          * drives this score" card above — which is where a commissioner looks when the number
          * surprises them. Two copies of the same three sentences is worse than one visible copy.
          *
          * `completeness` takes its place because it was the one real field this page fetched and
          * never rendered, and it is the caveat every number here should be read with.
          */}
        <div className="space-y-4">
          {/*
            * Active against quiet, inside the intelligence window. The labels name the window because
            * `totalManagers` counts managers with an event in it rather than the league's roster — the
            * same reason the KPI labels above say "in window".
            */}
          {participation.length > 0 ? (
            <InfoCard title="Manager participation">
              <ActivityMixDonut
                slices={participation}
                height={200}
                ariaLabel={`${detail.participation.activeManagers} of ${detail.participation.totalManagers} managers seen active in the intelligence window`}
              />
            </InfoCard>
          ) : null}

          <InfoCard title="Data quality">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span>Inputs available</span>
                <span className="text-metric font-semibold" style={{ color: 'var(--text)' }}>
                  {detail.completeness}%
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                How much of what the intelligence pipeline wanted for this league it actually had. A
                property of the inputs, not a confidence rating for any single finding above.
              </p>
            </div>
          </InfoCard>
        </div>
      </div>
    </div>
  )
}
