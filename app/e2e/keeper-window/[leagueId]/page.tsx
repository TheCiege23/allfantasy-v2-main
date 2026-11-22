import { notFound } from 'next/navigation'
import { KeeperSelectionTab } from '@/app/league/[leagueId]/tabs/KeeperSelectionTab'
import { KeeperCommissionerDashboard } from '@/app/league/[leagueId]/components/KeeperCommissionerDashboard'

/**
 * The keeper window on its own: the REAL Keepers tab (`KeeperSelectionTab`) and, with `?view=commish`,
 * the commissioner's keeper dashboard, reading the same APIs with the viewer's own session. The whole
 * league page is too heavy to render in a small sandbox; this is the two screens without the shell.
 * Production is refused by app/e2e/layout.tsx; the check below is the redundant second guard.
 *
 *   /e2e/keeper-window/<leagueId>
 *   /e2e/keeper-window/<leagueId>?view=commish
 */
export default async function KeeperWindowHarnessPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { leagueId } = await params
  const { view } = await searchParams
  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      {view === 'commish' ? <KeeperCommissionerDashboard leagueId={leagueId} /> : <KeeperSelectionTab leagueId={leagueId} />}
    </main>
  )
}
