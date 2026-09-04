import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { ReportsView } from '@/components/commissioner-os/reports/ReportsView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function ReportsPage() {
  const adapter = await getDecisionOSAdapter()
  const [templatesResponse, historyResponse] = await Promise.all([adapter.reports.getTemplates(), adapter.reports.getHistory()])

  return (
    <CommissionerPageContainer>
      <ReportsView
        templates={templatesResponse.data ?? []}
        history={historyResponse.data ?? []}
        dataMode={adapter.mode}
        errorMessage={templatesResponse.error?.message ?? historyResponse.error?.message}
      />
    </CommissionerPageContainer>
  )
}
