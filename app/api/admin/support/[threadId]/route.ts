import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/adminAuth'
import { getStaffThread, setSupportStatus, staffReply } from '@/lib/support/supportInbox'
import { cleanSupportMessage } from '@/lib/support/supportInboxCore'

export const dynamic = 'force-dynamic'

/**
 * One support conversation, for an admin.
 *   GET                         → { thread }
 *   POST  { message }           → reply as AllFantasy Support (the member is notified)
 *   PATCH { status: closed|open } → close or reopen
 */
type Ctx = { params: Promise<{ threadId: string }> }
const noStore = { 'cache-control': 'private, no-store' }

export async function GET(_req: Request, ctx: Ctx) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const thread = await getStaffThread((await ctx.params).threadId)
  if (!thread) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404, headers: noStore })
  return NextResponse.json({ thread }, { headers: noStore })
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = (await req.json().catch(() => null)) as { message?: unknown } | null
  const msg = cleanSupportMessage(body?.message)
  if (!msg.ok) return NextResponse.json({ error: msg.error === 'empty' ? 'Write a reply first.' : 'That reply is too long.' }, { status: 400, headers: noStore })
  const r = await staffReply({ adminUserId: gate.user?.id ?? null, threadId: (await ctx.params).threadId, text: msg.text })
  if (!r.ok) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404, headers: noStore })
  return NextResponse.json({ ok: true }, { headers: noStore })
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = (await req.json().catch(() => null)) as { status?: unknown } | null
  if (body?.status !== 'closed' && body?.status !== 'open') return NextResponse.json({ error: 'status must be closed or open' }, { status: 400, headers: noStore })
  const r = await setSupportStatus({ adminUserId: gate.user?.id ?? null, threadId: (await ctx.params).threadId, to: body.status })
  if (!r.ok) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404, headers: noStore })
  return NextResponse.json({ ok: true }, { headers: noStore })
}
