import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NativeUndoRefusal, previewNativeUndo, undoNativeConversion } from '@/lib/league/undoNativeConversion'

export const dynamic = 'force-dynamic'

/**
 * Undo a switch to AllFantasy (docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §8, step 6;
 * lib/league/undoNativeConversion.ts). The league's head commissioner only, like the switch itself.
 *
 * GET  — what undo would do now: `{ status: 'none' | 'closed' | 'open', … }`, with the list it throws away and a token.
 * POST — `{ "token": "<from GET>" }`. 409 when undo is closed, or when the league changed since the GET (the body
 *        then carries the fresh preview, so the commissioner confirms what is actually there).
 */
async function authorize(ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  if (!leagueId) return { response: NextResponse.json({ error: 'Missing leagueId' }, { status: 400 }) }
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const refused = await commissionerAccessResponse(leagueId, userId, 'head')
  if (refused) return { response: refused }
  return { leagueId, userId }
}

export async function GET(_req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const auth = await authorize(ctx)
  if ('response' in auth) return auth.response
  const preview = await previewNativeUndo(prisma, auth.leagueId)
  return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request, ctx: { params: Promise<{ leagueId: string }> }) {
  const auth = await authorize(ctx)
  if ('response' in auth) return auth.response
  const body = (await req.json().catch(() => ({}))) as { token?: unknown }
  if (typeof body.token !== 'string' || !body.token) {
    return NextResponse.json({ error: 'Confirm the list of what undo throws away first.' }, { status: 400 })
  }
  try {
    const result = await undoNativeConversion(prisma, { leagueId: auth.leagueId, userId: auth.userId, token: body.token })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof NativeUndoRefusal) {
      return NextResponse.json({ error: error.message, code: error.code, preview: error.preview ?? null }, { status: error.code === 'none' ? 404 : 409 })
    }
    console.error('[convert-to-native/undo] failed', JSON.stringify({ leagueId: auth.leagueId, error: error instanceof Error ? error.message : String(error) }))
    return NextResponse.json({ error: 'Undo did not complete, and nothing was changed. Try again, or contact support.' }, { status: 500 })
  }
}
