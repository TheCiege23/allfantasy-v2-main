import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CommissionerDepthLocked } from '@/components/commissioner-os/shell/CommissionerDepthLocked'
import { FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { resolveCommissionerOsDepth } from '@/lib/commissioner-ui/commissionerOsDepth'
import { LeagueAnalyticsView } from '@/components/commissioner-os/analytics/LeagueAnalyticsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function LeagueAnalyticsPage() {
  const depth = await resolveCommissionerOsDepth()
  if (!depth.unlocked) return <CommissionerDepthLocked access={depth} what="League analytics" />

  const adapter = await getDecisionOSAdapter()
  const response = await adapter.analytics.getSnapshot()

  return (
    <CommissionerPageContainer>
      <FreeUntilNote access={depth} />
      <LeagueAnalyticsView snapshot={response.data} dataMode={adapter.mode} errorMessage={response.error?.message} />
    </CommissionerPageContainer>
  )
}
