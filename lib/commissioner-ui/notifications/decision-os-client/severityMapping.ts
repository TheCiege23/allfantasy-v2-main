import type { CommissionerNotificationSeverity } from '../../contracts'
import type { SeverityTier } from '../../tokens/colors'

/**
 * Notifications use the *event* severity vocabulary
 * (informational/success/warning/critical), never the *condition*
 * severity vocabulary (critical/elevated/standard/advisory/positive)
 * League Health, Recommendations, and Automations use — see
 * `components/commissioner-os/README.md`'s "Severity vocabulary note."
 * This is the one, explicit place a condition tier is translated into an
 * event severity for a notification; nowhere else conflates the two.
 * Shared by `demo.ts` and `live.ts` so the mapping is defined once.
 */
export function conditionToEventSeverity(tier: SeverityTier): CommissionerNotificationSeverity {
  switch (tier) {
    case 'critical':
      return 'critical'
    case 'elevated':
      return 'warning'
    case 'positive':
      return 'success'
    case 'standard':
    case 'advisory':
    default:
      return 'informational'
  }
}
