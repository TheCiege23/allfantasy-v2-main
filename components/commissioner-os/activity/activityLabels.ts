import { getEventSeverityStyle, EVENT_SEVERITY_LABELS } from '@/components/commissioner-os/cards/severityStyles'
import { getModuleLabel } from '@/lib/commissioner-ui/navigation/moduleNav'
import { MODULE_ICONS } from '@/components/commissioner-os/shell/CommissionerSidebar'

/**
 * Imports the same shared severity/module lookups Notification Center
 * uses — promoted to shared homes specifically so this module could
 * reuse them without reaching into Notification Center's own directory.
 * Activity Stream owns none of these lookups itself.
 */
export { getEventSeverityStyle as getActivitySeverityStyle, EVENT_SEVERITY_LABELS as ACTIVITY_SEVERITY_LABELS }
export { getModuleLabel }
export { MODULE_ICONS as ACTIVITY_SOURCE_ICONS }
