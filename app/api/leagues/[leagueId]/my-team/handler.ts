import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-guard'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { checkTeamName, managerTeamNameEditsAllowed, normalizeTeamAbbreviation } from '@/lib/league/myTeamEdit'
import {
  isAllowedProfileImageType,
  MAX_PROFILE_IMAGE_BYTES,
  persistProfileImageBytes,
} from '@/lib/avatar/ProfileImageUploadStorageService'
import { getBlobReadWriteToken } from '@/lib/blob/readWriteToken'
import { PROFILE_IMAGE_BAD_TYPE_MESSAGE, PROFILE_IMAGE_TOO_LARGE_MESSAGE } from '@/lib/avatar/profileImageLimits'

export const dynamic = 'force-dynamic'

async function findManagedTeam(leagueId: string, userId: string, teamId?: string) {
  const coOwnerRosterId = await acceptedCoOwnerRosterId(leagueId, userId)
  const team = await prisma.leagueTeam.findFirst({
    where: {
      leagueId,
      ...(teamId ? { id: teamId } : {}),
      ...(coOwnerRosterId && !teamId
        ? { externalId: coOwnerRosterId }
        : coOwnerRosterId
          ? { OR: [{ claimedByUserId: userId }, { externalId: coOwnerRosterId }] }
          : { claimedByUserId: userId }),
    },
    orderBy: { id: 'asc' },
    select: { id: true, externalId: true },
  })
  return { team, coOwnerRosterId }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const { leagueId } = await params
  const teamId = req.nextUrl.searchParams.get('leagueTeamId') ?? undefined
  const { team } = await findManagedTeam(leagueId, auth.userId, teamId)
  if (!team) return NextResponse.json({ error: 'You do not have access to this team.' }, { status: 404 })
  const roster = await prisma.roster.findFirst({ where: { leagueId, id: team.externalId }, select: { settings: true } })
  const abbreviation = roster ? normalizeTeamAbbreviation((roster.settings as Record<string, unknown> | null)?.teamAbbreviation) ?? '' : null
  return NextResponse.json({ abbreviation })
}

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
 * An explicit team id is scoped to a team the user owns or has accepted a co-owner invite for.
 *
 * Avatars go to the PUBLIC profile-image store, not private chat storage: every manager in the
 * league sees a team avatar, and chat attachments are served behind a per-thread access check.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response
  const userId = auth.userId
  const { leagueId } = await params

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
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

  let rawName: unknown
  let rawAbbreviation: unknown
  let rawTeamId: unknown
  let file: File | null = null
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      rawName = form.get('teamName')
      rawAbbreviation = form.get('abbreviation')
      rawTeamId = form.get('leagueTeamId')
      const f = form.get('file')
      file = f && typeof f === 'object' && 'arrayBuffer' in f ? (f as File) : null
    } else {
      const body = (await req.json().catch(() => ({}))) as { teamName?: unknown; abbreviation?: unknown; leagueTeamId?: unknown }
      rawName = body.teamName
      rawAbbreviation = body.abbreviation
      rawTeamId = body.leagueTeamId
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const teamId = typeof rawTeamId === 'string' && rawTeamId ? rawTeamId : undefined
  const { team, coOwnerRosterId } = await findManagedTeam(leagueId, userId, teamId)
  if (!team) return NextResponse.json({ error: 'You do not have access to this team.' }, { status: 404 })

  const data: { teamName?: string; avatarUrl?: string } = {}

  // An absent name means "leave it" (an avatar-only save); a present-but-blank one is an error.
  if (rawName !== undefined && rawName !== null) {
    const check = checkTeamName(rawName)
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 })
    data.teamName = check.teamName
  }

  const abbreviation = rawAbbreviation == null ? undefined : normalizeTeamAbbreviation(rawAbbreviation)
  if (abbreviation === null) return NextResponse.json({ error: 'Use up to six letters or numbers for the abbreviation.' }, { status: 400 })
  if ((data.teamName || abbreviation !== undefined) && !managerTeamNameEditsAllowed(league.settings)) {
    return NextResponse.json({ error: 'The commissioner manages team names and abbreviations in this league.' }, { status: 403 })
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

  const editsTeam = Boolean(data.teamName || data.avatarUrl)
  if (!editsTeam && abbreviation === undefined) {
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

  const roster = (currentSeason || abbreviation !== undefined) ? await prisma.roster.findFirst({
    where: { id: team.externalId, leagueId },
    select: { id: true, redraftRosterId: true, platformUserId: true, settings: true },
  }) : null
  if (currentSeason && team.externalId === coOwnerRosterId) {
    const linked = roster?.redraftRosterId && await prisma.redraftRoster.findFirst({
      where: { id: roster.redraftRosterId, leagueId, seasonId: currentSeason.id }, select: { id: true },
    })
    if (!linked) return NextResponse.json({ error: 'This team is not linked to the current season roster.' }, { status: 409 })
  }
  const seasonSeat = roster?.redraftRosterId ? { id: roster.redraftRosterId } : roster?.platformUserId ? { ownerId: roster.platformUserId } : null

  if (abbreviation !== undefined && !roster) return NextResponse.json({ error: 'This team has no roster yet.' }, { status: 409 })
  const settings = roster?.settings && typeof roster.settings === 'object' && !Array.isArray(roster.settings) ? roster.settings : {}

  await prisma.$transaction([
    ...(editsTeam ? [prisma.leagueTeam.update({ where: { id: team.id }, data })] : []),
    ...(editsTeam && currentSeason && seasonSeat
      ? [
          prisma.redraftRoster.updateMany({
            where: { leagueId, seasonId: currentSeason.id, ...seasonSeat },
            data,
          }),
        ]
      : []),
    ...(abbreviation !== undefined && roster ? [prisma.roster.update({ where: { id: roster.id }, data: {
      settings: { ...settings, teamAbbreviation: abbreviation },
    } })] : []),
  ])

  return NextResponse.json({ ok: true, teamName: data.teamName ?? null, avatarUrl: data.avatarUrl ?? null, abbreviation })
}
