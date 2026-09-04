import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { ManagerIntelligenceView } from '@/components/commissioner-os/managers/ManagerIntelligenceView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function ManagerIntelligencePage() {
  const adapter = await getDecisionOSAdapter()
  const response = await adapter.managers.getManagerDirectory()

  return (
    <CommissionerPageContainer>
      <ManagerIntelligenceView managers={response.data ?? []} dataMode={adapter.mode} />
    </CommissionerPageContainer>
  )
}
