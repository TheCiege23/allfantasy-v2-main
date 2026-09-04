/**
 * Promoted out of Notification Center's own row component once Activity
 * Stream (and Mission Control's Recent Activity preview) needed the exact
 * same relative-time formatting — the same "a shape/behavior two
 * independently-owned things both need becomes a shared utility" rule
 * that already promoted the CSV primitives and `CommissionerRelatedLink`.
 */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.round(diffHours / 24)
  return `${diffDays}d ago`
}
