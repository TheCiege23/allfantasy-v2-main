import type { Metadata } from 'next'
import { V3PageShell } from '@/components/landing/v3/V3PageShell'

export const metadata: Metadata = {
  title: 'Platform Status | AllFantasy',
  description: 'Service status for AllFantasy and its platform integrations.',
}

/**
 * Intentionally a placeholder rather than a fake status board.
 *
 * Do NOT render green "all systems operational" indicators here until this page
 * is wired to a real health source — a status page that always reports healthy
 * is worse than no status page, because people rely on it during an incident.
 */
export default function ApiStatusPage() {
  return (
    <V3PageShell
      status="building"
      title="Platform status"
      lead="A live status board is on the way. We are not showing indicators until they are wired to real health checks — a status page that always says everything is fine is worse than none at all."
    />
  )
}
