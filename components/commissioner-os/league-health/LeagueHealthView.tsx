'use client'

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { KpiCard, RecommendationCard, InfoCard } from '@/components/commissioner-os/cards'
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

        <InfoCard title="Deduction Breakdown">
          <ul className="space-y-1">
            <li className="flex justify-between">
              <span>Baseline</span>
              <span style={{ color: 'var(--text)' }}>{detail.baseline}</span>
            </li>
            {detail.deductions.map((line) => (
              <li key={line.label} className="flex justify-between">
                <span>{line.label}</span>
                <span style={{ color: 'var(--severity-elevated-text)' }}>{line.points}</span>
              </li>
            ))}
            <li className="flex justify-between border-t pt-1 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
              <span>Final Score</span>
              <span>{detail.score}</span>
            </li>
          </ul>
        </InfoCard>
      </div>

      {/* Sub-scores */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Engagement" value={String(detail.subScores.engagement)} />
        <KpiCard label="Retention" value={String(detail.subScores.retention)} />
        <KpiCard label="Competitive Balance" value={String(detail.subScores.competitiveBalance)} />
        <KpiCard label="Risk" value={String(detail.subScores.risk)} />
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
                    <TableHead>Age</TableHead>
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
                        <TableCell>{risk.ageInDays}d</TableCell>
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

        <div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                View Evidence
              </Button>
            </DialogTrigger>
            <DialogContent style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text)' }}>
              <DialogHeader>
                <DialogTitle>Evidence</DialogTitle>
              </DialogHeader>
              <ul className="space-y-2 text-sm">
                {evidence.map((point) => (
                  <li key={point.label}>
                    <span className="font-medium" style={{ color: 'var(--text)' }}>
                      {point.label}:
                    </span>{' '}
                    <span style={{ color: 'var(--muted)' }}>{point.detail}</span>
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}
