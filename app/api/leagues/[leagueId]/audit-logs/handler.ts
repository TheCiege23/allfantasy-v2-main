import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAuditLogs } from '@/server/services/auditService'
import { resolveLeagueAccess } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLeagueAccess(params.leagueId, userId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || '40')))
  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined
  const types = req.nextUrl.searchParams.get('types')?.split(',').filter(Boolean)

  const { items, nextCursor } = await getAuditLogs(params.leagueId, {
    limit,
    cursor,
    actionTypes: types?.length ? types : undefined,
  })

  return NextResponse.json({ items, nextCursor })
}
