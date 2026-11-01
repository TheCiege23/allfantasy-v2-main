import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { executeMerge } from '@/lib/devy/mergeExecutionEngine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { sessionId?: string }
  const sessionId = body.sessionId?.trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const gate = await assertLeagueCommissioner(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  // A second merge of the same session would write its history seasons again. Re-importing
  // means starting a new session.
  if (row.status === 'merged') {
    return NextResponse.json({ error: 'Session already merged', code: 'already_merged' }, { status: 409 })
  }

  await prisma.devyImportSession.update({
    where: { id: sessionId },
    data: { approvedAt: new Date(), status: 'approved' },
  })

  // executeMerge looks the session up by its creator. The gate above already allows any
  // commissioner or co-commissioner, so pass the creator rather than the caller — otherwise a
  // co-commissioner who did not open the session is told it does not exist.
  const result = await executeMerge(sessionId, row.commissionerId)
  return NextResponse.json({ result })
}
