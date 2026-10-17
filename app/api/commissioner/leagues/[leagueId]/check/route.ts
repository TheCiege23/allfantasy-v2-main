import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'

export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const leagueId = params.leagueId
  if (!leagueId) return NextResponse.json({ error: 'League ID required' }, { status: 400 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await isCommissioner(leagueId, userId)
  return NextResponse.json({ isCommissioner: ok })
}
