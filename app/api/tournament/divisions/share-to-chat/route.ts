import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-guard'
import { postShareCardToLeagueChat, ShareToChatError } from '@/lib/tournament/divisions/shareToChat'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ID = /^[a-zA-Z0-9_-]{1,200}$/

/**
 * POST /api/tournament/divisions/share-to-chat — multipart `tournamentId`, `entryId` and an optional
 * `file` (the card PNG the share studio rendered). Posts it into the caller's own conference league
 * chat, once per card moment. Non-members get 403.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  const tournamentId = String(form.get('tournamentId') ?? '').trim()
  const entryId = String(form.get('entryId') ?? '').trim()
  if (!ID.test(tournamentId) || !ID.test(entryId)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const file = form.get('file')
  try {
    const result = await postShareCardToLeagueChat({ userId: auth.userId, tournamentId, entryId, image: file instanceof Blob ? file : null })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof ShareToChatError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[api/tournament/divisions/share-to-chat] post failed')
    return NextResponse.json({ error: 'Could not post to league chat. Try again.' }, { status: 500 })
  }
}
