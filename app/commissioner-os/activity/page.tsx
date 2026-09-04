import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { ActivityStreamView } from '@/components/commissioner-os/activity/ActivityStreamView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

/**
 * Server Component — fetches through the Decision OS Adapter Layer, same
 * as every other module page. Universal Activity Stream owns the full
 * chronological record; Mission Control's own "Recent Activity" card
 * previews a slice of this exact data (see app/commissioner-os/page.tsx),
 * never a separate copy.
 */
export default async function ActivityStreamPage() {
  const adapter = await getDecisionOSAdapter()
  const eventsResponse = await adapter.activity.getEvents()

  return (
    <CommissionerPageContainer>
      <ActivityStreamView
        events={eventsResponse.data ?? []}
        dataMode={adapter.mode}
        errorMessage={eventsResponse.data ? null : eventsResponse.error?.message}
      />
    </CommissionerPageContainer>
  )
}
