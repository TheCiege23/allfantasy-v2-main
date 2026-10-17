/**
 * GET/PATCH: Merged Devy / C2C league config. PROMPT 2/6.
 * Commissioner or league member can read; only the commish writes, behind the specialty-settings gate.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isC2CLeague, getC2CConfig, upsertC2CConfig } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import { parseC2CConfigPatch } from '@/lib/merged-devy-c2c/c2cConfigPatch'
import { specialtySettingsEditRefusal } from '@/lib/league/specialty-settings-access'

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

  // Gated like every other specialty write: commish or co-commish with AF Commish or a token unlock.
  const refusal = await specialtySettingsEditRefusal(leagueId, userId)
  if (refusal) return refusal

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A settings object is required.' }, { status: 400 })
  }
  // Typed, ranged and enum-checked (lib/merged-devy-c2c/c2cConfigPatch.ts): this used to coerce, so
  // 'abc' became NaN and failed the Int column, and 'false' saved as true.
  const parsed = parseC2CConfigPatch(body as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const updated = await upsertC2CConfig(leagueId, parsed.patch as Parameters<typeof upsertC2CConfig>[1])
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ ok: true, config: updated })
}
