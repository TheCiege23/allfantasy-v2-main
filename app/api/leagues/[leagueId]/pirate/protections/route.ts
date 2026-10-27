import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { savePirateProtections } from '@/lib/pirate/service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const actorUserId = session?.user?.id
  if (!actorUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { rosterId?: unknown; week?: unknown; playerIds?: unknown }
  if (typeof body.rosterId !== 'string' || !Number.isInteger(body.week) ||
      !Array.isArray(body.playerIds) || body.playerIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'rosterId, week and playerIds are required.' }, { status: 400 })
  }
  try {
    const result = await savePirateProtections({
      leagueId, actorUserId, rosterId: body.rosterId, week: Number(body.week), playerIds: body.playerIds as string[],
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save protections' }, { status: 400 })
  }
}
