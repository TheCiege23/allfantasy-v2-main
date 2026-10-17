import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { activateSGLivePower } from '@/lib/survivor-guillotine/live'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ leagueId: string }> }

/** Private action endpoint for Huddle/DM; no public chat write or broad event payload. */
export async function POST(req: NextRequest, context: Context) {
  const userId = (await getServerSession(authOptions as never) as { user?: { id?: string } } | null)?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await context.params
  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null) as { message?: string } | null
  if (typeof body?.message !== 'string' || body.message.length > 1000) return NextResponse.json({ error: 'A short Chimmy command is required' }, { status: 400 })
  try {
    const result = await activateSGLivePower(leagueId, userId, body.message)
    if (!result) return NextResponse.json({ error: 'No Survivor Guillotine action found' }, { status: 400 })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Activation failed' }, { status: 409 })
  }
}
