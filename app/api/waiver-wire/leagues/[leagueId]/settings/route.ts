import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getEffectiveLeagueWaiverSettings, upsertLeagueWaiverSettings } from "@/lib/waiver-wire"
import { buildWriteAuthorityEnvelope } from "@/lib/league/write-authority"

export async function GET(
  _req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId
  const [league, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({ where: { id: leagueId }, select: { id: true, sport: true, leagueVariant: true, userId: true, platform: true } }),
    (prisma as any).roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])
  const hasAccess = league && (league.userId === userId || rosterAsMember)
  if (!hasAccess) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const settings = await getEffectiveLeagueWaiverSettings(leagueId)
  const variant = (league as { leagueVariant?: string })?.leagueVariant ?? ""
  const formatType = (variant === "IDP" || variant === "DYNASTY_IDP" || variant === "idp") ? "IDP" : undefined
  return NextResponse.json({
    ...settings,
    sport: (league as { sport?: string })?.sport ?? null,
    formatType: formatType ?? undefined,
    // Loaded with the rest of the waiver shell so the page can disclose SHADOW status before a
    // manager files a claim, not only in the toast afterwards.
    writeAuthority: buildWriteAuthorityEnvelope('waiver_claim', (league as { platform?: string })?.platform ?? null),
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leagueId = params.leagueId
  const league = await (prisma as any).league.findFirst({
    where: { id: leagueId, userId },
  })
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const settings = await upsertLeagueWaiverSettings(leagueId, {
    waiverType: body.waiverType,
    processingDayOfWeek: body.processingDayOfWeek,
    processingTimeUtc: body.processingTimeUtc,
    claimLimitPerPeriod: body.claimLimitPerPeriod,
    claimLimitPerWeek: body.claimLimitPerWeek,
    claimLimitPerRun: body.claimLimitPerRun,
    processingDays: body.processingDays,
    freeAgentWindowRules: body.freeAgentWindowRules,
    faabBudget: body.faabBudget,
    faabResetDate: body.faabResetDate,
    faabResetType: body.faabResetType,
    tiebreakRule: body.tiebreakRule,
    lockType: body.lockType,
    instantFaAfterClear: body.instantFaAfterClear,
    waiverEngineConfig: body.waiverEngineConfig,
    dropRestrictions: body.dropRestrictions,
    commissionerOverrideRules: body.commissionerOverrideRules,
  })
  return NextResponse.json(settings)
}
