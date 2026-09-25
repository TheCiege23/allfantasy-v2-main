import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { confirmChimmyAction } from '@/lib/chimmy/actions/confirmAction'

export const dynamic = 'force-dynamic'

/**
 * POST /api/chimmy/actions/confirm — the user tapped Confirm on a Chimmy action card.
 *
 * Body: `{ token }` and nothing else. The token is the card's signed authority; every fact the move
 * depends on is re-read and re-validated server-side (`confirmChimmyAction`). Anything else the
 * client sends is ignored — which is the point: an edited card cannot change what runs.
 *
 * No token spend: the answer that produced the card was already charged, and a tap that makes the
 * move the user asked for is not a second answer.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ ok: false, status: 'invalid', message: 'Sign in to confirm this.' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: unknown }
  const result = await confirmChimmyAction({ token: body?.token, userId })
  const httpStatus =
    result.status === 'executed' || result.status === 'already_executed'
      ? 200
      : result.status === 'invalid'
        ? 400
        : result.status === 'expired'
          ? 410
          : 409
  return NextResponse.json(result, { status: httpStatus })
}
