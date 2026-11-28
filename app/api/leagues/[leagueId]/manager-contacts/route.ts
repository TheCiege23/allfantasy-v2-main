import { NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { resolveLeagueAccess } from '@/lib/league-access'
import { listLeagueManagerContacts } from '@/lib/chat-core/leagueManagerContacts'
import { BlockListUnavailableError } from '@/lib/moderation/BlockUserService'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * GET /api/leagues/[leagueId]/manager-contacts
 *
 * `{ contacts: { [teamId]: { username, displayName, avatarUrl } } }` — who to message for each team in
 * this league (lib/chat-core/leagueManagerContacts.ts). Members of the league only: the same
 * membership predicate the standings route uses. A team with no AllFantasy manager, the viewer's own
 * team, and anyone blocked either way are simply absent, so the screen shows no Message button.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })

  const access = await resolveLeagueAccess(leagueId, user.appUserId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })

  try {
    const contacts = await listLeagueManagerContacts(leagueId, user.appUserId)
    return NextResponse.json({ contacts }, { headers: NO_STORE })
  } catch (err) {
    const kind = err instanceof BlockListUnavailableError ? 'block list unavailable' : err instanceof Error ? err.name : 'unknown'
    console.warn('[manager-contacts] read failed:', kind)
    return NextResponse.json({ error: 'Could not load managers right now.' }, { status: 503, headers: NO_STORE })
  }
}
