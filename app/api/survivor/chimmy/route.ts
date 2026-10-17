import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parsePrivateVoteMention, submitPrivateVoteCommand } from '@/lib/survivor/survivorPrivateVoteCommand'
import { handleChimmyPrivateMessage } from '@/lib/survivor/chimmyHandler'
import { resolveLeagueAccess } from '@/lib/league-access'
import { activateSGLivePower } from '@/lib/survivor-guillotine/live'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leagueId?: string; message?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.leagueId !== 'string' || typeof body.message !== 'string' || !body.leagueId.trim() || !body.message.trim() || body.message.length > 2000) {
    return NextResponse.json({ error: 'leagueId and message required' }, { status: 400 })
  }

  // Membership before the handler: its idol-probe branch writes a host message for whatever
  // leagueId it is given. One 403 for not-found and not-member, so league existence is not leaked.
  const access = await resolveLeagueAccess(body.leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (/^@chimmy\s+(?:use|play)\s+(?:idol|token)\b/i.test(body.message)) {
    try {
      const action = await activateSGLivePower(body.leagueId, userId, body.message)
      if (action) return NextResponse.json({ reply: action.reply })
    } catch (error) {
      return NextResponse.json({ reply: error instanceof Error ? error.message : 'Power activation failed.' })
    }
  }

  if (parsePrivateVoteMention(body.message) || /^@chimmy\s+(?:i\s+)?vote\b/i.test(body.message.trim())) {
    const vote = await submitPrivateVoteCommand(body.leagueId, userId, body.message)
    if (!vote.ok) return NextResponse.json({ error: vote.error }, { status: vote.status })
    return NextResponse.json({ reply: vote.message, vote })
  }

  const reply = await handleChimmyPrivateMessage(body.leagueId, userId, body.message)
  return NextResponse.json({ reply })
}
