/**
 * GET/PUT: Devy Dynasty league config. PROMPT 2/6.
 * Commissioner or league member can read; only commissioner can write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isDevyLeague, getDevyConfig, upsertDevyConfig } from '@/lib/devy/DevyLeagueConfig'
import { publishVariantConfigChange, readVariantConfigRules } from '@/lib/league-rules-explainer/variantConfigChange'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const config = await getDevyConfig(leagueId)
  if (!config) return NextResponse.json({ config: null })

  return NextResponse.json({
    config: {
      leagueId: config.leagueId,
      sport: config.sport,
      sportAdapterId: config.sportAdapterId,
      dynastyOnly: config.dynastyOnly,
      supportsStartupVetDraft: config.supportsStartupVetDraft,
      supportsRookieDraft: config.supportsRookieDraft,
      supportsDevyDraft: config.supportsDevyDraft,
      supportsBestBall: config.supportsBestBall,
      supportsSnakeDraft: config.supportsSnakeDraft,
      supportsLinearDraft: config.supportsLinearDraft,
      supportsTaxi: config.supportsTaxi,
      supportsFuturePicks: config.supportsFuturePicks,
      supportsTradeableDevyPicks: config.supportsTradeableDevyPicks,
      supportsTradeableRookiePicks: config.supportsTradeableRookiePicks,
      devySlotCount: config.devySlotCount,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      devyDraftRounds: config.devyDraftRounds,
      startupVetRounds: config.startupVetRounds ?? null,
      bestBallEnabled: config.bestBallEnabled,
      startupDraftType: config.startupDraftType,
      rookieDraftType: config.rookieDraftType,
      devyDraftType: config.devyDraftType,
      maxYearlyDevyPromotions: config.maxYearlyDevyPromotions,
      earlyDeclareBehavior: config.earlyDeclareBehavior,
      rookiePickOrderMethod: config.rookiePickOrderMethod,
      devyPickOrderMethod: config.devyPickOrderMethod,
      devyPickTradeRules: config.devyPickTradeRules,
      rookiePickTradeRules: config.rookiePickTradeRules,
      nflDevyExcludeKDST: config.nflDevyExcludeKDST,
      promotionTiming: config.promotionTiming,
      dispersalDevyFAEnabled: config.dispersalDevyFAEnabled,
      rightsExpirationEnabled: config.rightsExpirationEnabled,
      returnToSchoolHandling: config.returnToSchoolHandling,
      taxiProRookiesScoreInBestBall: config.taxiProRookiesScoreInBestBall,
      bestBallSuperflex: config.bestBallSuperflex,
    },
  })
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (!commissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy dynasty league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // The popup's rookie-draft and taxi rules, before the write, for the "What changed" card.
  const rulesBefore = await readVariantConfigRules(leagueId)
  const updated = await upsertDevyConfig(leagueId, {
    ...(body.devySlotCount != null && { devySlotCount: Number(body.devySlotCount) }),
    ...(body.taxiSize != null && { taxiSize: Number(body.taxiSize) }),
    ...(body.rookieDraftRounds != null && { rookieDraftRounds: Number(body.rookieDraftRounds) }),
    ...(body.devyDraftRounds != null && { devyDraftRounds: Number(body.devyDraftRounds) }),
    ...(body.startupVetRounds != null && { startupVetRounds: body.startupVetRounds === null ? null : Number(body.startupVetRounds) }),
    ...(body.bestBallEnabled != null && { bestBallEnabled: Boolean(body.bestBallEnabled) }),
    ...(body.startupDraftType != null && { startupDraftType: String(body.startupDraftType) }),
    ...(body.rookieDraftType != null && { rookieDraftType: String(body.rookieDraftType) }),
    ...(body.devyDraftType != null && { devyDraftType: String(body.devyDraftType) }),
    ...(body.maxYearlyDevyPromotions != null && { maxYearlyDevyPromotions: body.maxYearlyDevyPromotions === null ? null : Number(body.maxYearlyDevyPromotions) }),
    ...(body.earlyDeclareBehavior != null && { earlyDeclareBehavior: String(body.earlyDeclareBehavior) }),
    ...(body.rookiePickOrderMethod != null && { rookiePickOrderMethod: String(body.rookiePickOrderMethod) }),
    ...(body.devyPickOrderMethod != null && { devyPickOrderMethod: String(body.devyPickOrderMethod) }),
    ...(body.devyPickTradeRules != null && { devyPickTradeRules: String(body.devyPickTradeRules) }),
    ...(body.rookiePickTradeRules != null && { rookiePickTradeRules: String(body.rookiePickTradeRules) }),
    ...(body.nflDevyExcludeKDST != null && { nflDevyExcludeKDST: Boolean(body.nflDevyExcludeKDST) }),
    ...(body.promotionTiming != null && { promotionTiming: String(body.promotionTiming) }),
    ...(body.dispersalDevyFAEnabled != null && { dispersalDevyFAEnabled: Boolean(body.dispersalDevyFAEnabled) }),
    ...(body.rightsExpirationEnabled != null && { rightsExpirationEnabled: Boolean(body.rightsExpirationEnabled) }),
    ...(body.returnToSchoolHandling != null && { returnToSchoolHandling: String(body.returnToSchoolHandling) }),
    ...(body.taxiProRookiesScoreInBestBall != null && { taxiProRookiesScoreInBestBall: Boolean(body.taxiProRookiesScoreInBestBall) }),
    ...(body.bestBallSuperflex != null && { bestBallSuperflex: Boolean(body.bestBallSuperflex) }),
  })
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  await publishVariantConfigChange({ leagueId, actorUserId: userId, section: 'devy', before: rulesBefore })
  return NextResponse.json({ ok: true, config: updated })
}
