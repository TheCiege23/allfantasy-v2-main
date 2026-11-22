import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { getMemberThread, memberReply } from '@/lib/support/supportInbox'
import { cleanSupportMessage } from '@/lib/support/supportInboxCore'

export const dynamic = 'force-dynamic'

/**
 * One of the member's own support conversations. Anyone else's answers 404, never 403, so ids cannot be probed.
 *   GET   → { thread }
 *   POST  { message } → { ok }
 */
async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const noStore = { 'cache-control': 'private, no-store' }
type Ctx = { params: Promise<{ threadId: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Sign in to see this conversation.' }, { status: 401, headers: noStore })
  const { threadId } = await ctx.params
  const thread = await getMemberThread(userId, threadId)
  if (!thread) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404, headers: noStore })
  return NextResponse.json({ thread }, { headers: noStore })
}

export async function POST(req: Request, ctx: Ctx) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Sign in to reply.' }, { status: 401, headers: noStore })
  const { threadId } = await ctx.params
  const body = (await req.json().catch(() => null)) as { message?: unknown } | null
  const msg = cleanSupportMessage(body?.message)
  if (!msg.ok) return NextResponse.json({ error: msg.error === 'empty' ? 'Write a message first.' : 'That message is too long.', code: msg.error.toUpperCase() }, { status: 400, headers: noStore })
  const r = await memberReply({ userId, threadId, text: msg.text })
  if (!r.ok) {
    return r.error === 'not_found'
      ? NextResponse.json({ error: 'Conversation not found.' }, { status: 404, headers: noStore })
      : NextResponse.json({ error: "You've sent a lot of messages today. We'll catch up — try again tomorrow.", code: 'RATE_LIMITED' }, { status: 429, headers: noStore })
  }
  return NextResponse.json({ ok: true }, { headers: noStore })
}
