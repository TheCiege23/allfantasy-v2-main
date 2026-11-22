import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { listMemberThreads, openSupportThread } from '@/lib/support/supportInbox'
import { cleanPagePath, cleanSupportMessage, isSupportTopic } from '@/lib/support/supportInboxCore'

export const dynamic = 'force-dynamic'

/**
 * The member's support conversations (lib/support). Signed-in only: a reply has to reach someone.
 *   GET   → { threads }
 *   POST  { topic, message, pagePath? } → { threadId }
 */
async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const noStore = { 'cache-control': 'private, no-store' }

export async function GET() {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Sign in to see your conversations.' }, { status: 401, headers: noStore })
  return NextResponse.json({ threads: await listMemberThreads(userId) }, { headers: noStore })
}

export async function POST(req: Request) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Sign in to message us.' }, { status: 401, headers: noStore })
  const body = (await req.json().catch(() => null)) as { topic?: unknown; message?: unknown; pagePath?: unknown } | null
  if (!isSupportTopic(body?.topic)) return NextResponse.json({ error: 'Pick what this is about.', code: 'TOPIC' }, { status: 400, headers: noStore })
  const msg = cleanSupportMessage(body?.message)
  if (!msg.ok) return NextResponse.json({ error: msg.error === 'empty' ? 'Write a message first.' : 'That message is too long.', code: msg.error.toUpperCase() }, { status: 400, headers: noStore })
  const r = await openSupportThread({ userId, topic: body!.topic as never, text: msg.text, pagePath: cleanPagePath(body?.pagePath) })
  if (!r.ok) return NextResponse.json({ error: "You've started several conversations today. Reply in one of them and we'll see it.", code: 'RATE_LIMITED' }, { status: 429, headers: noStore })
  return NextResponse.json({ threadId: r.threadId }, { status: 201, headers: noStore })
}
