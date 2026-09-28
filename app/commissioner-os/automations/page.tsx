import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CommissionerDepthLocked } from '@/components/commissioner-os/shell/CommissionerDepthLocked'
import { FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { resolveCommissionerOsDepth } from '@/lib/commissioner-ui/commissionerOsDepth'
import { AutomationCenterView } from '@/components/commissioner-os/automations/AutomationCenterView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'
import type { AutomationExecutionEntry } from '@/lib/commissioner-ui/adapter'

export default async function AutomationCenterPage() {
  const depth = await resolveCommissionerOsDepth()
  if (!depth.unlocked) return <CommissionerDepthLocked access={depth} what="The automation center" />

  const adapter = await getDecisionOSAdapter()
  const catalogResponse = await adapter.automations.getCatalog()
  const catalog = catalogResponse.data ?? []

  const historyResponses = await Promise.all(catalog.map((automation) => adapter.automations.getExecutionHistory(automation.id)))
  const historyByAutomationId: Record<string, AutomationExecutionEntry[]> = {}
  catalog.forEach((automation, index) => {
    historyByAutomationId[automation.id] = historyResponses[index].data ?? []
  })

  return (
    <CommissionerPageContainer>
      <FreeUntilNote access={depth} />
      <AutomationCenterView
        catalog={catalog}
        historyByAutomationId={historyByAutomationId}
        dataMode={adapter.mode}
        errorMessage={catalogResponse.error?.message}
      />
    </CommissionerPageContainer>
  )
}
