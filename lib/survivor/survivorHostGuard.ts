import 'server-only'

import { NextResponse } from 'next/server'
import { resolveSurvivorAccessContext } from './survivorAccessControl'

/** Human recovery tools require a non-playing host. Cron workers authenticate separately. */
export async function survivorHostGuard(leagueId: string, userId: string): Promise<NextResponse | null> {
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember || !access.decisions.canPerformSensitiveHostAction) {
    return NextResponse.json({ error: 'Manual game controls require a non-participating host. Playing commissioners use manager permissions.' }, { status: 403 })
  }
  return null
}
