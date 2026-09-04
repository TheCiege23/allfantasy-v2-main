import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { WorkspaceView } from '@/components/commissioner-os/workspace/WorkspaceView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function WorkspacePage() {
  const adapter = await getDecisionOSAdapter()
  const response = await adapter.workspace.getTasks()

  return (
    <CommissionerPageContainer>
      <WorkspaceView tasks={response.data ?? []} dataMode={adapter.mode} errorMessage={response.error?.message} />
    </CommissionerPageContainer>
  )
}
