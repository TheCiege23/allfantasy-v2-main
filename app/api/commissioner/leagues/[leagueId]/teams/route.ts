/**
 * PATCH /api/commissioner/leagues/[leagueId]/teams — a commissioner renames a team or changes its avatar.
 * Body: `{ leagueTeamId, teamName?, avatarUrl? }` (avatarUrl: an https URL, or null to clear it).
 *
 * 🛑 THE SETTINGS WINDOW'S TEAM TAB SAVED TO THIS PATH, AND THE PATH DID NOT EXIST (2026-11-15). Every rename and avatar
 * change a commissioner made there failed with "Could not save team". It now exists, with the same name rules and the
 * same two-table write as a manager renaming their own team (app/api/leagues/[leagueId]/my-team/handler.ts), and it
 * is recorded in the league log.
 *
 * ⚠ Imported leagues are refused: their team names come from the host platform on every sync.
 */
import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { checkTeamName } from '@/lib/league/myTeamEdit'
import { logAction } from '@/server/services/auditService'

export const dynamic = 'force-dynamic'

function readAvatarUrl(raw: unknown): { ok: true; value: string | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined }
  if (raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false }
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' ? { ok: true, value: url.toString() } : { ok: false }
  } catch {
    return { ok: false }
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const refused = await commissionerAccessResponse(leagueId, userId, 'league')
  if (refused) return refused

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!isNativePlatform(league.platform)) {
    return NextResponse.json(
      { error: 'This league is imported, so its team names and avatars come from the platform it lives on. Change them there.', code: 'IMPORTED_LEAGUE' },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueTeamId = typeof body.leagueTeamId === 'string' ? body.leagueTeamId : ''
  if (!leagueTeamId) return NextResponse.json({ error: 'leagueTeamId required' }, { status: 400 })

  const data: { teamName?: string; avatarUrl?: string | null } = {}
  if (body.teamName !== undefined && body.teamName !== null) {
    const check = checkTeamName(body.teamName)
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 })
    data.teamName = check.teamName
  }
  const avatar = readAvatarUrl(body.avatarUrl)
  if (!avatar.ok) return NextResponse.json({ error: 'The avatar must be an https image link.' }, { status: 400 })
  if (avatar.value !== undefined) data.avatarUrl = avatar.value
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

  const team = await prisma.leagueTeam.findFirst({
    where: { id: leagueTeamId, leagueId },
    select: { id: true, externalId: true, teamName: true, avatarUrl: true },
  })
  if (!team) return NextResponse.json({ error: 'Team not found in this league' }, { status: 404 })

  // The league shell reads LeagueTeam; standings, matchups and trades read the CURRENT season's RedraftRoster.
  // A past season keeps the name it had that year.
  const [currentSeason, roster] = await Promise.all([
    prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
    prisma.roster.findFirst({ where: { id: team.externalId, leagueId }, select: { redraftRosterId: true } }),
  ])

  await prisma.$transaction([
    prisma.leagueTeam.update({ where: { id: team.id }, data }),
    ...(currentSeason && roster?.redraftRosterId
      ? [prisma.redraftRoster.updateMany({ where: { id: roster.redraftRosterId, leagueId, seasonId: currentSeason.id }, data })]
      : []),
  ])

  await logAction({
    leagueId,
    userId,
    actionType: 'settings_patch',
    entityType: 'team',
    entityId: team.id,
    beforeState: { teamName: team.teamName, avatarUrl: team.avatarUrl },
    afterState: data,
    metadata: { section: 'general', source: 'commissioner-teams', fields: Object.keys(data) },
  }).catch(() => {})

  return NextResponse.json({ ok: true, teamName: data.teamName ?? null, avatarUrl: data.avatarUrl ?? null })
}
