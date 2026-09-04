import { getEventSeverityStyle, EVENT_SEVERITY_LABELS } from '@/components/commissioner-os/cards/severityStyles'
import { getModuleLabel } from '@/lib/commissioner-ui/navigation/moduleNav'
import { MODULE_ICONS } from '@/components/commissioner-os/shell/CommissionerSidebar'

/**
 * Thin re-exports under this module's own established names — the actual
 * severity style/label and module-label lookups were promoted to shared
 * homes (`components/commissioner-os/cards/severityStyles.ts` and
 * `lib/commissioner-ui/navigation/moduleNav.ts`) once Activity Stream
 * needed the identical lookups for the identical types. Nothing that
 * already imports from this file needed to change.
 */
export const NOTIFICATION_SEVERITY_LABELS = EVENT_SEVERITY_LABELS
export const getNotificationSeverityStyle = getEventSeverityStyle
export { getModuleLabel }
export { MODULE_ICONS as NOTIFICATION_SOURCE_ICONS }
