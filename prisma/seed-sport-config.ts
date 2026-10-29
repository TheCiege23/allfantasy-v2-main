/**
 * [NEW] prisma/seed-sport-config.ts
 * Seeds scoring profiles, roster templates, and sport feature flags (PROMPT 2/4).
 * Run: npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-sport-config.ts
 * All scoring is deterministic and backend-driven; commissioners can override only where league rules allow.
 */

import { PrismaClient, Prisma } from '@prisma/client'
import {
  DAILY_REDRAFT_ROSTER_LAYOUTS,
  dailyRedraftReserveCount,
  type DailyRedraftRosterLayout,
} from '../lib/sportConfig/dailySportRedraftRoster'

const prisma = new PrismaClient()

type SportType = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'NCAAF' | 'NCAAB' | 'SOCCER'

interface ScoringRuleRow {
  statKey: string
  pointsValue: number
  multiplier?: number
  enabled?: boolean
}

interface RosterSlotRow {
  slotName: string
  allowedPositions: string[]
  starterCount: number
  benchCount: number
  reserveCount: number
  taxiCount: number
  devyCount: number
  isFlexibleSlot: boolean
  slotOrder: number
}

/**
 * NBA / NHL / MLB template rows are the one redraft layout (lib/sportConfig/dailySportRedraftRoster.ts).
 * These rows used to restate it and disagreed (NBA bench 6 / no IR, NHL D 3, MLB OF 4 + SP 4).
 * Re-running the seed rewrites the rows; it never touches a league's own stored roster.
 */
function dailyLayoutSlotRows(layout: DailyRedraftRosterLayout): RosterSlotRow[] {
  const rows: RosterSlotRow[] = layout.starters.map((slot, i) => ({
    slotName: slot.key,
    allowedPositions: [...slot.eligiblePositions],
    starterCount: slot.count,
    benchCount: 0,
    reserveCount: 0,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot: slot.flex,
    slotOrder: i,
  }))
  const pool = [...layout.draftablePlayerPositions]
  rows.push({ slotName: 'BENCH', allowedPositions: pool, starterCount: 0, benchCount: layout.benchSlots, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: rows.length })
  const reserve = dailyRedraftReserveCount(layout)
  if (reserve > 0) {
    rows.push({ slotName: 'IR', allowedPositions: pool, starterCount: 0, benchCount: 0, reserveCount: reserve, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: rows.length })
  }
  return rows
}

async function upsertScoringTemplate(
  sportType: SportType,
  formatType: string,
  name: string,
  rules: ScoringRuleRow[]
) {
  const template = await prisma.scoringTemplate.upsert({
    where: {
      uniq_scoring_template_sport_format: { sportType, formatType },
    },
    create: {
      sportType,
      formatType,
      name,
    },
    update: { name },
  })
  await prisma.scoringRule.deleteMany({ where: { templateId: template.id } })
  if (rules.length > 0) {
    await prisma.scoringRule.createMany({
      data: rules.map((r) => ({
        templateId: template.id,
        statKey: r.statKey,
        pointsValue: r.pointsValue,
        multiplier: r.multiplier ?? 1,
        enabled: r.enabled ?? true,
      })),
    })
  }
  return template
}

async function upsertRosterTemplate(
  sportType: SportType,
  formatType: string,
  name: string,
  slots: RosterSlotRow[]
) {
  const template = await prisma.rosterTemplate.upsert({
    where: {
      uniq_roster_template_sport_format: { sportType, formatType },
    },
    create: {
      sportType,
      formatType,
      name,
    },
    update: { name },
  })
  await prisma.rosterTemplateSlot.deleteMany({ where: { templateId: template.id } })
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    await prisma.rosterTemplateSlot.create({
      data: {
        templateId: template.id,
        slotName: s.slotName,
        allowedPositions: s.allowedPositions,
        starterCount: s.starterCount,
        benchCount: s.benchCount,
        reserveCount: s.reserveCount,
        taxiCount: s.taxiCount,
        devyCount: s.devyCount,
        isFlexibleSlot: s.isFlexibleSlot,
        slotOrder: s.slotOrder,
      },
    })
  }
  return template
}

async function upsertSportFeatureFlags(
  sportType: SportType,
  flags: {
    supportsBestBall: boolean
    supportsSuperflex: boolean
    supportsTePremium: boolean
    supportsKickers: boolean
    supportsTeamDefense: boolean
    supportsIdp: boolean
    supportsWeeklyLineups: boolean
    supportsDailyLineups: boolean
    supportsBracketMode: boolean
    supportsDevy: boolean
    supportsTaxi: boolean
    supportsIr: boolean
  }
) {
  await prisma.sportFeatureFlags.upsert({
    where: { sportType },
    create: { sportType, ...flags },
    update: flags,
  })
}

interface ScheduleTemplateRow {
  name: string
  formatType: string
  matchupType: string
  regularSeasonWeeks: number
  playoffWeeks: number
  byeWeekWindow?: { start: number; end: number } | null
  fantasyPlayoffDefault?: { startWeek: number; endWeek: number } | null
  lineupLockMode?: string | null
  scoringMode?: string | null
  regularSeasonStyle?: string | null
  playoffSupport: boolean
  bracketModeSupported: boolean
  marchMadnessMode: boolean
  bowlPlayoffMetadata: boolean
}

async function upsertScheduleTemplate(sportType: SportType, row: ScheduleTemplateRow) {
  await prisma.scheduleTemplate.upsert({
    where: { uniq_schedule_template_sport_format: { sportType, formatType: row.formatType } },
    create: {
      sportType,
      name: row.name,
      formatType: row.formatType,
      matchupType: row.matchupType,
      regularSeasonWeeks: row.regularSeasonWeeks,
      playoffWeeks: row.playoffWeeks,
      byeWeekWindow: row.byeWeekWindow ?? undefined,
      fantasyPlayoffDefault: row.fantasyPlayoffDefault ?? undefined,
      lineupLockMode: row.lineupLockMode ?? null,
      scoringMode: row.scoringMode ?? null,
      regularSeasonStyle: row.regularSeasonStyle ?? null,
      playoffSupport: row.playoffSupport,
      bracketModeSupported: row.bracketModeSupported,
      marchMadnessMode: row.marchMadnessMode,
      bowlPlayoffMetadata: row.bowlPlayoffMetadata,
    },
    update: {
      name: row.name,
      matchupType: row.matchupType,
      regularSeasonWeeks: row.regularSeasonWeeks,
      playoffWeeks: row.playoffWeeks,
      byeWeekWindow: row.byeWeekWindow ?? undefined,
      fantasyPlayoffDefault: row.fantasyPlayoffDefault ?? undefined,
      lineupLockMode: row.lineupLockMode ?? null,
      scoringMode: row.scoringMode ?? null,
      regularSeasonStyle: row.regularSeasonStyle ?? null,
      playoffSupport: row.playoffSupport,
      bracketModeSupported: row.bracketModeSupported,
      marchMadnessMode: row.marchMadnessMode,
      bowlPlayoffMetadata: row.bowlPlayoffMetadata,
    },
  })
}

interface SeasonCalendarRow {
  name: string
  formatType: string
  preseasonPeriod?: Record<string, unknown> | null
  regularSeasonPeriod: Record<string, unknown>
  playoffsPeriod?: Record<string, unknown> | null
  championshipPeriod?: Record<string, unknown> | null
  internationalBreaksSupported: boolean
}

async function upsertSeasonCalendar(sportType: SportType, row: SeasonCalendarRow) {
  const J = (v: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined =>
    v == null ? undefined : (v as Prisma.InputJsonValue)
  await prisma.seasonCalendar.upsert({
    where: { uniq_season_calendar_sport_format: { sportType, formatType: row.formatType } },
    create: {
      sportType,
      name: row.name,
      formatType: row.formatType,
      preseasonPeriod: J(row.preseasonPeriod ?? undefined),
      regularSeasonPeriod: J(row.regularSeasonPeriod)!,
      playoffsPeriod: J(row.playoffsPeriod ?? undefined),
      championshipPeriod: J(row.championshipPeriod ?? undefined),
      internationalBreaksSupported: row.internationalBreaksSupported,
    },
    update: {
      name: row.name,
      preseasonPeriod: J(row.preseasonPeriod ?? undefined),
      regularSeasonPeriod: J(row.regularSeasonPeriod)!,
      playoffsPeriod: J(row.playoffsPeriod ?? undefined),
      championshipPeriod: J(row.championshipPeriod ?? undefined),
      internationalBreaksSupported: row.internationalBreaksSupported,
    },
  })
}

async function main() {
  // ----- NFL -----
  const nflPprRules: ScoringRuleRow[] = [
    { statKey: 'passing_td', pointsValue: 4 },
    { statKey: 'passing_yards', pointsValue: 0.04 },
    { statKey: 'interception', pointsValue: -2 },
    { statKey: 'rushing_td', pointsValue: 6 },
    { statKey: 'rushing_yards', pointsValue: 0.1 },
    { statKey: 'receptions', pointsValue: 1 },
    { statKey: 'receiving_td', pointsValue: 6 },
    { statKey: 'receiving_yards', pointsValue: 0.1 },
    { statKey: 'fumble_lost', pointsValue: -2 },
    { statKey: 'two_pt_conversion', pointsValue: 2 },
    { statKey: 'passing_2pt', pointsValue: 2 },
    { statKey: 'rushing_2pt', pointsValue: 2 },
    { statKey: 'receiving_2pt', pointsValue: 2 },
    { statKey: 'fg_0_39', pointsValue: 3 },
    { statKey: 'fg_40_49', pointsValue: 4 },
    { statKey: 'fg_50_plus', pointsValue: 5 },
    { statKey: 'pat_made', pointsValue: 1 },
    { statKey: 'pat_missed', pointsValue: -1 },
    { statKey: 'dst_sack', pointsValue: 1 },
    { statKey: 'dst_interception', pointsValue: 2 },
    { statKey: 'dst_fumble_recovery', pointsValue: 2 },
    { statKey: 'dst_td', pointsValue: 6 },
    { statKey: 'dst_points_allowed_0', pointsValue: 10 },
    { statKey: 'dst_points_allowed_1_6', pointsValue: 7 },
    { statKey: 'dst_points_allowed_7_13', pointsValue: 4 },
    { statKey: 'dst_points_allowed_14_20', pointsValue: 1 },
    { statKey: 'dst_points_allowed_21_27', pointsValue: 0 },
    { statKey: 'dst_points_allowed_28_34', pointsValue: -1 },
    { statKey: 'dst_points_allowed_35_plus', pointsValue: -4 },
    { statKey: 'dst_safety', pointsValue: 2 },
    { statKey: 'dst_blocked_kick', pointsValue: 2 },
    { statKey: 'dst_return_td', pointsValue: 6 },
  ]
  await upsertScoringTemplate('NFL', 'PPR', 'NFL_PPR_DEFAULT', nflPprRules)
  await upsertScoringTemplate('NFL', 'half_ppr', 'NFL_HALF_PPR', nflPprRules.map((r) => (r.statKey === 'receptions' ? { ...r, pointsValue: 0.5 } : r)))
  await upsertScoringTemplate('NFL', 'standard', 'NFL_STANDARD_DEFAULT', nflPprRules.map((r) => (r.statKey === 'receptions' ? { ...r, pointsValue: 0 } : r)))
  const nflTePremiumRules: ScoringRuleRow[] = nflPprRules.map((r) => (r.statKey === 'receptions' ? { ...r, pointsValue: 1.5 } : r))
  await upsertScoringTemplate('NFL', 'TE_PREMIUM', 'NFL_TE_PREMIUM', nflTePremiumRules)
  await upsertScoringTemplate('NFL', 'SUPERFLEX_DEFAULT', 'NFL_SUPERFLEX_DEFAULT', nflPprRules)

  const nflDefaultSlots: RosterSlotRow[] = [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'TE', allowedPositions: ['TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 3 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 4 },
    { slotName: 'K', allowedPositions: ['K'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 5 },
    { slotName: 'DST', allowedPositions: ['DST'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 6 },
    { slotName: 'BENCH', allowedPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], starterCount: 0, benchCount: 7, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 7 },
    { slotName: 'IR', allowedPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], starterCount: 0, benchCount: 0, reserveCount: 2, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 8 },
  ]
  await upsertRosterTemplate('NFL', 'standard', 'NFL_STANDARD_DEFAULT', nflDefaultSlots)
  await upsertRosterTemplate('NFL', 'PPR', 'NFL_DEFAULT', nflDefaultSlots)
  await upsertRosterTemplate('NFL', 'default', 'NFL_DEFAULT', nflDefaultSlots)
  const nfl3wr = nflDefaultSlots.map((s) => (s.slotName === 'WR' ? { ...s, starterCount: 3 } : s))
  await upsertRosterTemplate('NFL', '3_WR', 'NFL_3_WR', nfl3wr)
  const nfl2flex = nflDefaultSlots.map((s) => (s.slotName === 'FLEX' ? { ...s, starterCount: 2 } : s))
  await upsertRosterTemplate('NFL', '2_FLEX', 'NFL_2_FLEX', nfl2flex)
  const nflSfSlots: RosterSlotRow[] = [
    ...nflDefaultSlots.filter((s) => s.slotName !== 'FLEX'),
    { slotName: 'SUPERFLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 4 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 5 },
    { slotName: 'K', allowedPositions: ['K'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 6 },
    { slotName: 'DST', allowedPositions: ['DST'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 7 },
    { slotName: 'BENCH', allowedPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], starterCount: 0, benchCount: 7, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 8 },
    { slotName: 'IR', allowedPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], starterCount: 0, benchCount: 0, reserveCount: 2, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 9 },
  ]
  await upsertRosterTemplate('NFL', 'SUPERFLEX', 'NFL_SUPERFLEX', nflSfSlots)
  const nflDynastySlots: RosterSlotRow[] = [
    ...nflDefaultSlots.filter((s) => s.slotName !== 'BENCH' && s.slotName !== 'IR'),
    { slotName: 'BENCH', allowedPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], starterCount: 0, benchCount: 10, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 7 },
    { slotName: 'TAXI', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 0, taxiCount: 4, devyCount: 0, isFlexibleSlot: false, slotOrder: 8 },
    { slotName: 'IR', allowedPositions: ['QB', 'RB', 'WR', 'TE', 'K', 'DST'], starterCount: 0, benchCount: 0, reserveCount: 3, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 9 },
  ]
  await upsertRosterTemplate('NFL', 'dynasty', 'NFL_DYNASTY', nflDynastySlots)

  // Dynasty recommended 12-team: QB, RB×2, WR×2, TE×1, FLEX×2, SUPERFLEX×1, BENCH 14, IR 3, TAXI 4; no K/DST (PROMPT 2/5)
  const nflDynastySuperflexSlots: RosterSlotRow[] = [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'TE', allowedPositions: ['TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 3 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 4 },
    { slotName: 'SUPERFLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 5 },
    { slotName: 'BENCH', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 14, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 6 },
    { slotName: 'TAXI', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 0, taxiCount: 4, devyCount: 0, isFlexibleSlot: false, slotOrder: 7 },
    { slotName: 'IR', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 3, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 8 },
  ]
  await upsertRosterTemplate('NFL', 'dynasty_superflex', 'NFL_DYNASTY_SUPERFLEX', nflDynastySuperflexSlots)

  // Dynasty 1QB: no SUPERFLEX; QB, RB×2, WR×2, TE×1, FLEX×2, BENCH, TAXI, IR (no K/DST)
  const nflDynasty1qbSlots: RosterSlotRow[] = [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'TE', allowedPositions: ['TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 3 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 4 },
    { slotName: 'BENCH', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 14, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 5 },
    { slotName: 'TAXI', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 0, taxiCount: 4, devyCount: 0, isFlexibleSlot: false, slotOrder: 6 },
    { slotName: 'IR', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 3, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 7 },
  ]
  await upsertRosterTemplate('NFL', 'dynasty_1qb', 'NFL_DYNASTY_1QB', nflDynasty1qbSlots)

  // Dynasty 2QB: 2 QB, RB×2, WR×2, TE×1, FLEX×2, BENCH, TAXI, IR (no K/DST)
  const nflDynasty2qbSlots: RosterSlotRow[] = [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'TE', allowedPositions: ['TE'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 3 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 4 },
    { slotName: 'BENCH', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 14, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 5 },
    { slotName: 'TAXI', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 0, taxiCount: 4, devyCount: 0, isFlexibleSlot: false, slotOrder: 6 },
    { slotName: 'IR', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 0, reserveCount: 3, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 7 },
  ]
  await upsertRosterTemplate('NFL', 'dynasty_2qb', 'NFL_DYNASTY_2QB', nflDynasty2qbSlots)

  // TEP Dynasty: same roster as Superflex (TEP is scoring-only)
  await upsertRosterTemplate('NFL', 'dynasty_tep', 'NFL_DYNASTY_TEP', nflDynastySuperflexSlots)

  await upsertSportFeatureFlags('NFL', {
    supportsBestBall: true,
    supportsSuperflex: true,
    supportsTePremium: true,
    supportsKickers: true,
    supportsTeamDefense: true,
    supportsIdp: true,
    supportsWeeklyLineups: true,
    supportsDailyLineups: false,
    supportsBracketMode: false,
    supportsDevy: true,
    supportsTaxi: true,
    supportsIr: true,
  })
  await upsertScheduleTemplate('NFL', {
    name: 'NFL_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 14,
    playoffWeeks: 3,
    byeWeekWindow: { start: 5, end: 14 },
    fantasyPlayoffDefault: { startWeek: 15, endWeek: 17 },
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  })
  await upsertSeasonCalendar('NFL', {
    name: 'NFL_SEASON',
    formatType: 'DEFAULT',
    preseasonPeriod: { monthStart: 8, monthEnd: 8, label: 'August' },
    regularSeasonPeriod: { monthStart: 9, monthEnd: 1, label: 'September – January' },
    playoffsPeriod: null,
    championshipPeriod: { monthStart: 2, monthEnd: 2, label: 'Super Bowl (February)' },
    internationalBreaksSupported: false,
  })

  // ----- MLB -----
  const mlbRules: ScoringRuleRow[] = [
    { statKey: 'single', pointsValue: 1 },
    { statKey: 'double', pointsValue: 2 },
    { statKey: 'triple', pointsValue: 3 },
    { statKey: 'home_run', pointsValue: 4 },
    { statKey: 'rbi', pointsValue: 1 },
    { statKey: 'run', pointsValue: 1 },
    { statKey: 'stolen_base', pointsValue: 2 },
    { statKey: 'innings_pitched', pointsValue: 3 },
    { statKey: 'strikeouts_pitched', pointsValue: 1 },
    { statKey: 'win', pointsValue: 5 },
    { statKey: 'save', pointsValue: 5 },
    { statKey: 'earned_runs', pointsValue: -2 },
    { statKey: 'walk_allowed', pointsValue: -1 },
  ]
  await upsertScoringTemplate('MLB', 'standard', 'MLB_POINTS_DEFAULT', mlbRules)

  // Additional MLB scoring presets (AF Default, ESPN, Yahoo)
  const mlbAfRules: ScoringRuleRow[] = [
    { statKey: 'runs', pointsValue: 1 }, { statKey: 'singles', pointsValue: 1 }, { statKey: 'doubles', pointsValue: 2 },
    { statKey: 'triples', pointsValue: 3 }, { statKey: 'home_runs', pointsValue: 4 }, { statKey: 'rbis', pointsValue: 1 },
    { statKey: 'walks', pointsValue: 1 }, { statKey: 'hit_by_pitch', pointsValue: 1 }, { statKey: 'stolen_bases', pointsValue: 2 },
    { statKey: 'caught_stealing', pointsValue: -1 }, { statKey: 'strikeouts', pointsValue: -1 },
    { statKey: 'cycle_bonus', pointsValue: 5 }, { statKey: 'grand_slam_bonus', pointsValue: 1 },
    { statKey: 'innings_pitched', pointsValue: 3 }, { statKey: 'pitch_strikeouts', pointsValue: 1 },
    { statKey: 'wins', pointsValue: 5 }, { statKey: 'losses', pointsValue: -5 }, { statKey: 'saves', pointsValue: 5 },
    { statKey: 'holds', pointsValue: 3 }, { statKey: 'earned_runs', pointsValue: -2 }, { statKey: 'hits_allowed', pointsValue: -1 },
    { statKey: 'walks_allowed', pointsValue: -1 }, { statKey: 'hit_batters', pointsValue: -1 },
    { statKey: 'complete_games', pointsValue: 3 }, { statKey: 'complete_game_shutouts', pointsValue: 5 },
    { statKey: 'no_hitters', pointsValue: 10 }, { statKey: 'quality_starts', pointsValue: 3 }, { statKey: 'blown_saves', pointsValue: -2 },
  ]
  await upsertScoringTemplate('MLB', 'af_default', 'MLB_AF_DEFAULT', mlbAfRules)
  const mlbEspnRules: ScoringRuleRow[] = [
    { statKey: 'total_bases', pointsValue: 1 }, { statKey: 'runs', pointsValue: 1 }, { statKey: 'rbis', pointsValue: 1 },
    { statKey: 'walks', pointsValue: 1 }, { statKey: 'stolen_bases', pointsValue: 1 }, { statKey: 'strikeouts', pointsValue: -1 },
    { statKey: 'innings_pitched', pointsValue: 3 }, { statKey: 'wins', pointsValue: 5 }, { statKey: 'losses', pointsValue: -5 },
    { statKey: 'saves', pointsValue: 5 }, { statKey: 'pitch_strikeouts', pointsValue: 1 }, { statKey: 'earned_runs', pointsValue: -2 },
    { statKey: 'hits_allowed', pointsValue: -1 }, { statKey: 'walks_allowed', pointsValue: -1 },
  ]
  await upsertScoringTemplate('MLB', 'espn_default', 'MLB_ESPN_DEFAULT', mlbEspnRules)
  const mlbYahooRules: ScoringRuleRow[] = [
    { statKey: 'runs', pointsValue: 1 }, { statKey: 'singles', pointsValue: 1 }, { statKey: 'doubles', pointsValue: 2 },
    { statKey: 'triples', pointsValue: 3 }, { statKey: 'home_runs', pointsValue: 4 }, { statKey: 'rbis', pointsValue: 1 },
    { statKey: 'walks', pointsValue: 1 }, { statKey: 'hit_by_pitch', pointsValue: 1 }, { statKey: 'stolen_bases', pointsValue: 2 },
    { statKey: 'strikeouts', pointsValue: -0.5 }, { statKey: 'innings_pitched', pointsValue: 3 },
    { statKey: 'pitch_strikeouts', pointsValue: 1 }, { statKey: 'wins', pointsValue: 5 }, { statKey: 'saves', pointsValue: 5 },
    { statKey: 'holds', pointsValue: 2 }, { statKey: 'earned_runs', pointsValue: -2 }, { statKey: 'hits_allowed', pointsValue: -1 },
    { statKey: 'walks_allowed', pointsValue: -1 }, { statKey: 'losses', pointsValue: -3 }, { statKey: 'blown_saves', pointsValue: -1 },
  ]
  await upsertScoringTemplate('MLB', 'yahoo_default', 'MLB_YAHOO_DEFAULT', mlbYahooRules)

  const mlbSlots: RosterSlotRow[] = dailyLayoutSlotRows(DAILY_REDRAFT_ROSTER_LAYOUTS.MLB)
  await upsertRosterTemplate('MLB', 'standard', 'MLB_DEFAULT', mlbSlots)
  await upsertSportFeatureFlags('MLB', {
    supportsBestBall: true,
    supportsSuperflex: false,
    supportsTePremium: false,
    supportsKickers: false,
    supportsTeamDefense: false,
    supportsIdp: false,
    supportsWeeklyLineups: true,
    supportsDailyLineups: true,
    supportsBracketMode: false,
    supportsDevy: false,
    supportsTaxi: false,
    supportsIr: false,
  })
  await upsertScheduleTemplate('MLB', {
    name: 'MLB_POINTS_DEFAULT',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 26,
    playoffWeeks: 3,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'long-form',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  })
  await upsertSeasonCalendar('MLB', {
    name: 'MLB_SEASON',
    formatType: 'DEFAULT',
    preseasonPeriod: { monthStart: 3, monthEnd: 3, label: 'Spring training (March)' },
    regularSeasonPeriod: { monthStart: 4, monthEnd: 10, label: 'April – October' },
    playoffsPeriod: { monthStart: 10, monthEnd: 10, label: 'October' },
    championshipPeriod: { monthStart: 10, monthEnd: 10, label: 'World Series (late October)' },
    internationalBreaksSupported: false,
  })

  // ----- NHL -----
  const nhlRules: ScoringRuleRow[] = [
    { statKey: 'goal', pointsValue: 3 },
    { statKey: 'assist', pointsValue: 2 },
    { statKey: 'shot_on_goal', pointsValue: 0.5 },
    { statKey: 'hit', pointsValue: 0.5 },
    { statKey: 'save', pointsValue: 0.2 },
    { statKey: 'goal_allowed', pointsValue: -1 },
    { statKey: 'win', pointsValue: 5 },
    { statKey: 'shutout', pointsValue: 5 },
  ]
  await upsertScoringTemplate('NHL', 'standard', 'NHL_POINTS_DEFAULT', nhlRules)
  const nhlSlots: RosterSlotRow[] = dailyLayoutSlotRows(DAILY_REDRAFT_ROSTER_LAYOUTS.NHL)
  await upsertRosterTemplate('NHL', 'standard', 'NHL_DEFAULT', nhlSlots)
  await upsertSportFeatureFlags('NHL', {
    supportsBestBall: true,
    supportsSuperflex: false,
    supportsTePremium: false,
    supportsKickers: false,
    supportsTeamDefense: false,
    supportsIdp: false,
    supportsWeeklyLineups: true,
    supportsDailyLineups: false,
    supportsBracketMode: false,
    supportsDevy: false,
    supportsTaxi: false,
    supportsIr: true,
  })
  await upsertScheduleTemplate('NHL', {
    name: 'NHL_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 25,
    playoffWeeks: 4,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  })
  await upsertSeasonCalendar('NHL', {
    name: 'NHL_SEASON',
    formatType: 'DEFAULT',
    preseasonPeriod: null,
    regularSeasonPeriod: { monthStart: 10, monthEnd: 4, label: 'October – April' },
    playoffsPeriod: { monthStart: 4, monthEnd: 6, label: 'April – June' },
    championshipPeriod: null,
    internationalBreaksSupported: false,
  })

  // ----- NBA -----
  const nbaRules: ScoringRuleRow[] = [
    { statKey: 'points', pointsValue: 1 },
    { statKey: 'rebounds', pointsValue: 1.2 },
    { statKey: 'assists', pointsValue: 1.5 },
    { statKey: 'steals', pointsValue: 3 },
    { statKey: 'blocks', pointsValue: 3 },
    { statKey: 'turnovers', pointsValue: -1 },
  ]
  await upsertScoringTemplate('NBA', 'points', 'NBA_POINTS_DEFAULT', nbaRules)

  // Additional NBA scoring presets (AF Default, ESPN, Yahoo)
  const nbaAfDefaultRules: ScoringRuleRow[] = [
    { statKey: 'points_scored', pointsValue: 0.5 },
    { statKey: 'rebound', pointsValue: 1 },
    { statKey: 'assist', pointsValue: 1 },
    { statKey: 'steal', pointsValue: 2 },
    { statKey: 'block', pointsValue: 2 },
    { statKey: 'turnover', pointsValue: -1 },
    { statKey: 'double_double', pointsValue: 1 },
    { statKey: 'triple_double', pointsValue: 2 },
    { statKey: 'technical_foul', pointsValue: -2 },
    { statKey: 'flagrant_foul', pointsValue: -2 },
    { statKey: 'three_point_made', pointsValue: 0.5 },
    { statKey: 'forty_plus_points_bonus', pointsValue: 2 },
    { statKey: 'fifty_plus_points_bonus', pointsValue: 2 },
  ]
  await upsertScoringTemplate('NBA', 'af_default', 'NBA_AF_DEFAULT', nbaAfDefaultRules)
  const nbaEspnRules: ScoringRuleRow[] = [
    { statKey: 'points_scored', pointsValue: 1 },
    { statKey: 'three_point_made', pointsValue: 1 },
    { statKey: 'field_goals_attempted', pointsValue: -1 },
    { statKey: 'field_goals_made', pointsValue: 2 },
    { statKey: 'free_throws_attempted', pointsValue: -1 },
    { statKey: 'free_throws_made', pointsValue: 1 },
    { statKey: 'rebound', pointsValue: 1 },
    { statKey: 'assist', pointsValue: 2 },
    { statKey: 'steal', pointsValue: 4 },
    { statKey: 'block', pointsValue: 4 },
    { statKey: 'turnover', pointsValue: -2 },
  ]
  await upsertScoringTemplate('NBA', 'espn_default', 'NBA_ESPN_DEFAULT', nbaEspnRules)
  const nbaYahooRules: ScoringRuleRow[] = [
    { statKey: 'points_scored', pointsValue: 1 },
    { statKey: 'rebound', pointsValue: 1.2 },
    { statKey: 'assist', pointsValue: 1.5 },
    { statKey: 'block', pointsValue: 3 },
    { statKey: 'steal', pointsValue: 3 },
    { statKey: 'turnover', pointsValue: -1 },
  ]
  await upsertScoringTemplate('NBA', 'yahoo_default', 'NBA_YAHOO_DEFAULT', nbaYahooRules)

  const nbaSlots: RosterSlotRow[] = dailyLayoutSlotRows(DAILY_REDRAFT_ROSTER_LAYOUTS.NBA)
  await upsertRosterTemplate('NBA', 'points', 'NBA_DEFAULT', nbaSlots)
  await upsertSportFeatureFlags('NBA', {
    supportsBestBall: true,
    supportsSuperflex: false,
    supportsTePremium: false,
    supportsKickers: false,
    supportsTeamDefense: false,
    supportsIdp: false,
    supportsWeeklyLineups: true,
    supportsDailyLineups: true,
    supportsBracketMode: false,
    supportsDevy: true,
    supportsTaxi: true,
    supportsIr: true,
  })
  await upsertScheduleTemplate('NBA', {
    name: 'NBA_POINTS_DEFAULT',
    formatType: 'DEFAULT',
    matchupType: 'head_to_head_points',
    regularSeasonWeeks: 24,
    playoffWeeks: 4,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  })
  await upsertSeasonCalendar('NBA', {
    name: 'NBA_SEASON',
    formatType: 'DEFAULT',
    preseasonPeriod: null,
    regularSeasonPeriod: { monthStart: 10, monthEnd: 4, label: 'October – April' },
    playoffsPeriod: { monthStart: 4, monthEnd: 6, label: 'April – June' },
    championshipPeriod: null,
    internationalBreaksSupported: false,
  })

  // ----- SOCCER -----
  const soccerRules: ScoringRuleRow[] = [
    { statKey: 'goal', pointsValue: 5 },
    { statKey: 'assist', pointsValue: 3 },
    { statKey: 'shot_on_target', pointsValue: 1 },
    { statKey: 'clean_sheet', pointsValue: 4 },
    { statKey: 'yellow_card', pointsValue: -1 },
    { statKey: 'red_card', pointsValue: -3 },
  ]
  await upsertScoringTemplate('SOCCER', 'standard', 'SOCCER_POINTS_DEFAULT', soccerRules)
  const soccerSlots: RosterSlotRow[] = [
    { slotName: 'GKP', allowedPositions: ['GKP', 'GK'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'DEF', allowedPositions: ['DEF'], starterCount: 4, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'MID', allowedPositions: ['MID'], starterCount: 4, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'FWD', allowedPositions: ['FWD'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 3 },
    { slotName: 'BENCH', allowedPositions: ['GKP', 'DEF', 'MID', 'FWD'], starterCount: 0, benchCount: 4, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 4 },
  ]
  await upsertRosterTemplate('SOCCER', 'standard', 'SOCCER_DEFAULT', soccerSlots)
  await upsertSportFeatureFlags('SOCCER', {
    supportsBestBall: true,
    supportsSuperflex: false,
    supportsTePremium: false,
    supportsKickers: false,
    supportsTeamDefense: false,
    supportsIdp: false,
    supportsWeeklyLineups: true,
    supportsDailyLineups: false,
    supportsBracketMode: false,
    supportsDevy: false,
    supportsTaxi: false,
    supportsIr: false,
  })
  await upsertScheduleTemplate('SOCCER', {
    name: 'SOCCER_WEEKLY_MATCHDAY',
    formatType: 'DEFAULT',
    matchupType: 'weekly_matchday',
    regularSeasonWeeks: 38,
    playoffWeeks: 0,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'weekly',
    playoffSupport: false,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: false,
  })
  await upsertSeasonCalendar('SOCCER', {
    name: 'SOCCER_SEASON',
    formatType: 'DEFAULT',
    preseasonPeriod: null,
    regularSeasonPeriod: { monthStart: 8, monthEnd: 5, label: 'August – May' },
    playoffsPeriod: null,
    championshipPeriod: null,
    internationalBreaksSupported: true,
  })

  // ----- NCAAB -----
  const ncaabRules: ScoringRuleRow[] = [
    { statKey: 'points', pointsValue: 1 },
    { statKey: 'rebounds', pointsValue: 1.2 },
    { statKey: 'assists', pointsValue: 1.5 },
    { statKey: 'steals', pointsValue: 3 },
    { statKey: 'blocks', pointsValue: 3 },
    { statKey: 'turnovers', pointsValue: -1 },
  ]
  await upsertScoringTemplate('NCAAB', 'points', 'NCAAB_POINTS_DEFAULT', ncaabRules)
  const ncaabSlots: RosterSlotRow[] = [
    { slotName: 'G', allowedPositions: ['G', 'PG', 'SG'], starterCount: 3, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'F', allowedPositions: ['F', 'SF', 'PF'], starterCount: 3, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'UTIL', allowedPositions: ['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 2 },
    { slotName: 'BENCH', allowedPositions: ['G', 'F', 'C', 'PG', 'SG', 'SF', 'PF'], starterCount: 0, benchCount: 5, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 3 },
  ]
  await upsertRosterTemplate('NCAAB', 'points', 'NCAAB_DEFAULT', ncaabSlots)
  await upsertSportFeatureFlags('NCAAB', {
    supportsBestBall: true,
    supportsSuperflex: false,
    supportsTePremium: false,
    supportsKickers: false,
    supportsTeamDefense: false,
    supportsIdp: false,
    supportsWeeklyLineups: true,
    supportsDailyLineups: false,
    supportsBracketMode: true,
    supportsDevy: true,
    supportsTaxi: false,
    supportsIr: true,
  })
  await upsertScheduleTemplate('NCAAB', {
    name: 'NCAAB_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 18,
    playoffWeeks: 4,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'season_tournament',
    playoffSupport: true,
    bracketModeSupported: true,
    marchMadnessMode: true,
    bowlPlayoffMetadata: false,
  })
  await upsertSeasonCalendar('NCAAB', {
    name: 'NCAAB_SEASON',
    formatType: 'DEFAULT',
    preseasonPeriod: null,
    regularSeasonPeriod: { monthStart: 11, monthEnd: 3, label: 'November – March' },
    playoffsPeriod: { monthStart: 3, monthEnd: 4, label: 'March Madness (March – April)' },
    championshipPeriod: null,
    internationalBreaksSupported: false,
  })

  // ----- NCAAF -----
  const ncaafRules: ScoringRuleRow[] = [
    { statKey: 'passing_td', pointsValue: 4 },
    { statKey: 'rushing_td', pointsValue: 6 },
    { statKey: 'receiving_td', pointsValue: 6 },
    { statKey: 'passing_yards', pointsValue: 0.04 },
    { statKey: 'rushing_yards', pointsValue: 0.1 },
    { statKey: 'receiving_yards', pointsValue: 0.1 },
    { statKey: 'receptions', pointsValue: 1 },
    { statKey: 'fumble_lost', pointsValue: -2 },
    { statKey: 'two_pt_conversion', pointsValue: 2 },
    { statKey: 'passing_300_yard_bonus', pointsValue: 3 },
    { statKey: 'rushing_100_yard_bonus', pointsValue: 3 },
    { statKey: 'receiving_100_yard_bonus', pointsValue: 3 },
  ]
  await upsertScoringTemplate('NCAAF', 'PPR', 'NCAAF_POINTS_DEFAULT', ncaafRules)
  const ncaafSlots: RosterSlotRow[] = [
    { slotName: 'QB', allowedPositions: ['QB'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 0 },
    { slotName: 'RB', allowedPositions: ['RB'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 1 },
    { slotName: 'WR', allowedPositions: ['WR'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 2 },
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: 3 },
    { slotName: 'BENCH', allowedPositions: ['QB', 'RB', 'WR', 'TE'], starterCount: 0, benchCount: 7, reserveCount: 0, taxiCount: 0, devyCount: 0, isFlexibleSlot: false, slotOrder: 4 },
  ]
  await upsertRosterTemplate('NCAAF', 'PPR', 'NCAAF_DEFAULT', ncaafSlots)
  await upsertSportFeatureFlags('NCAAF', {
    supportsBestBall: true,
    supportsSuperflex: true,
    supportsTePremium: false,
    supportsKickers: false,
    supportsTeamDefense: false,
    supportsIdp: false,
    supportsWeeklyLineups: true,
    supportsDailyLineups: false,
    supportsBracketMode: false,
    supportsDevy: true,
    supportsTaxi: false,
    supportsIr: true,
  })
  await upsertScheduleTemplate('NCAAF', {
    name: 'NCAAF_WEEKLY_H2H',
    formatType: 'DEFAULT',
    matchupType: 'weekly_h2h',
    regularSeasonWeeks: 15,
    playoffWeeks: 2,
    byeWeekWindow: null,
    fantasyPlayoffDefault: null,
    lineupLockMode: 'weekly',
    scoringMode: 'head_to_head_points',
    regularSeasonStyle: 'short_season',
    playoffSupport: true,
    bracketModeSupported: false,
    marchMadnessMode: false,
    bowlPlayoffMetadata: true,
  })
  await upsertSeasonCalendar('NCAAF', {
    name: 'NCAAF_SEASON',
    formatType: 'DEFAULT',
    preseasonPeriod: null,
    regularSeasonPeriod: { monthStart: 8, monthEnd: 1, label: 'August/September – January' },
    playoffsPeriod: { monthStart: 12, monthEnd: 1, label: 'Bowl season (December – January)' },
    championshipPeriod: null,
    internationalBreaksSupported: false,
  })

  console.log('Sport config seed completed: scoring profiles, roster templates, feature flags, schedule templates, season calendars.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
