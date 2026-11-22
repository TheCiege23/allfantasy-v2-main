import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveDuplicateManagerFlag, type DuplicateManagerFlagAction } from '@/lib/identity/DuplicateManagerFlagService'

type SessionWithUser = { user?: { id?: string } } | null

const VALID_ACTIONS: DuplicateManagerFlagAction[] = ['allow', 'block', 'household', 'verification_requested']

/** POST: commissioner/co-commissioner resolves a "possible duplicate manager" flag. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leagueId: string; flagId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as SessionWithUser
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId, flagId } = await params

  const refused = await commissionerAccessResponse(leagueId, userId, 'league')
  if (refused) return refused

  const body = await req.json().catch(() => ({}))
  const action = typeof body.action === 'string' ? body.action : null
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null
  if (!action || !VALID_ACTIONS.includes(action as DuplicateManagerFlagAction)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const result = await resolveDuplicateManagerFlag({
    flagId,
    leagueId,
    action: action as DuplicateManagerFlagAction,
    commissionerUserId: userId,
    commissionerNote: note,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ ok: true, joinCompleted: result.joinCompleted })
}
