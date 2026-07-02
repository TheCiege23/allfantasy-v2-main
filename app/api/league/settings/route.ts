import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { commissionerLeagueFieldsFromRow } from '@/lib/league/commissioner-league-patch'
import { getLeagueRole } from '@/lib/league/permissions'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { getLeagueScoringConfig } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function totalRosterSlotsForLeague(rosterSize: number | null): number {
  if (rosterSize != null && rosterSize > 0) return rosterSize
  return 15
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return jsonError('Unauthorized', 401)

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return jsonError('leagueId required', 400)

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return jsonError(gate.status === 404 ? 'League not found' : 'Forbidden', gate.status)

  const [league, userRole, profile, commissionerEntitlement, scoringConfig] = await Promise.all([
    prisma.league.findFirst({
      where: { id: leagueId },
      include: {
        teams: { orderBy: { externalId: 'asc' } },
        leagueSettings: true,
      },
    }),
    getLeagueRole(leagueId, userId),
    prisma.userProfile.findFirst({
      where: { userId },
      select: { afCommissionerSub: true },
    }),
    new EntitlementResolver()
      .resolveForUser(userId, 'commissioner_ai_tools')
      .catch(() => ({ hasAccess: false })),
    getLeagueScoringConfig(leagueId),
  ])

  if (!league) return jsonError('League not found', 404)

  const ls = league.leagueSettings
  const totalRosterSlots = totalRosterSlotsForLeague(league.rosterSize)
  const tz = league.timezone ?? ls?.timezone ?? 'America/New_York'
  const canEdit = userRole === 'commissioner' || userRole === 'co_commissioner'
  const comm = commissionerLeagueFieldsFromRow(league)
  const rawLeagueSettings = league.settings as Record<string, unknown> | null | undefined
  const viewerHasTeam = league.teams.some((t) => t.claimedByUserId === userId)
  const survivorFairPlayLimited =
    rawLeagueSettings?.survivor_commissioner_fair_play_limited_visibility === true ||
    rawLeagueSettings?.survivor_commissioner_role === 'player_commissioner' ||
    String(rawLeagueSettings?.survivor_commissioner_role ?? '').toLowerCase() === 'player_commissioner'
  const sportConfig =
    rawLeagueSettings?.sportConfig && typeof rawLeagueSettings.sportConfig === 'object'
      ? rawLeagueSettings.sportConfig
      : {}

  return NextResponse.json({
    userRole,
    /** League creator (`League.userId`) — used for remove-from-AF and head-only tools. */
    leagueOwnerUserId: league.userId,
    viewerHasTeam,
    survivorFairPlayLimited,
    hasAfCommissionerSub: Boolean(profile?.afCommissionerSub) || Boolean(commissionerEntitlement.hasAccess),
    canEdit,
    /** Raw `League.settings` JSON for commissioner merges (description, schedule prefs, etc.). */
    settingsSnapshot: rawLeagueSettings && typeof rawLeagueSettings === 'object' ? rawLeagueSettings : {},
    league: {
      id: league.id,
      name: league.name,
      sport: league.sport,
      season: league.season,
      timezone: tz,
      teamCount: league.leagueSize ?? league.teams.length,
      isDynasty: league.isDynasty,
      leagueVariant: league.leagueVariant ?? null,
      bestBallMode: league.bestBallMode ?? null,
      autoCoachEnabled: league.autoCoachEnabled ?? true,
      rosterSize: league.rosterSize,
      totalRosterSlots,
      sportConfig,
      teams: league.teams.map((t) => ({
        id: t.id,
        externalId: t.externalId,
        teamName: t.teamName,
        ownerName: t.ownerName,
        avatarUrl: t.avatarUrl,
        role: t.role,
        claimedByUserId: t.claimedByUserId ?? null,
        wins: t.wins,
        losses: t.losses,
        pointsFor: t.pointsFor,
        isCommissioner: t.isCommissioner,
        isCoCommissioner: t.isCoCommissioner,
      })),
      ...comm,
    },
    settings: ls
      ? {
          ...ls,
          draftDateUtc: ls.draftDateUtc?.toISOString() ?? null,
          updatedAt: ls.updatedAt.toISOString(),
        }
      : null,
    /** Effective league scoring rules (template + overrides) for commissioner UI. */
    scoringConfig: scoringConfig ?? null,
  })
}

type PatchBody = Record<string, unknown> & { leagueId: string }

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return jsonError('Unauthorized', 401)

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  return executeLeagueSettingsPatch(userId, body)
}

