import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { updateTournamentSettings } from '@/lib/tournament/updateTournamentSettings'

/**
 * Change a tournament's rules after creation.
 *
 * ⚠ PATCH, NOT PUT — an omitted field means "leave it alone", not "clear it". A
 * form that posts only what changed must not blank the cut size because it did
 * not send one.
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  /* Only forward keys the caller actually sent, so the PATCH semantics above
     survive the trip through this route. */
  const num = (v: unknown) => (v === undefined ? undefined : Number(v))
  const result = await updateTournamentSettings({
    tournamentId,
    commissionerUserId: userId,
    patch: {
      name: body.name === undefined ? undefined : String(body.name),
      advancersPerLeague: num(body.advancersPerLeague),
      wildcardCount: num(body.wildcardCount),
      bubbleEnabled: body.bubbleEnabled === undefined ? undefined : Boolean(body.bubbleEnabled),
      bubbleSize: num(body.bubbleSize),
      tiebreakerMode:
        body.tiebreakerMode === undefined ? undefined : String(body.tiebreakerMode),
      conferenceNames: Array.isArray(body.conferenceNames)
        ? (body.conferenceNames as Array<{ id?: unknown; name?: unknown }>).map((c) => ({
            id: String(c?.id ?? ''),
            name: String(c?.name ?? ''),
          }))
        : undefined,
    },
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    ok: true,
    alreadyAdvanced: result.alreadyAdvanced,
    note: result.alreadyAdvanced
      ? 'Saved. An advancement has already run, so this changes where the line is drawn from here — it does not move anyone who has already advanced or been eliminated.'
      : 'Saved.',
  })
}
