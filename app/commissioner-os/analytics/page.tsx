import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { LeagueAnalyticsView } from '@/components/commissioner-os/analytics/LeagueAnalyticsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function LeagueAnalyticsPage() {
  const adapter = await getDecisionOSAdapter()
  const response = await adapter.analytics.getSnapshot()

  return (
    <CommissionerPageContainer>
      <LeagueAnalyticsView snapshot={response.data} dataMode={adapter.mode} errorMessage={response.error?.message} />
    </CommissionerPageContainer>
  )
}
