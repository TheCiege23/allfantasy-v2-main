import 'server-only'

import type { ReactNode } from 'react'
import { getHomeInitialSession } from '@/lib/landing/get-home-initial-session'
import { resolveLaunchOfferForViewer } from '@/lib/monetization/foundingMemberServer'
import type { LaunchOfferView } from '@/lib/monetization/foundingMember'
import { LaunchOfferProvider } from '@/components/launch/LaunchOfferContext'

/**
 * The async half of the /pricing and /upgrade launch strip, mounted from each route's layout.
 *
 * Reads the session and (only while founding pricing is switched on) the account's creation date,
 * then hands the result to the client screens through LaunchOfferProvider. See LaunchOfferContext
 * for why this is a layout rather than a page prop.
 *
 * ⚠ A FAILED READ SHOWS LESS, NEVER MORE. If the session cannot be read the countdown still shows
 * (it depends only on the launch instant) but no founding line does: telling a signed-in customer
 * to "sign up before Oct 15", or promising a discount to an account we could not check, is worse
 * than saying nothing.
 */
export async function LaunchOfferLayout({ children }: { children: ReactNode }) {
  let offer: LaunchOfferView | null = null
  try {
    const session = await getHomeInitialSession()
    const userId = (session?.user as { id?: unknown } | undefined)?.id
    offer = await resolveLaunchOfferForViewer(typeof userId === 'string' ? userId : null)
  } catch (error) {
    console.error('[launch-offer] viewer lookup failed', error instanceof Error ? error.message : String(error))
    const fallback = await resolveLaunchOfferForViewer(null).catch(() => null)
    offer = fallback ? { ...fallback, founding: null } : null
  }
  return <LaunchOfferProvider offer={offer}>{children}</LaunchOfferProvider>
}

export default LaunchOfferLayout
