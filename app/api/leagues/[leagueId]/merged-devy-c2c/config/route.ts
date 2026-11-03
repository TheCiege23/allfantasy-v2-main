/**
 * GET/PATCH: Merged Devy / C2C league config. PROMPT 2/6.
 * Commissioner or league member can read; only commissioner can write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isC2CLeague, getC2CConfig, upsertC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { mirrorRookieDraftToDynasty, publishVariantConfigChange, readVariantConfigRules } from '@/lib/league-rules-explainer/variantConfigChange'

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

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C / Merged Devy league' }, { status: 404 })

  const config = await getC2CConfig(leagueId)
  if (!config) return NextResponse.json({ config: null })

  return NextResponse.json({
    config: {
      leagueId: config.leagueId,
      sport: config.sport,
      sportAdapterId: config.sportAdapterId,
      dynastyOnly: config.dynastyOnly,
      supportsMergedCollegeAndProAssets: config.supportsMergedCollegeAndProAssets,
      supportsCollegeScoring: config.supportsCollegeScoring,
      supportsBestBall: config.supportsBestBall,
      supportsSnakeDraft: config.supportsSnakeDraft,
      supportsLinearDraft: config.supportsLinearDraft,
      supportsTaxi: config.supportsTaxi,
      supportsFuturePicks: config.supportsFuturePicks,
      supportsTradeableCollegeAssets: config.supportsTradeableCollegeAssets,
      supportsTradeableCollegePicks: config.supportsTradeableCollegePicks,
      supportsTradeableRookiePicks: config.supportsTradeableRookiePicks,
      supportsPromotionRules: config.supportsPromotionRules,
      startupFormat: config.startupFormat,
      mergedStartupDraft: config.mergedStartupDraft,
      separateStartupCollegeDraft: config.separateStartupCollegeDraft,
      collegeRosterSize: config.collegeRosterSize,
      collegeActiveLineupSlots: config.collegeActiveLineupSlots,
      taxiSize: config.taxiSize,
      rookieDraftRounds: config.rookieDraftRounds,
      collegeDraftRounds: config.collegeDraftRounds,
      bestBallPro: config.bestBallPro,
      bestBallCollege: config.bestBallCollege,
      promotionTiming: config.promotionTiming,
      maxPromotionsPerYear: config.maxPromotionsPerYear,
      earlyDeclareBehavior: config.earlyDeclareBehavior,
      returnToSchoolHandling: config.returnToSchoolHandling,
      rookiePickTradeRules: config.rookiePickTradeRules,
      collegePickTradeRules: config.collegePickTradeRules,
      collegeScoringUntilDeadline: config.collegeScoringUntilDeadline,
      standingsModel: config.standingsModel,
      mergedRookieCollegeDraft: config.mergedRookieCollegeDraft,
      nflCollegeExcludeKDST: config.nflCollegeExcludeKDST,
      proLineupSlots: config.proLineupSlots,
      proBenchSize: config.proBenchSize,
      proIRSize: config.proIRSize,
      startupDraftType: config.startupDraftType,
      rookieDraftType: config.rookieDraftType,
      collegeDraftType: config.collegeDraftType,
      rookiePickOrderMethod: config.rookiePickOrderMethod,
      collegePickOrderMethod: config.collegePickOrderMethod,
      hybridProWeight: (config as any).hybridProWeight ?? 60,
      hybridPlayoffQualification: (config as any).hybridPlayoffQualification ?? 'weighted',
      hybridChampionshipTieBreaker: (config as any).hybridChampionshipTieBreaker ?? 'total_points',
      collegeFAEnabled: (config as any).collegeFAEnabled ?? false,
      collegeFAABSeparate: (config as any).collegeFAABSeparate ?? false,
      collegeFAABBudget: (config as any).collegeFAABBudget ?? null,
    },
  })
}

export async function PATCH(
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

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C / Merged Devy league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // The popup's rookie-draft and taxi rules, before the write, for the "What changed" card.
  const rulesBefore = await readVariantConfigRules(leagueId)
  const updated = await upsertC2CConfig(leagueId, {
    ...(body.startupFormat !== undefined && { startupFormat: String(body.startupFormat) }),
    ...(body.mergedStartupDraft !== undefined && { mergedStartupDraft: Boolean(body.mergedStartupDraft) }),
    ...(body.separateStartupCollegeDraft !== undefined && { separateStartupCollegeDraft: Boolean(body.separateStartupCollegeDraft) }),
    ...(body.collegeRosterSize !== undefined && { collegeRosterSize: Number(body.collegeRosterSize) }),
    ...(body.collegeActiveLineupSlots !== undefined && { collegeActiveLineupSlots: body.collegeActiveLineupSlots }),
    ...(body.taxiSize !== undefined && { taxiSize: Number(body.taxiSize) }),
    ...(body.rookieDraftRounds !== undefined && { rookieDraftRounds: Number(body.rookieDraftRounds) }),
    ...(body.collegeDraftRounds !== undefined && { collegeDraftRounds: Number(body.collegeDraftRounds) }),
    ...(body.bestBallPro !== undefined && { bestBallPro: Boolean(body.bestBallPro) }),
    ...(body.bestBallCollege !== undefined && { bestBallCollege: Boolean(body.bestBallCollege) }),
    ...(body.promotionTiming !== undefined && { promotionTiming: String(body.promotionTiming) }),
    ...(body.maxPromotionsPerYear !== undefined && { maxPromotionsPerYear: body.maxPromotionsPerYear === null ? null : Number(body.maxPromotionsPerYear) }),
    ...(body.earlyDeclareBehavior !== undefined && { earlyDeclareBehavior: String(body.earlyDeclareBehavior) }),
    ...(body.returnToSchoolHandling !== undefined && { returnToSchoolHandling: String(body.returnToSchoolHandling) }),
    ...(body.rookiePickTradeRules !== undefined && { rookiePickTradeRules: String(body.rookiePickTradeRules) }),
    ...(body.collegePickTradeRules !== undefined && { collegePickTradeRules: String(body.collegePickTradeRules) }),
    ...(body.collegeScoringUntilDeadline !== undefined && { collegeScoringUntilDeadline: Boolean(body.collegeScoringUntilDeadline) }),
    ...(body.standingsModel !== undefined && { standingsModel: String(body.standingsModel) }),
    ...(body.mergedRookieCollegeDraft !== undefined && { mergedRookieCollegeDraft: Boolean(body.mergedRookieCollegeDraft) }),
    ...(body.nflCollegeExcludeKDST !== undefined && { nflCollegeExcludeKDST: Boolean(body.nflCollegeExcludeKDST) }),
    ...(body.proLineupSlots !== undefined && { proLineupSlots: body.proLineupSlots }),
    ...(body.proBenchSize !== undefined && { proBenchSize: Number(body.proBenchSize) }),
    ...(body.proIRSize !== undefined && { proIRSize: Number(body.proIRSize) }),
    ...(body.startupDraftType !== undefined && { startupDraftType: String(body.startupDraftType) }),
    ...(body.rookieDraftType !== undefined && { rookieDraftType: String(body.rookieDraftType) }),
    ...(body.collegeDraftType !== undefined && { collegeDraftType: String(body.collegeDraftType) }),
    ...(body.rookiePickOrderMethod !== undefined && { rookiePickOrderMethod: String(body.rookiePickOrderMethod) }),
    ...(body.collegePickOrderMethod !== undefined && { collegePickOrderMethod: String(body.collegePickOrderMethod) }),
    ...(body.hybridProWeight !== undefined && { hybridProWeight: Number(body.hybridProWeight) }),
    ...(body.hybridPlayoffQualification !== undefined && { hybridPlayoffQualification: String(body.hybridPlayoffQualification) }),
    ...(body.hybridChampionshipTieBreaker !== undefined && { hybridChampionshipTieBreaker: String(body.hybridChampionshipTieBreaker) }),
    ...(body.collegeFAEnabled !== undefined && { collegeFAEnabled: Boolean(body.collegeFAEnabled) }),
    ...(body.collegeFAABSeparate !== undefined && { collegeFAABSeparate: Boolean(body.collegeFAABSeparate) }),
    ...(body.collegeFAABBudget !== undefined && { collegeFAABBudget: body.collegeFAABBudget === null ? null : Number(body.collegeFAABBudget) }),
  })
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  // The rookie draft is built from the dynasty config: its rounds and type go there too.
  await mirrorRookieDraftToDynasty(leagueId, body)
  await publishVariantConfigChange({ leagueId, actorUserId: userId, section: 'c2c', before: rulesBefore })
  return NextResponse.json({ ok: true, config: updated })
}
