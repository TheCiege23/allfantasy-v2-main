import type { ReactNode } from 'react'
import { LaunchOfferLayout } from '@/components/launch/LaunchOfferLayout'

/*
 * Supplies the launch countdown and the viewer's founding-member offer to PricingV4
 * (components/launch/LaunchOfferContext.tsx). The page itself stays synchronous.
 */
export default function PricingLayout({ children }: { children: ReactNode }) {
  return <LaunchOfferLayout>{children}</LaunchOfferLayout>
}
