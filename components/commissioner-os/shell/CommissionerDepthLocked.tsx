import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

/** A Commissioner OS page the viewer's plan does not include — lib/commissioner-ui/commissionerOsDepth.ts. */
export function CommissionerDepthLocked({ access, what }: { access: CoreDepthAccess; what: string }) {
  return (
    <CommissionerPageContainer variant="reading">
      <CoreDepthLock access={access} what={what} />
    </CommissionerPageContainer>
  )
}
