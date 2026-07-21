import type { ReactNode } from 'react'
import ProductShellLayout from '@/components/navigation/ProductShellLayout'

/**
 * The Players route keeps the global chrome (top nav + right rail), unlike
 * `/dashboard`, which hides both and supplies its own bespoke header. Players is a
 * destination reached from the primary nav, so the nav needs to stay visible for a
 * user to move on to Trades, Waivers, or their leagues.
 */
export default function PlayersLayout({ children }: { children: ReactNode }) {
  return <ProductShellLayout>{children}</ProductShellLayout>
}
