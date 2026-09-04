import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import type { CommissionerConfidenceLevel, CommissionerRecommendationStatus } from '@/lib/commissioner-ui/contracts'
import { getSeverityStyle, SEVERITY_LABELS } from './severityStyles'

const CONFIDENCE_LABELS: Record<CommissionerConfidenceLevel, string> = {
  developing_signal: 'Developing signal',
  moderate: 'Moderate confidence',
  high: 'High confidence',
  very_high: 'Very high confidence',
}

/** Workflow-neutral labels — status is never severity-colored (Status Language, Design Language §14). */
const STATUS_LABELS: Record<CommissionerRecommendationStatus, string> = {
  new: 'New',
  viewed: 'Viewed',
  in_progress: 'In Progress',
  completed: 'Completed',
  dismissed: 'Dismissed',
  expired: 'Expired',
  automated: 'Automated',
  deferred: 'Deferred',
  resolved: 'Resolved',
}

export interface RecommendationCardProps {
  /** What happened. */
  title: string
  /** Why it matters. */
  rationale: string
  severity: SeverityTier
  confidence: CommissionerConfidenceLevel
  /** Expected impact of acting. */
  expectedImpact: string
  primaryActionLabel: string
  /** Optional — Mission Control and League Health's previews omit it; Recommendations Center's queue always sets it. */
  status?: CommissionerRecommendationStatus
  onPrimaryAction?: () => void
  onDismiss?: () => void
  onViewEvidence?: () => void
}

/**
 * The four-part structure required by the Design Constitution §9 — what,
 * why, action, consequence — every recommendation surface in the product
 * uses this same card, per Recommendations Center §6.
 */
export function RecommendationCard({
  title,
  rationale,
  severity,
  confidence,
  expectedImpact,
  primaryActionLabel,
  status,
  onPrimaryAction,
  onDismiss,
  onViewEvidence,
}: RecommendationCardProps) {
  const style = getSeverityStyle(severity)

  return (
    <Card style={{ borderColor: style.border }}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          <div className="flex items-center gap-2">
            {status && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                {STATUS_LABELS[status]}
              </span>
            )}
            <Badge style={{ background: style.bg, color: style.text, borderColor: style.border }}>
              {SEVERITY_LABELS[severity]}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {rationale}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted2)' }}>
          {CONFIDENCE_LABELS[confidence]} · {expectedImpact}
        </p>
        {onViewEvidence && (
          <button type="button" onClick={onViewEvidence} className="focus-ring link-themed text-xs">
            View evidence
          </button>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button size="sm" onClick={onPrimaryAction}>
          {primaryActionLabel}
        </Button>
        {onDismiss && (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
