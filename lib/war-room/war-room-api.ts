import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { canUseWarRoomAi, loadWarRoomAiContext } from './war-room-context'

export async function requireUserId(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { ok: true, userId: session.user.id }
}

export async function requireLeagueWarRoom(
  leagueId: string | undefined,
  userId: string,
  feature: Parameters<typeof canUseWarRoomAi>[1]
): Promise<
  | { ok: true; ctx: NonNullable<Awaited<ReturnType<typeof loadWarRoomAiContext>>> }
  | { ok: false; response: NextResponse }
> {
  if (!leagueId?.trim()) {
    return { ok: false, response: NextResponse.json({ error: 'leagueId is required' }, { status: 400 }) }
  }
  try {
    await assertLeagueMember(leagueId, userId)
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const ctx = await loadWarRoomAiContext(leagueId, userId)
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: 'League not found' }, { status: 404 }) }
  }
  if (!canUseWarRoomAi(ctx, feature)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'War Room Chimmy is disabled for this league or feature. Enable in league settings or upgrade.',
          code: 'war_room_disabled',
        },
        { status: 403 }
      ),
    }
  }
  return { ok: true, ctx }
}
