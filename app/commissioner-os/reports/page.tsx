import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CommissionerDepthLocked } from '@/components/commissioner-os/shell/CommissionerDepthLocked'
import { FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { resolveCommissionerOsDepth } from '@/lib/commissioner-ui/commissionerOsDepth'
import { ReportsView } from '@/components/commissioner-os/reports/ReportsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function ReportsPage() {
  const depth = await resolveCommissionerOsDepth()
  if (!depth.unlocked) return <CommissionerDepthLocked access={depth} what="Reports" />

  const adapter = await getDecisionOSAdapter()
  const [templatesResponse, historyResponse] = await Promise.all([adapter.reports.getTemplates(), adapter.reports.getHistory()])

  return (
    <CommissionerPageContainer>
      <FreeUntilNote access={depth} />
      <ReportsView
        templates={templatesResponse.data ?? []}
        history={historyResponse.data ?? []}
        dataMode={adapter.mode}
        errorMessage={templatesResponse.error?.message ?? historyResponse.error?.message}
      />
    </CommissionerPageContainer>
  )
}
