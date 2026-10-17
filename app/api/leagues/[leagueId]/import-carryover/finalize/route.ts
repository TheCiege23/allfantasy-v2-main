import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { finalizeImportedCarryover } from '@/lib/league-creation/canonical/finalizeImportedCarryover'

export const maxDuration = 120

export async function POST(_req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  try {
    await assertCommissioner(leagueId, session.user.id)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const result = await finalizeImportedCarryover(leagueId)
    return NextResponse.json(result, { status: result.complete ? 200 : 202 })
  } catch (error) {
    console.error('[import-carryover/finalize]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not finalize imported rosters.' }, { status: 500 })
  }
}
