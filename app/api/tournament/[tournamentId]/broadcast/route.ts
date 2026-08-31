import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { parseAudience } from '@/lib/tournament/broadcastAudience'
import { sendTournamentBroadcast } from '@/lib/tournament/sendTournamentBroadcast'

/**
 * Send one message to a slice of a tournament.
 *
 * ⚠ THE RESPONSE SEPARATES "SELECTED" FROM "DELIVERED" ON PURPOSE. In an
 * imported tournament most managers have no AllFantasy account, so a single
 * `ok: true` would tell a commissioner 240 people were messaged when 30 were.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let body: { audience?: string; title?: string; message?: string; scheduledFor?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const filter = parseAudience(String(body.audience ?? 'all'))
  if (!filter) {
    /* ⚠ An unrecognised audience is refused, never widened to everyone. */
    return NextResponse.json({ error: 'That audience is not one I recognise.' }, { status: 400 })
  }

  let scheduledFor: Date | null = null
  if (body.scheduledFor) {
    const parsed = new Date(body.scheduledFor)
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'That send time is not a valid date.' }, { status: 400 })
    }
    scheduledFor = parsed
  }

  const result = await sendTournamentBroadcast({
    tournamentId,
    commissionerUserId: userId,
    filter,
    title: String(body.title ?? ''),
    message: String(body.message ?? ''),
    scheduledFor,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
