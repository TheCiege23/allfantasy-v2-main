import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-guard'
import { getBlobReadWriteToken } from '@/lib/blob/readWriteToken'

export const dynamic = 'force-dynamic'

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])
const VOICE_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'])

const MAX_IMAGE = 25 * 1024 * 1024
const MAX_VIDEO = 100 * 1024 * 1024
const MAX_VOICE = 5 * 1024 * 1024

function toStringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/**
 * Membership of a platform chat thread — the DM and huddle equivalent of
 * `canAccessLeague`.
 *
 * ⚠ WITHOUT THIS, UPLOADS WERE LEAGUE-ONLY. The route required a `leagueId` and
 * 400'd without one, so attaching an image in a DM or a huddle failed with
 * "leagueId required" — a message about a concept those chats do not have. The
 * gate is the same shape as the league one: prove the caller is IN the thread,
 * never just that the thread exists.
 */
async function canAccessThread(threadId: string, userId: string) {
  const member = await prisma.platformChatThreadMember.findFirst({
    where: { threadId, userId },
    select: { id: true },
  })
  return Boolean(member)
}

async function canAccessLeague(leagueId: string, userId: string) {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      teams: { select: { claimedByUserId: true } },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return league.teams.some((team) => team.claimedByUserId === userId)
}

/**
 * 🛑 THE GATE IS A SESSION PLUS MEMBERSHIP, NOT AGE CONFIRMATION.
 *
 * This used `requireVerifiedUser`, which demands `ageConfirmedAt` as well as a verified
 * email or phone. `lib/auth.ts` never writes `ageConfirmedAt` on an OAuth sign-in, so every
 * Google account that had not separately confirmed its age got a 403 `AGE_REQUIRED` trying
 * to attach an image in a league chat — the same defect that stopped those accounts setting
 * a profile picture, on a different surface.
 *
 * ⚠ THE REAL AUTHORIZATION IS `canAccessLeague` / `canAccessThread` BELOW, and neither is
 * weakened here: the caller must still prove they are IN the league or the thread they are
 * uploading to. Age confirmation added nothing to that — it gates bracket entry and the
 * legal panel, which are the surfaces that genuinely need it.
 *
 * This route was also the odd one out. Its two siblings, `app/api/shared/chat/upload` and
 * `app/api/bracket/chat-upload`, are both session-only. Three chat upload routes with three
 * different answers to "who may attach a file" is how one of them ends up wrong without
 * anybody noticing.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const userId = auth.userId

  if (!getBlobReadWriteToken()) {
    return NextResponse.json({ url: null, error: 'Storage not configured' }, { status: 503 })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const type = toStringValue(formData.get('type')).trim() as 'image' | 'video' | 'voice'
  const leagueId = toStringValue(formData.get('leagueId')).trim()

  const threadId = toStringValue(formData.get('threadId')).trim()

  /*
   * 🛑 THE `purpose=profile` BYPASS IS GONE, AND REMOVING IT TIGHTENS THIS ROUTE.
   *
   * It existed so the settings page could upload an avatar here, and it worked by skipping
   * the leagueId/threadId requirement entirely — the one check that proves the caller
   * belongs anywhere. Avatars now go to `/api/user/profile/avatar`, so nothing sends
   * `purpose=profile` any more: the only remaining references were inside this file.
   *
   * Left in place it would be an unauthenticated-by-membership write path with no
   * legitimate caller, which is exactly the kind of thing that gets found later by someone
   * who is not us. Every upload now has to name a league or a thread and prove access to it.
   */
  if (!leagueId && !threadId) {
    return NextResponse.json({ error: 'leagueId or threadId required' }, { status: 400 })
  }
  if (leagueId && !(await canAccessLeague(leagueId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!leagueId && threadId && !(await canAccessThread(threadId, userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  if (type !== 'image' && type !== 'video' && type !== 'voice') {
    return NextResponse.json({ error: 'type must be image, video, or voice' }, { status: 400 })
  }

  const mimeType = file.type || 'application/octet-stream'
  const size = file.size

  if (type === 'image') {
    if (!IMAGE_TYPES.has(mimeType)) {
      return NextResponse.json({ error: 'Invalid image type' }, { status: 400 })
    }
    if (size > MAX_IMAGE) {
      return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 400 })
    }
  } else if (type === 'video') {
    if (!VIDEO_TYPES.has(mimeType)) {
      return NextResponse.json({ error: 'Invalid video type' }, { status: 400 })
    }
    if (size > MAX_VIDEO) {
      return NextResponse.json({ error: 'Video too large (max 100MB)' }, { status: 400 })
    }
  } else {
    if (!VOICE_TYPES.has(mimeType)) {
      return NextResponse.json({ error: 'Invalid audio type' }, { status: 400 })
    }
    if (size > MAX_VOICE) {
      return NextResponse.json({ error: 'Voice note too large (max 5MB)' }, { status: 400 })
    }
  }

  const filename =
    typeof (file as File).name === 'string' && (file as File).name
      ? (file as File).name.replace(/[^a-zA-Z0-9._-]/g, '_')
      : 'upload.bin'

  // Every upload is now league- or thread-scoped; the `profile/` prefix went with the
  // bypass above, since avatars are written by /api/user/profile/avatar under `avatars/`.
  const key = leagueId
    ? `chat/${leagueId}/${type}/${Date.now()}-${filename}`
    : `chat/thread/${threadId}/${type}/${Date.now()}-${filename}`

  try {
    // Public access so chat UI can render images / audio / video inline via direct HTTPS URLs.
    // Persist `blob.url` in LeagueChatMessage.metadata (or imageUrl) as returned — do not replace with signed or proxied URLs.
    const blob = await put(key, file, {
      access: 'public',
      contentType: mimeType,
      token: getBlobReadWriteToken(),
    })

    return NextResponse.json({
      url: blob.url,
      type,
      mimeType,
      size,
    })
  } catch (e) {
    console.error('[api/chat/upload]', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
