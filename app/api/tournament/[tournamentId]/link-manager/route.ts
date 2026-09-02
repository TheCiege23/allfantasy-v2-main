import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { linkParticipantToTeam } from '@/lib/tournament/linkManager'

/**
 * Link a tournament participant to the imported team row that is really theirs.
 *
 * ⚠ THE OWNERSHIP CHECK LIVES IN THE SERVICE, NOT HERE, and deliberately: the
 * participant id arrives in the body, so the scope has to be applied to the
 * QUERY that finds it rather than asserted afterwards. See `linkParticipantToTeam`.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let body: { leagueParticipantId?: string; externalId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const leagueParticipantId = String(body.leagueParticipantId ?? '').trim()
  const externalId = String(body.externalId ?? '').trim()
  if (!leagueParticipantId || !externalId) {
    return NextResponse.json(
      { error: 'leagueParticipantId and externalId are both required.' },
      { status: 400 },
    )
  }

  const result = await linkParticipantToTeam({
    tournamentId,
    commissionerUserId: userId,
    leagueParticipantId,
    externalId,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    userId: result.userId,
    note: 'Linked. The standings recompute from the team row — nothing was copied onto the manager.',
  })
}
