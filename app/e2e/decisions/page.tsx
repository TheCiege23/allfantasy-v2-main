import { notFound } from 'next/navigation'
import AfCoreShell from '@/components/core-app/AfCoreShell'
import { DecisionLogHarnessClient } from './DecisionLogHarnessClient'

/**
 * DB-free render of /core/decisions (2026-11-26) inside the real AfCoreShell. Every row is SAMPLE data
 * (./fixtures.ts) fed to the real screen through its `load` prop — no /api/ call, no database. Production
 * is refused by app/e2e/layout.tsx and again here.
 *
 *   /e2e/decisions                  a Pro viewer with five decisions (graded, withheld, not recorded, waiver, proposals)
 *   /e2e/decisions?state=empty      no decisions logged yet
 *   /e2e/decisions?state=loading    the skeleton
 *   /e2e/decisions?state=error      the read failed
 *   /e2e/decisions?state=locked     a free or AF Commissioner-only viewer: the page's server-drawn lock
 *   /e2e/decisions?state=denied     the route's 403 after the page loaded: the same lock, from the read
 */
export default async function DecisionLogHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const state = typeof sp.state === 'string' ? sp.state : 'ready'
  return (
    <AfCoreShell
      active="decisions"
      leagues={[]}
      selectedLeagueId={null}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="decision-log-harness">
        <DecisionLogHarnessClient state={state} />
      </div>
    </AfCoreShell>
  )
}
