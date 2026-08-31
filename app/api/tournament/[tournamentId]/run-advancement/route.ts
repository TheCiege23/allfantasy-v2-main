import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { previewAdvancement } from '@/lib/tournament/advancementPreview'
import { runGuardedAdvancement } from '@/lib/tournament/runGuardedAdvancement'

/**
 * GET  — what advancement would do. Writes nothing.
 * POST — do it, but only on the numbers the caller says they read.
 *
 * ⚠ SEPARATE FROM `/api/tournament/advancement`, which runs immediately and
 * unguarded. That one stays for automation; this is the path behind a button.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const preview = await previewAdvancement(tournamentId, userId)
  if (!preview) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  return NextResponse.json(preview)
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  let body: { signature?: string; acknowledge?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const signature = String(body.signature ?? '').trim()
  if (!signature) {
    /* ⚠ No signature means the caller never read a preview. Refuse rather than
       treat it as "run whatever the numbers are now". */
    return NextResponse.json(
      { error: 'Confirm from a preview — this needs the signature it gave you.' },
      { status: 400 },
    )
  }

  const result = await runGuardedAdvancement({
    tournamentId,
    commissionerUserId: userId,
    expectedSignature: signature,
    acknowledge: Array.isArray(body.acknowledge) ? body.acknowledge.map(String) : [],
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, blockers: result.blockers, preview: result.preview },
      { status: result.status },
    )
  }
  return NextResponse.json(result)
}
