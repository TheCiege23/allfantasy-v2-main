import { severityTokens, cssVar, type SeverityTier } from '@/lib/commissioner-ui/tokens/colors'
import type { CommissionerNotificationSeverity } from '@/lib/commissioner-ui/contracts'

/** Reuses the Phase 0.1 severity tokens directly — never a second color mapping. */
export function getSeverityStyle(tier: SeverityTier = 'standard') {
  const tokens = severityTokens[tier]
  return {
    text: cssVar(tokens.text),
    bg: cssVar(tokens.bg),
    border: cssVar(tokens.border),
  }
}

export const SEVERITY_LABELS: Record<SeverityTier, string> = {
  critical: 'Critical',
  elevated: 'Elevated',
  standard: 'Standard',
  advisory: 'Advisory',
  positive: 'Healthy',
}

/**
 * The *event* severity vocabulary (`CommissionerNotificationSeverity` —
 * informational/success/warning/critical), deliberately distinct from
 * the five-tier *condition* vocabulary above (see
 * `components/commissioner-os/README.md`'s "Severity vocabulary note").
 * Promoted here — rather than living inside Notification Center's own
 * label file — once Activity Stream needed the identical style/label
 * lookup for the identical severity type; this is the one shared home
 * for both, not a second copy.
 */
export function getEventSeverityStyle(severity: CommissionerNotificationSeverity) {
  switch (severity) {
    case 'critical':
      return getSeverityStyle('critical')
    case 'warning':
      return getSeverityStyle('elevated')
    case 'success':
      return getSeverityStyle('positive')
    case 'informational':
    default:
      return getSeverityStyle('standard')
  }
}

export const EVENT_SEVERITY_LABELS: Record<CommissionerNotificationSeverity, string> = {
  informational: 'Info',
  success: 'Success',
  warning: 'Warning',
  critical: 'Critical',
}
