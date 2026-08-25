import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'

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

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response
  const userId = auth.userId

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ url: null, error: 'Storage not configured' }, { status: 503 })
  }

  const formData = await req.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const type = toStringValue(formData.get('type')).trim() as 'image' | 'video' | 'voice'
  const leagueId = toStringValue(formData.get('leagueId')).trim()
  const purpose = toStringValue(formData.get('purpose')).trim()

  const threadId = toStringValue(formData.get('threadId')).trim()
  const isProfileAvatarUpload = !leagueId && !threadId && purpose === 'profile' && type === 'image'

  if (!leagueId && !threadId && !isProfileAvatarUpload) {
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

  const key = isProfileAvatarUpload
    ? `profile/${userId}/image/${Date.now()}-${filename}`
    : leagueId
      ? `chat/${leagueId}/${type}/${Date.now()}-${filename}`
      : `chat/thread/${threadId}/${type}/${Date.now()}-${filename}`

  try {
    // Public access so chat UI can render images / audio / video inline via direct HTTPS URLs.
    // Persist `blob.url` in LeagueChatMessage.metadata (or imageUrl) as returned — do not replace with signed or proxied URLs.
    const blob = await put(key, file, {
      access: 'public',
      contentType: mimeType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
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
