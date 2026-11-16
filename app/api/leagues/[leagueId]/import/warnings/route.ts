import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listImportWarningsForLeague } from '@/lib/league-import/importReviewService'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  try {
    await assertCommissionerAccess(leagueId, userId, 'view')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const warnings = await listImportWarningsForLeague(leagueId)
  return NextResponse.json({ warnings })
}
