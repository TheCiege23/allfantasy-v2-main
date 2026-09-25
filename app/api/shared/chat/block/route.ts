import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { blockUserInSharedThreads } from '@/lib/platform/chat-service'
import { addBlock } from '@/lib/moderation'

export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const blockedUserId = String(body?.blockedUserId || '').trim()
  if (!blockedUserId) {
    return NextResponse.json({ error: 'blockedUserId is required' }, { status: 400 })
  }
  if (blockedUserId === user.appUserId) {
    return NextResponse.json({ error: 'Cannot block yourself' }, { status: 400 })
  }

  const ok = await addBlock(user.appUserId, blockedUserId)
  /*
   * 🛑 A FAILED BLOCK IS NOT A 200. `addBlock` swallows its own error and returns false, and this
   * used to answer `status: 'ok'` regardless — so the drawer would say "Blocked" while nothing was
   * written and the person kept reaching you. The block list is the part that hides their
   * messages everywhere; without it there is nothing to report as done.
   */
  if (!ok) {
    return NextResponse.json({ error: 'Could not block that person. Try again.' }, { status: 500 })
  }
  const affectedThreads = await blockUserInSharedThreads(user.appUserId, blockedUserId)
  return NextResponse.json({ status: 'ok', affectedThreads })
}
