/**
 * Merged Devy / C2C league config: load, detect, upsert. PROMPT 2/6.
 * Sport adapter: nfl_c2c | nba_c2c.
 */

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import {
  getC2CAdapterForSport,
  type C2CLeagueConfigShape,
  type C2CFormatCapabilities,
  type C2CCommissionerSettings,
  type C2CLineupSlots,
  MERGED_DEVY_C2C_VARIANT,
} from './types'
import {
  NFL_C2C_PRO_LINEUP_DEFAULT,
  NFL_C2C_COLLEGE_LINEUP_DEFAULT,
  NFL_C2C_PRO_BENCH,
  NFL_C2C_PRO_IR,
  NFL_C2C_TAXI,
  NFL_C2C_COLLEGE_ROSTER_SIZE,
  NFL_C2C_ROOKIE_DRAFT_ROUNDS,
  NFL_C2C_COLLEGE_DRAFT_ROUNDS,
  NBA_C2C_PRO_LINEUP_DEFAULT,
  NBA_C2C_COLLEGE_LINEUP_DEFAULT,
  NBA_C2C_PRO_BENCH,
  NBA_C2C_PRO_IR,
  NBA_C2C_TAXI,
  NBA_C2C_COLLEGE_ROSTER_SIZE,
  NBA_C2C_ROOKIE_DRAFT_ROUNDS,
  NBA_C2C_COLLEGE_DRAFT_ROUNDS,
} from './constants'

const DEFAULT_CAPABILITIES: C2CFormatCapabilities = {
  dynastyOnly: true,
  supportsMergedCollegeAndProAssets: true,
  supportsCollegeScoring: true,
  supportsBestBall: true,
  supportsSnakeDraft: true,
  supportsLinearDraft: true,
  supportsTaxi: true,
  supportsFuturePicks: true,
  supportsTradeableCollegeAssets: true,
  supportsTradeableCollegePicks: true,
  supportsTradeableRookiePicks: true,
  supportsPromotionRules: true,
}

function defaultCommissionerSettings(sport: LeagueSport): C2CCommissionerSettings {
  const isFootball = sport === 'NFL' || sport === 'NCAAF'
  return {
    startupFormat: 'merged',
    mergedStartupDraft: true,
    separateStartupCollegeDraft: false,
    collegeRosterSize: isFootball ? NFL_C2C_COLLEGE_ROSTER_SIZE : NBA_C2C_COLLEGE_ROSTER_SIZE,
    collegeSports: [isFootball ? 'NCAAF' : 'NCAAB'],
    collegeScoringSystem: isFootball ? 'ppr' : 'points',
    mixProPlayers: true,
    collegeActiveLineupSlots: isFootball ? NFL_C2C_COLLEGE_LINEUP_DEFAULT : NBA_C2C_COLLEGE_LINEUP_DEFAULT,
    taxiSize: isFootball ? NFL_C2C_TAXI : NBA_C2C_TAXI,
    rookieDraftRounds: isFootball ? NFL_C2C_ROOKIE_DRAFT_ROUNDS : NBA_C2C_ROOKIE_DRAFT_ROUNDS,
    collegeDraftRounds: isFootball ? NFL_C2C_COLLEGE_DRAFT_ROUNDS : NBA_C2C_COLLEGE_DRAFT_ROUNDS,
    bestBallPro: true,
    bestBallCollege: false,
    promotionTiming: 'manager_choice_before_rookie_draft',
    maxPromotionsPerYear: null,
    earlyDeclareBehavior: 'allow',
    returnToSchoolHandling: 'restore_rights',
    rookiePickTradeRules: 'allowed',
    collegePickTradeRules: 'allowed',
    collegeScoringUntilDeadline: true,
    // Owner's decision, 2026-11-24: NFL C2C plays separate college and pro matchups by default.
    standingsModel: sport === 'NFL' ? 'separate' : 'unified',
    mergedRookieCollegeDraft: false,
    nflCollegeExcludeKDST: true,
    proLineupSlots: isFootball ? NFL_C2C_PRO_LINEUP_DEFAULT : NBA_C2C_PRO_LINEUP_DEFAULT,
    proBenchSize: isFootball ? NFL_C2C_PRO_BENCH : NBA_C2C_PRO_BENCH,
    proIRSize: isFootball ? NFL_C2C_PRO_IR : NBA_C2C_PRO_IR,
    startupDraftType: 'snake',
    rookieDraftType: 'snake',
    collegeDraftType: 'snake',
    rookiePickOrderMethod: 'reverse_standings',
    collegePickOrderMethod: 'reverse_standings',
    hybridProWeight: 60,
    hybridPlayoffQualification: 'weighted',
    hybridChampionshipTieBreaker: 'total_points',
    collegeFAEnabled: false,
    collegeFAABSeparate: false,
    collegeFAABBudget: null,
  }
}

function parseLineupSlots(json: unknown): C2CLineupSlots | null {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const out: C2CLineupSlots = {}
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v
    }
    return Object.keys(out).length ? out : null
  }
  return null
}

export async function isC2CLeague(leagueId: string): Promise<boolean> {
  const config = await prisma.c2CLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (config) return true
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueVariant: true },
  })
  return league?.leagueVariant === MERGED_DEVY_C2C_VARIANT
}

export async function getC2CConfig(leagueId: string): Promise<C2CLeagueConfigShape | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueVariant: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport
  const sportAdapterId = getC2CAdapterForSport(sport)
  if (!sportAdapterId) return null

  const row = await prisma.c2CLeagueConfig.findUnique({
    where: { leagueId },
  })
  if (row) {
    const defaults = defaultCommissionerSettings(sport)
    return {
      leagueId: row.leagueId,
      sport,
      sportAdapterId,
      ...DEFAULT_CAPABILITIES,
      startupFormat: (row.startupFormat as 'merged' | 'separate') ?? 'merged',
      mergedStartupDraft: row.mergedStartupDraft,
      separateStartupCollegeDraft: row.separateStartupCollegeDraft,
      collegeRosterSize: row.collegeRosterSize,
      collegeSports: Array.isArray((row as any).collegeSports)
        ? ((row as any).collegeSports as string[]).filter(Boolean)
        : defaults.collegeSports,
      collegeScoringSystem: (row as any).collegeScoringSystem ?? defaults.collegeScoringSystem,
      mixProPlayers: (row as any).mixProPlayers ?? defaults.mixProPlayers,
      collegeActiveLineupSlots: (parseLineupSlots(row.collegeActiveLineupSlots) ?? defaults.collegeActiveLineupSlots) as C2CLineupSlots,
      taxiSize: row.taxiSize,
      rookieDraftRounds: row.rookieDraftRounds,
      collegeDraftRounds: row.collegeDraftRounds,
      bestBallPro: row.bestBallPro,
      bestBallCollege: row.bestBallCollege,
      promotionTiming: row.promotionTiming,
      maxPromotionsPerYear: row.maxPromotionsPerYear,
      earlyDeclareBehavior: row.earlyDeclareBehavior,
      returnToSchoolHandling: row.returnToSchoolHandling,
      rookiePickTradeRules: row.rookiePickTradeRules,
      collegePickTradeRules: row.collegePickTradeRules,
      collegeScoringUntilDeadline: row.collegeScoringUntilDeadline,
      standingsModel: row.standingsModel as 'unified' | 'separate' | 'hybrid',
      mergedRookieCollegeDraft: row.mergedRookieCollegeDraft,
      nflCollegeExcludeKDST: row.nflCollegeExcludeKDST,
      proLineupSlots: parseLineupSlots(row.proLineupSlots) ?? defaults.proLineupSlots,
      proBenchSize: row.proBenchSize,
      proIRSize: row.proIRSize,
      startupDraftType: row.startupDraftType as 'snake' | 'linear' | 'auction',
      rookieDraftType: row.rookieDraftType as 'snake' | 'linear',
      collegeDraftType: row.collegeDraftType as 'snake' | 'linear',
      rookiePickOrderMethod: row.rookiePickOrderMethod,
      collegePickOrderMethod: row.collegePickOrderMethod,
      hybridProWeight: (row as any).hybridProWeight ?? 60,
      hybridPlayoffQualification: (row as any).hybridPlayoffQualification ?? 'weighted',
      hybridChampionshipTieBreaker: (row as any).hybridChampionshipTieBreaker ?? 'total_points',
      collegeFAEnabled: (row as any).collegeFAEnabled ?? false,
      collegeFAABSeparate: (row as any).collegeFAABSeparate ?? false,
      collegeFAABBudget: (row as any).collegeFAABBudget ?? null,
    }
  }

  if (league.leagueVariant !== MERGED_DEVY_C2C_VARIANT) return null

  const defaults = defaultCommissionerSettings(sport)
  return {
    leagueId: league.id,
    sport,
    sportAdapterId,
    ...DEFAULT_CAPABILITIES,
    ...defaults,
    // A league with no stored config predates the separate default and keeps scoring as it always has.
    standingsModel: 'unified',
  }
}

export async function upsertC2CConfig(
  leagueId: string,
  input: Partial<{
    startupFormat: string
    mergedStartupDraft: boolean
    separateStartupCollegeDraft: boolean
    collegeRosterSize: number
    collegeSports: string[]
    collegeScoringSystem: string
    mixProPlayers: boolean
    collegeActiveLineupSlots: C2CLineupSlots
    taxiSize: number
    rookieDraftRounds: number
    collegeDraftRounds: number
    bestBallPro: boolean
    bestBallCollege: boolean
    promotionTiming: string
    maxPromotionsPerYear: number | null
    earlyDeclareBehavior: string
    returnToSchoolHandling: string
    rookiePickTradeRules: string
    collegePickTradeRules: string
    collegeScoringUntilDeadline: boolean
    standingsModel: string
    mergedRookieCollegeDraft: boolean
    nflCollegeExcludeKDST: boolean
    proLineupSlots: C2CLineupSlots
    proBenchSize: number
    proIRSize: number
    startupDraftType: string
    rookieDraftType: string
    collegeDraftType: string
    rookiePickOrderMethod: string
    collegePickOrderMethod: string
  }>
): Promise<C2CLeagueConfigShape | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport
  const defaults = defaultCommissionerSettings(sport)

  const createPayload = {
    leagueId,
    dynastyOnly: true,
    supportsMergedCollegeAndProAssets: true,
    supportsCollegeScoring: true,
    supportsBestBall: true,
    supportsSnakeDraft: true,
    supportsLinearDraft: true,
    supportsTaxi: true,
    supportsFuturePicks: true,
    supportsTradeableCollegeAssets: true,
    supportsTradeableCollegePicks: true,
    supportsTradeableRookiePicks: true,
    supportsPromotionRules: true,
    startupFormat: input.startupFormat ?? 'merged',
    mergedStartupDraft: input.mergedStartupDraft ?? true,
    separateStartupCollegeDraft: input.separateStartupCollegeDraft ?? false,
    collegeRosterSize: input.collegeRosterSize ?? defaults.collegeRosterSize,
    collegeSports: input.collegeSports ?? defaults.collegeSports,
    collegeScoringSystem: input.collegeScoringSystem ?? defaults.collegeScoringSystem,
    mixProPlayers: input.mixProPlayers ?? defaults.mixProPlayers,
    collegeActiveLineupSlots: (input.collegeActiveLineupSlots ?? defaults.collegeActiveLineupSlots) as object,
    taxiSize: input.taxiSize ?? defaults.taxiSize,
    rookieDraftRounds: input.rookieDraftRounds ?? defaults.rookieDraftRounds,
    collegeDraftRounds: input.collegeDraftRounds ?? defaults.collegeDraftRounds,
    bestBallPro: input.bestBallPro ?? true,
    bestBallCollege: input.bestBallCollege ?? false,
    promotionTiming: input.promotionTiming ?? 'manager_choice_before_rookie_draft',
    maxPromotionsPerYear: input.maxPromotionsPerYear ?? null,
    earlyDeclareBehavior: input.earlyDeclareBehavior ?? 'allow',
    returnToSchoolHandling: input.returnToSchoolHandling ?? 'restore_rights',
    rookiePickTradeRules: input.rookiePickTradeRules ?? 'allowed',
    collegePickTradeRules: input.collegePickTradeRules ?? 'allowed',
    collegeScoringUntilDeadline: input.collegeScoringUntilDeadline ?? true,
    standingsModel: input.standingsModel ?? defaults.standingsModel,
    mergedRookieCollegeDraft: input.mergedRookieCollegeDraft ?? false,
    nflCollegeExcludeKDST: input.nflCollegeExcludeKDST ?? true,
    proLineupSlots: (input.proLineupSlots ?? defaults.proLineupSlots) as object,
    proBenchSize: input.proBenchSize ?? defaults.proBenchSize,
    proIRSize: input.proIRSize ?? defaults.proIRSize,
    startupDraftType: input.startupDraftType ?? 'snake',
    rookieDraftType: input.rookieDraftType ?? 'snake',
    collegeDraftType: input.collegeDraftType ?? 'snake',
    rookiePickOrderMethod: input.rookiePickOrderMethod ?? 'reverse_standings',
    collegePickOrderMethod: input.collegePickOrderMethod ?? 'reverse_standings',
    hybridProWeight: (input as any).hybridProWeight ?? 60,
    hybridPlayoffQualification: (input as any).hybridPlayoffQualification ?? 'weighted',
    hybridChampionshipTieBreaker: (input as any).hybridChampionshipTieBreaker ?? 'total_points',
    collegeFAEnabled: (input as any).collegeFAEnabled ?? false,
    collegeFAABSeparate: (input as any).collegeFAABSeparate ?? false,
    collegeFAABBudget: (input as any).collegeFAABBudget ?? null,
  }

  await prisma.c2CLeagueConfig.upsert({
    where: { leagueId },
    create: createPayload,
    update: {
      ...(input.startupFormat !== undefined && { startupFormat: input.startupFormat }),
      ...(input.mergedStartupDraft !== undefined && { mergedStartupDraft: input.mergedStartupDraft }),
      ...(input.separateStartupCollegeDraft !== undefined && { separateStartupCollegeDraft: input.separateStartupCollegeDraft }),
      ...(input.collegeRosterSize !== undefined && { collegeRosterSize: input.collegeRosterSize }),
      ...(input.collegeSports !== undefined && { collegeSports: input.collegeSports }),
      ...(input.collegeScoringSystem !== undefined && { collegeScoringSystem: input.collegeScoringSystem }),
      ...(input.mixProPlayers !== undefined && { mixProPlayers: input.mixProPlayers }),
      ...(input.collegeActiveLineupSlots !== undefined && { collegeActiveLineupSlots: input.collegeActiveLineupSlots as object }),
      ...(input.taxiSize !== undefined && { taxiSize: input.taxiSize }),
      ...(input.rookieDraftRounds !== undefined && { rookieDraftRounds: input.rookieDraftRounds }),
      ...(input.collegeDraftRounds !== undefined && { collegeDraftRounds: input.collegeDraftRounds }),
      ...(input.bestBallPro !== undefined && { bestBallPro: input.bestBallPro }),
      ...(input.bestBallCollege !== undefined && { bestBallCollege: input.bestBallCollege }),
      ...(input.promotionTiming !== undefined && { promotionTiming: input.promotionTiming }),
      ...(input.maxPromotionsPerYear !== undefined && { maxPromotionsPerYear: input.maxPromotionsPerYear }),
      ...(input.earlyDeclareBehavior !== undefined && { earlyDeclareBehavior: input.earlyDeclareBehavior }),
      ...(input.returnToSchoolHandling !== undefined && { returnToSchoolHandling: input.returnToSchoolHandling }),
      ...(input.rookiePickTradeRules !== undefined && { rookiePickTradeRules: input.rookiePickTradeRules }),
      ...(input.collegePickTradeRules !== undefined && { collegePickTradeRules: input.collegePickTradeRules }),
      ...(input.collegeScoringUntilDeadline !== undefined && { collegeScoringUntilDeadline: input.collegeScoringUntilDeadline }),
      ...(input.standingsModel !== undefined && { standingsModel: input.standingsModel }),
      ...(input.mergedRookieCollegeDraft !== undefined && { mergedRookieCollegeDraft: input.mergedRookieCollegeDraft }),
      ...(input.nflCollegeExcludeKDST !== undefined && { nflCollegeExcludeKDST: input.nflCollegeExcludeKDST }),
      ...(input.proLineupSlots !== undefined && { proLineupSlots: input.proLineupSlots as object }),
      ...(input.proBenchSize !== undefined && { proBenchSize: input.proBenchSize }),
      ...(input.proIRSize !== undefined && { proIRSize: input.proIRSize }),
      ...(input.startupDraftType !== undefined && { startupDraftType: input.startupDraftType }),
      ...(input.rookieDraftType !== undefined && { rookieDraftType: input.rookieDraftType }),
      ...(input.collegeDraftType !== undefined && { collegeDraftType: input.collegeDraftType }),
      ...(input.rookiePickOrderMethod !== undefined && { rookiePickOrderMethod: input.rookiePickOrderMethod }),
      ...(input.collegePickOrderMethod !== undefined && { collegePickOrderMethod: input.collegePickOrderMethod }),
      ...((input as any).hybridProWeight !== undefined && { hybridProWeight: (input as any).hybridProWeight }),
      ...((input as any).hybridPlayoffQualification !== undefined && { hybridPlayoffQualification: (input as any).hybridPlayoffQualification }),
      ...((input as any).hybridChampionshipTieBreaker !== undefined && { hybridChampionshipTieBreaker: (input as any).hybridChampionshipTieBreaker }),
      ...((input as any).collegeFAEnabled !== undefined && { collegeFAEnabled: (input as any).collegeFAEnabled }),
      ...((input as any).collegeFAABSeparate !== undefined && { collegeFAABSeparate: (input as any).collegeFAABSeparate }),
      ...((input as any).collegeFAABBudget !== undefined && { collegeFAABBudget: (input as any).collegeFAABBudget }),
    },
  })
  return getC2CConfig(leagueId)
}
