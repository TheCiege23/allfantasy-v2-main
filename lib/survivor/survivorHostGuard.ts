import 'server-only'

import { NextResponse } from 'next/server'
import { resolveSurvivorAccessContext, survivorFinaleControlAccess, type SurvivorFinaleControlAccess } from './survivorAccessControl'

/** Human recovery tools require a non-playing host. Cron workers authenticate separately. */
export async function survivorHostGuard(leagueId: string, userId: string): Promise<NextResponse | null> {
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember || !access.decisions.canPerformSensitiveHostAction) {
    return NextResponse.json({ error: 'Manual game controls require a non-participating host. Playing commissioners use manager permissions.' }, { status: 403 })
  }
  return null
}

/**
 * The finale controls' guard: any commissioner (playing or not), with the viewer's finale role so a
 * commissioner who is a finalist or juror sees only what that role allows (survivorFinaleControlAccess).
 */
export async function survivorFinaleControlGuard(leagueId: string, userId: string): Promise<{ error: NextResponse | null; access: SurvivorFinaleControlAccess }> {
  const access = survivorFinaleControlAccess(await resolveSurvivorAccessContext(leagueId, userId))
  if (!access.canConfigure) return { error: NextResponse.json({ error: 'Only the commissioner can change the finale.' }, { status: 403 }), access }
  return { error: null, access }
}
