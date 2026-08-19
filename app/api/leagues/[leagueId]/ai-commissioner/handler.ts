import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getAICommissionerOverview } from '@/lib/ai-commissioner'

export const dynamic = 'force-dynamic'

function parseBoolean(value: string | null, fallback = false): boolean {
  if (value == null) return fallback
  const lowered = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(lowered)) return true
  if (['0', 'false', 'no', 'off'].includes(lowered)) return false
  return fallback
}

function parseIntSafe(value: string | null, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (Number.isFinite(n)) return n
  return fallback
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const overview = await getAICommissionerOverview({
    leagueId,
    sport: url.searchParams?.get('sport'),
    includeResolved: parseBoolean(url.searchParams?.get('includeResolved'), false),
    includeDismissed: parseBoolean(url.searchParams?.get('includeDismissed'), false),
    includeSnoozed: parseBoolean(url.searchParams?.get('includeSnoozed'), true),
    alertLimit: parseIntSafe(url.searchParams?.get('alertLimit'), 80),
    actionLimit: parseIntSafe(url.searchParams?.get('actionLimit'), 30),
  })

  return NextResponse.json(overview)
}
