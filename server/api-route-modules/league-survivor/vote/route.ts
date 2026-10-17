/**
 * POST /api/leagues/[leagueId]/survivor/vote
 * Cast or update the requesting user's vote before council lock.
 * Requires voterRosterId + targetRosterId in addition to userId/targetUserId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { submitPrivateVoteCommand } from '@/lib/survivor/survivorPrivateVoteCommand'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status ?? 403 })

  let body: { message?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const result = await submitPrivateVoteCommand(leagueId, userId, typeof body.message === 'string' ? body.message : '')
  return NextResponse.json(result, { status: result.ok ? 200 : result.status })
}
