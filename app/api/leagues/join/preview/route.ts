/**
 * GET /api/leagues/join/preview?code=XXX
 * Preview league by invite code. Returns name, sport, requiresPassword.
 * Does not return leagueId until join is attempted (or we can return it for form submit).
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateFantasyInviteCode } from '@/lib/league-invite'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'
import { SURVIVOR_TRIBE_CATALOG, tribeCrestUrl } from '@/lib/survivor/survivorTribeIdentity'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { BASH_TRANSFER_SHARE, MAUL_TRANSFER_SHARE } from '@/lib/zombie/winningsShares'
import { zombieThemeForLeague } from '@/lib/zombie/zombieHomeSummary'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams?.get('code')?.trim()
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 })

  const result = await validateFantasyInviteCode(code)
  async function survivorPreview(leagueId: string) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, leagueVariant: true, survivorMode: true, settings: true, leagueSize: true, userId: true, season: true, sport: true },
    })
    if (!league || (league.leagueVariant !== 'survivor' && !league.survivorMode)) return null
    const settings = normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null)
    const [joined, host, draft] = await Promise.all([
      prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }),
      prisma.userProfile.findFirst({ where: { userId: league.userId }, select: { displayName: true } }),
      prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftDateUtc: true } }),
    ])
    return {
      castSize: league.leagueSize || settings.defaultTeamCount,
      joined,
      inviter: host?.displayName || 'the commissioner',
      season: league.season,
      draftAt: draft?.draftDateUtc?.toISOString() ?? null,
      tribeCount: settings.tribeCount,
      tribes: settings.survivorTribeSlots.map(slot => ({
        name: SURVIVOR_TRIBE_CATALOG.find(tribe => tribe.id === slot.catalogId)?.name ?? slot.catalogId,
        logoUrl: tribeCrestUrl(slot.catalogId, String(league.sport)),
        managerCount: slot.managerCount,
      })),
      idolCount: settings.idolCount,
      mergeWeek: settings.mergeWeek,
      exileEnabled: settings.exileIslandEnabled,
      exileReturnTokens: settings.exileReturnTokens,
      councilDay: settings.tribalCouncilDay,
      councilTime: settings.tribalCouncilTime,
      tieRule: 'revote, then season points',
    }
  }
  /** The Zombie join page's hero and how-it-works: the engine's numbers for the sport, never samples. */
  async function zombiePreview(leagueId: string) {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: {
        leagueVariant: true,
        leagueSize: true,
        userId: true,
        season: true,
        sport: true,
        zombieLeague: { select: { themeLabel: true, teamCount: true, whispererIsPublic: true } },
      },
    })
    if (!league || (league.leagueVariant !== 'zombie' && !league.zombieLeague)) return null
    const [joined, host, draft, rules, config] = await Promise.all([
      prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }),
      prisma.userProfile.findFirst({ where: { userId: league.userId }, select: { displayName: true } }),
      prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftDateUtc: true } }),
      getZombieRulesForSport(String(league.sport)),
      getZombieLeagueConfig(leagueId).catch(() => null),
    ])
    return {
      teamCount: league.leagueSize || league.zombieLeague?.teamCount || 12,
      joined,
      inviter: host?.displayName || 'the commissioner',
      season: league.season,
      draftAt: draft?.draftDateUtc?.toISOString() ?? null,
      backgroundTheme: zombieThemeForLeague(league.zombieLeague?.themeLabel, leagueId),
      whispererSecret: league.zombieLeague?.whispererIsPublic === false,
      lossToZombieInfects: config?.infectionLossToZombie !== false,
      bashingMargin: rules.bashingThreshold,
      maulingMargin: rules.maulingThreshold,
      reviveSerums: rules.reviveThreshold,
      bashShare: BASH_TRANSFER_SHARE,
      maulShare: MAUL_TRANSFER_SHARE,
    }
  }
  if (result.valid) {
    return NextResponse.json({
      leagueId: result.preview.leagueId,
      name: result.preview.name,
      sport: result.preview.sport,
      requiresPassword: result.preview.requiresPassword,
      inviteExpired: result.preview.expired,
      inviteCode: result.preview.inviteCode,
      survivor: await survivorPreview(result.preview.leagueId),
      zombie: await zombiePreview(result.preview.leagueId),
    })
  }

  const statusByError: Record<string, number> = {
    INVALID_CODE: 404,
    EXPIRED: 410,
    LEAGUE_FULL: 409,
    ALREADY_MEMBER: 409,
    INVITE_DISABLED: 403,
    PASSWORD_REQUIRED: 200,
    INCORRECT_PASSWORD: 400,
  }
  const messageByError: Record<string, string> = {
    INVALID_CODE: 'Invalid invite code',
    EXPIRED: 'This invite has expired',
    LEAGUE_FULL: 'League is full',
    ALREADY_MEMBER: 'You are already in this league',
    INVITE_DISABLED: 'Invite link is currently disabled',
    PASSWORD_REQUIRED: 'This league requires a password',
    INCORRECT_PASSWORD: 'Incorrect password',
  }

  if (result.error === 'PASSWORD_REQUIRED' && result.preview) {
    return NextResponse.json({
      leagueId: result.preview.leagueId,
      name: result.preview.name,
      sport: result.preview.sport,
      requiresPassword: true,
      inviteExpired: result.preview.expired,
      inviteCode: result.preview.inviteCode,
      survivor: await survivorPreview(result.preview.leagueId),
      zombie: await zombiePreview(result.preview.leagueId),
    })
  }

  return NextResponse.json(
    {
      error: messageByError[result.error] ?? 'Unable to validate invite',
      errorCode: result.error,
      ...(result.preview
        ? {
            leagueId: result.preview.leagueId,
            name: result.preview.name,
            sport: result.preview.sport,
            requiresPassword: result.preview.requiresPassword,
            inviteExpired: result.preview.expired,
            inviteCode: result.preview.inviteCode,
            survivor: await survivorPreview(result.preview.leagueId),
            zombie: await zombiePreview(result.preview.leagueId),
          }
        : {}),
    },
    { status: statusByError[result.error] ?? 400 }
  )
}

