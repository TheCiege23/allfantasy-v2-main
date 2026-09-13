import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleChimmyPrivateMessage } from '@/lib/survivor/chimmyHandler'
import { resolveLeagueAccess } from '@/lib/league-access'

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

  if (!body.leagueId || !body.message) {
    return NextResponse.json({ error: 'leagueId and message required' }, { status: 400 })
  }

  // Membership before the handler: its idol-probe branch writes a host message for whatever
  // leagueId it is given. One 403 for not-found and not-member, so league existence is not leaked.
  const access = await resolveLeagueAccess(body.leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const reply = await handleChimmyPrivateMessage(body.leagueId, userId, body.message)
  return NextResponse.json({ reply })
}
