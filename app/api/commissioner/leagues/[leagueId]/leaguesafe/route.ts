/**
 * A league's LeagueSafe connection (lib/leaguesafe/league-connection.ts). TRACKING ONLY: LeagueSafe
 * holds the money, and this reads LeagueSafe's own notices about it.
 *
 *   GET   commissioner: the AllFantasy address to add in LeagueSafe, the connection, and each
 *         LeagueSafe payer with what they owe and have paid.
 *   POST  commissioner, `{ action }`:
 *           connect     { lsLeagueName, duesAmount, dueDate? }   create or update the connection
 *           match       { memberId, teamId | null }              say which team a payer is
 *           disconnect                                           stop reading this league's notices
 *
 * Payer names and amounts are the commissioner's to see, so both verbs need the money area.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import {
  connectLeagueSafe, disconnectLeagueSafe, loadLeagueSafeView, readLeagueSafeConnectInput, setLeagueSafeMemberTeam,
} from '@/lib/leaguesafe/league-connection'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }

async function commissioner(ctx: Ctx) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const { leagueId } = await ctx.params
  const refused = await commissionerAccessResponse(leagueId, userId, 'money')
  if (refused) return { error: refused } as const
  return { leagueId, userId } as const
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const c = await commissioner(ctx)
  if ('error' in c) return c.error
  return NextResponse.json(await loadLeagueSafeView(c.leagueId), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const c = await commissioner(ctx)
  if ('error' in c) return c.error
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>

  if (body.action === 'connect') {
    const parsed = readLeagueSafeConnectInput(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    await connectLeagueSafe(c.leagueId, c.userId, parsed.input)
  } else if (body.action === 'match') {
    if (typeof body.memberId !== 'string' || !(body.teamId === null || typeof body.teamId === 'string')) {
      return NextResponse.json({ error: 'Pick a LeagueSafe member and a team.' }, { status: 400 })
    }
    const result = await setLeagueSafeMemberTeam(c.leagueId, body.memberId, body.teamId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  } else if (body.action === 'disconnect') {
    await disconnectLeagueSafe(c.leagueId)
  } else {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, ...(await loadLeagueSafeView(c.leagueId)) }, { headers: { 'Cache-Control': 'no-store' } })
}
