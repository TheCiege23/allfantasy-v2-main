/**
 * Commissioner OS's share of the /core depth paywall (lib/core-app/coreDepthAccess.ts).
 *
 * Commissioner OS is the AF Commissioner product: Mission Control, analytics, reports, league
 * health, manager intelligence, the activity stream, recommendations and the automation centre.
 * The pages a commissioner needs to RUN a league — workspace tasks, settings, help, search and
 * notifications — stay free, as does everything on the /core Commissioner hub that is not depth.
 *
 * ⚠ EACH GATED PAGE CALLS THIS BEFORE ITS ADAPTER READS, not the layout. The layout cannot see
 * which page it wraps, and a page that loads its data and then draws a lock has gated nothing.
 *
 * ⚠ NOT THE AUTHORISATION CHECK. The layout still decides whether this is a commissioner at all;
 * this only decides whether their plan includes the depth.
 */
import 'server-only'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

export async function resolveCommissionerOsDepth(): Promise<CoreDepthAccess> {
  const session = (await getServerSession(authOptions as never).catch(() => null)) as {
    user?: { id?: string; email?: string | null }
  } | null
  return resolveCoreDepth(session?.user?.id ?? null, 'commissioner_depth', {
    email: session?.user?.email ?? null,
  })
}
