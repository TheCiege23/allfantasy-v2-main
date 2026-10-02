import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-guard'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { checkTeamName } from '@/lib/league/myTeamEdit'
import {
  isAllowedProfileImageType,
  MAX_PROFILE_IMAGE_BYTES,
  persistProfileImageBytes,
} from '@/lib/avatar/ProfileImageUploadStorageService'
import { getBlobReadWriteToken } from '@/lib/blob/readWriteToken'
import { PROFILE_IMAGE_BAD_TYPE_MESSAGE, PROFILE_IMAGE_TOO_LARGE_MESSAGE } from '@/lib/avatar/profileImageLimits'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leagues/[leagueId]/my-team — a member renames their own team and/or sets its avatar.
 *
 * Body: JSON `{ teamName }`, or multipart with an optional `teamName` field and an optional `file`.
 *
 * Until 2026-10-02 the league gear menu's "Edit Team" panel had a Save button with no handler, and
 * its avatar went to `/api/chat/upload` and was never attached to anything. There was no member
 * write path for either field at all.
 *
 * 🛑 NATIVE LEAGUES ONLY. An imported league's team name and avatar come from its host platform
 * and the next sync writes them back, so a local rename would silently revert — and imported
 * leagues are read-only here by design (`lib/league/isNativeLeague.ts`). Refused with a code the
 * panel turns into "change it on Sleeper".
 *
 * Whose team: the one this user has CLAIMED (`claimedByUserId`), the same predicate the league page
 * uses to resolve `userTeam`. Never a team id from the body — a member can only edit their own.
 *
 * Avatars go to the PUBLIC profile-image store, not private chat storage: every manager in the
 * league sees a team avatar, and chat attachments are served behind a per-thread access check.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const userId = auth.userId
  const { leagueId } = await params

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!isNativePlatform(league.platform)) {
    return NextResponse.json(
      {
        error: 'IMPORTED_LEAGUE',
        message: 'This league is imported, so its team name and avatar come from the platform it lives on. Change them there and they will update on the next sync.',
      },
      { status: 409 },
    )
  }

  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId },
    select: { id: true },
  })
  if (!team) return NextResponse.json({ error: 'You do not have a team in this league.' }, { status: 404 })

  let rawName: unknown
  let file: File | null = null
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      rawName = form.get('teamName')
      const f = form.get('file')
      file = f && typeof f === 'object' && 'arrayBuffer' in f ? (f as File) : null
    } else {
      const body = (await req.json().catch(() => ({}))) as { teamName?: unknown }
      rawName = body.teamName
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const data: { teamName?: string; avatarUrl?: string } = {}

  // An absent name means "leave it" (an avatar-only save); a present-but-blank one is an error.
  if (rawName !== undefined && rawName !== null) {
    const check = checkTeamName(rawName)
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 })
    data.teamName = check.teamName
  }

  if (file) {
    if (!getBlobReadWriteToken()) return NextResponse.json({ error: 'Storage not configured' }, { status: 503 })
    if (!isAllowedProfileImageType(file.type)) {
      return NextResponse.json({ error: PROFILE_IMAGE_BAD_TYPE_MESSAGE }, { status: 400 })
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      return NextResponse.json({ error: PROFILE_IMAGE_TOO_LARGE_MESSAGE }, { status: 400 })
    }
    try {
      const { url } = await persistProfileImageBytes({
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        originalFilename: file.name,
      })
      data.avatarUrl = url
    } catch {
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }
  }

  if (!data.teamName && !data.avatarUrl) {
    return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  }

  /*
   * ⚠ TWO TABLES CARRY THE NAME. `LeagueTeam` drives the league shell; native redraft leagues also
   * keep a per-season `RedraftRoster` whose name standings, matchups and the trade center read.
   * Only the CURRENT season moves — a past season's standings should still show what the team was
   * called that year. `updateMany` so a league with no redraft season yet is a no-op, not a throw.
   */
  const currentSeason = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  await prisma.$transaction([
    prisma.leagueTeam.update({ where: { id: team.id }, data }),
    ...(currentSeason
      ? [
          prisma.redraftRoster.updateMany({
            where: { leagueId, seasonId: currentSeason.id, ownerId: userId },
            data,
          }),
        ]
      : []),
  ])

  return NextResponse.json({ ok: true, teamName: data.teamName ?? null, avatarUrl: data.avatarUrl ?? null })
}
