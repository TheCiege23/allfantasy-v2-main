/**
 * Resolves roster template by sport (and optional format).
 * Uses DB RosterTemplate + RosterTemplateSlot; falls back to in-memory defaults if no template exists.
 */
import { prisma } from '@/lib/prisma'
import { getPositionsForSport } from './SportRegistry'
import { toSportType, type SportType } from './sport-types'
import { getRosterDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'
import { isNflRedraftCoreDashboardLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import {
  allowedPositionsForCanonicalSlot,
  isFlexibleCanonicalSlot,
  readSavedRosterLayout,
} from '@/lib/redraft-core-contract/savedRosterLayout'

export interface RosterTemplateSlotDto {
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

export interface RosterTemplateDto {
  templateId: string
  sportType: SportType
  name: string
  formatType: string
  slots: RosterTemplateSlotDto[]
}

function buildInMemoryTemplate(
  sport: SportType,
  normalizedFormat: string,
  templateId?: string,
  name?: string
): RosterTemplateDto {
  return {
    templateId: templateId ?? `default-${sport}-${normalizedFormat}`,
    sportType: sport,
    name: name ?? `Default ${sport} ${normalizedFormat}`,
    formatType: normalizedFormat,
    slots: defaultSlotsForSport(sport, normalizedFormat),
  }
}

function isRosterTemplateSchemaCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /roster_templates\.(sportType|formatType)/i.test(message) ||
    /column .* does not exist/i.test(message) ||
    /Invalid `prisma\.rosterTemplate\.findUnique\(\)` invocation/i.test(message) ||
    /Unknown arg `sportType_formatType` in where\./i.test(message) ||
    /P2021|P2022/.test(message)
  )
}

function normalizeRosterFormatType(sportType: SportType, formatType: string): string {
  if (sportType !== 'NFL') return formatType
  const normalized = (formatType ?? '').toUpperCase()
  if (normalized === 'DYNASTY_IDP') return 'IDP'
  return formatType
}

/**
 * Build default NFL-style roster slots (for fallback when no DB template).
 * Slots: QB, RB, WR, TE, K, DST, FLEX, BENCH, IR.
 */
function defaultNflSlots(): RosterTemplateSlotDto[] {
  const positions = getPositionsForSport('NFL')
  const slots: RosterTemplateSlotDto[] = []
  const starters: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 }
  let order = 0
  for (const pos of positions) {
    const count = starters[pos] ?? 0
    if (count > 0) {
      slots.push({
        slotName: pos,
        allowedPositions: [pos],
        starterCount: count,
        benchCount: 0,
        reserveCount: 0,
        taxiCount: 0,
        devyCount: 0,
        isFlexibleSlot: false,
        slotOrder: order++,
      })
    }
  }
  slots.push({
    slotName: 'FLEX',
    allowedPositions: ['RB', 'WR', 'TE'],
    starterCount: 1,
    benchCount: 0,
    reserveCount: 0,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot: true,
    slotOrder: order++,
  })
  slots.push({
    slotName: 'BENCH',
    allowedPositions: [...positions],
    starterCount: 0,
    benchCount: 7,
    reserveCount: 0,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot: false,
    slotOrder: order++,
  })
  slots.push({
    slotName: 'IR',
    allowedPositions: [...positions],
    starterCount: 0,
    benchCount: 0,
    reserveCount: 2,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot: false,
    slotOrder: order++,
  })
  return slots
}

/** IDP fixed-position slot counts for NFL IDP / Dynasty IDP variant. */
const NFL_IDP_EXTRA_SLOTS: Record<string, number> = {
  DE: 2,
  DT: 1,
  LB: 2,
  CB: 2,
  S: 2,
}

/** IDP flexible slots: DL (DE+DT), DB (CB+S), IDP_FLEX (any IDP). */
const NFL_IDP_FLEX_SLOTS: { slotName: string; allowedPositions: string[] }[] = [
  { slotName: 'DL', allowedPositions: ['DE', 'DT'] },
  { slotName: 'DB', allowedPositions: ['CB', 'S'] },
  { slotName: 'IDP_FLEX', allowedPositions: ['DE', 'DT', 'LB', 'CB', 'S'] },
]

/**
 * Build default NFL IDP roster (offense + IDP fixed + IDP flex + BENCH/IR with full position set).
 * Offense: QB, RB, WR, TE, K, FLEX (no DST). IDP: DE, DT, LB, CB, S, DL, DB, IDP_FLEX. BENCH, IR accept all positions.
 */
function defaultNflIdpSlots(): RosterTemplateSlotDto[] {
  const base = defaultNflSlots()
  const idpPositions = getPositionsForSport('NFL', 'IDP')
  const starterOnly = base.filter(
    (s) => s.slotName !== 'BENCH' && s.slotName !== 'IR' && s.slotName !== 'DST'
  )
  const slots: RosterTemplateSlotDto[] = []
  let idx = 0

  for (const s of starterOnly) {
    slots.push({ ...s, slotOrder: idx++ })
  }
  for (const [slotName, count] of Object.entries(NFL_IDP_EXTRA_SLOTS)) {
    slots.push({
      slotName,
      allowedPositions: [slotName],
      starterCount: count,
      benchCount: 0,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: idx++,
    })
  }
  for (const flex of NFL_IDP_FLEX_SLOTS) {
    slots.push({
      slotName: flex.slotName,
      allowedPositions: flex.allowedPositions,
      starterCount: 1,
      benchCount: 0,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: true,
      slotOrder: idx++,
    })
  }
  const benchDef = base.find((s) => s.slotName === 'BENCH')
  const irDef = base.find((s) => s.slotName === 'IR')
  if (benchDef) {
    slots.push({
      ...benchDef,
      allowedPositions: [...idpPositions],
      slotOrder: idx++,
    })
  }
  if (irDef) {
    slots.push({
      ...irDef,
      allowedPositions: [...idpPositions],
      slotOrder: idx++,
    })
  }
  return slots
}

/** Flexible slot names (flex, util, superflex, pitcher flex, IDP flex, etc.). */
const FLEX_SLOT_NAMES = new Set(['FLEX', 'UTIL', 'G', 'F', 'SUPERFLEX', 'P', 'DL', 'DB', 'IDP_FLEX'])

/**
 * Build default roster slots from sport-defaults registry (single source of truth).
 * Used for NBA, MLB, NHL, NCAAF, NCAAB when no DB template exists.
 */
function buildDefaultSlotsFromRosterDefaults(
  sportType: SportType,
  formatType?: string
): RosterTemplateSlotDto[] {
  const def = getRosterDefaults(sportType, formatType)
  const slots: RosterTemplateSlotDto[] = []
  let order = 0
  const playerPositions = new Set<string>()

  for (const [slotName, count] of Object.entries(def.starter_slots)) {
    if (count <= 0) continue
    const flexDef = def.flex_definitions.find((f) => f.slotName === slotName)
    const allowedPositions = flexDef?.allowedPositions ?? [slotName]
    const isFlex = !!flexDef || FLEX_SLOT_NAMES.has(slotName)
    if (flexDef) flexDef.allowedPositions.forEach((p) => playerPositions.add(p))
    else if (!FLEX_SLOT_NAMES.has(slotName)) playerPositions.add(slotName)
    slots.push({
      slotName,
      allowedPositions,
      starterCount: count,
      benchCount: 0,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: isFlex,
      slotOrder: order++,
    })
  }

  const allPositions = playerPositions.size > 0 ? [...playerPositions] : getPositionsForSport(sportType, formatType)
  if (def.bench_slots > 0) {
    slots.push({
      slotName: 'BENCH',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: def.bench_slots,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  if (def.IR_slots > 0) {
    slots.push({
      slotName: 'IR',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: 0,
      reserveCount: def.IR_slots,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  if (def.taxi_slots > 0) {
    slots.push({
      slotName: 'TAXI',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: 0,
      reserveCount: 0,
      taxiCount: def.taxi_slots,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  if (def.devy_slots > 0) {
    slots.push({
      slotName: 'DEVY',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: 0,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: def.devy_slots,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  return slots
}

/**
 * Build roster template slots from a RosterDefaults object (e.g. IDP config-driven).
 */
function buildSlotsFromRosterDefaultsDef(
  def: { starter_slots: Record<string, number>; bench_slots: number; IR_slots: number; flex_definitions: Array<{ slotName: string; allowedPositions: string[] }> },
  allPositionsFallback: string[]
): RosterTemplateSlotDto[] {
  const slots: RosterTemplateSlotDto[] = []
  let order = 0
  const playerPositions = new Set<string>()
  for (const [slotName, count] of Object.entries(def.starter_slots)) {
    if (count <= 0) continue
    const flexDef = def.flex_definitions.find((f) => f.slotName === slotName)
    const allowedPositions = flexDef?.allowedPositions ?? [slotName]
    const isFlex = !!flexDef || FLEX_SLOT_NAMES.has(slotName)
    if (flexDef) flexDef.allowedPositions.forEach((p) => playerPositions.add(p))
    else if (!FLEX_SLOT_NAMES.has(slotName)) playerPositions.add(slotName)
    slots.push({
      slotName,
      allowedPositions,
      starterCount: count,
      benchCount: 0,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: isFlex,
      slotOrder: order++,
    })
  }
  const allPositions = playerPositions.size > 0 ? [...playerPositions] : allPositionsFallback
  if (def.bench_slots > 0) {
    slots.push({
      slotName: 'BENCH',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: def.bench_slots,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  if (def.IR_slots > 0) {
    slots.push({
      slotName: 'IR',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: 0,
      reserveCount: def.IR_slots,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  return slots
}

/**
 * Build default slots for a sport (and optional format). NFL and SOCCER use custom builders; others use registry.
 */
function defaultSlotsForSport(sportType: SportType, formatType?: string): RosterTemplateSlotDto[] {
  const normalizedFormat = normalizeRosterFormatType(sportType, formatType ?? 'standard')
  if (sportType === 'NFL') {
    if (normalizedFormat === 'IDP' || normalizedFormat === 'idp') return defaultNflIdpSlots()
    if (String(normalizedFormat).toLowerCase() === 'devy_dynasty') {
      return buildDefaultSlotsFromRosterDefaults(sportType, 'devy_dynasty')
    }
    return defaultNflSlots()
  }
  if (sportType === 'SOCCER') return defaultSoccerSlots()
  return buildDefaultSlotsFromRosterDefaults(sportType, normalizedFormat)
}

/**
 * Build default Soccer roster slots (GKP/GK, DEF, MID, FWD, UTIL, BENCH, IR).
 * GKP slot accepts both GKP and GK positions for commissioner/feed flexibility.
 */
function defaultSoccerSlots(): RosterTemplateSlotDto[] {
  const playerPositions = ['GKP', 'GK', 'DEF', 'MID', 'FWD']
  const slots: RosterTemplateSlotDto[] = []
  const starters: Record<string, number> = { GKP: 1, DEF: 4, MID: 4, FWD: 2, UTIL: 1 }
  let order = 0
  for (const pos of ['GKP', 'DEF', 'MID', 'FWD', 'UTIL']) {
    const count = starters[pos] ?? 0
    if (count > 0) {
      slots.push({
        slotName: pos,
        allowedPositions: pos === 'UTIL' ? [...playerPositions] : pos === 'GKP' ? ['GKP', 'GK'] : [pos],
        starterCount: count,
        benchCount: 0,
        reserveCount: 0,
        taxiCount: 0,
        devyCount: 0,
        isFlexibleSlot: pos === 'UTIL',
        slotOrder: order++,
      })
    }
  }
  slots.push({
    slotName: 'BENCH',
    allowedPositions: [...playerPositions],
    starterCount: 0,
    benchCount: 4,
    reserveCount: 0,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot: false,
    slotOrder: order++,
  })
  slots.push({
    slotName: 'IR',
    allowedPositions: [...playerPositions],
    starterCount: 0,
    benchCount: 0,
    reserveCount: 1,
    taxiCount: 0,
    devyCount: 0,
    isFlexibleSlot: false,
    slotOrder: order++,
  })
  return slots
}

/**
 * 🛑 AN NFL / NCAAF REDRAFT LEAGUE'S OWN SAVED LAYOUT BEATS THE SPORT DEFAULT (owner, 2026-10-20).
 *
 * Without this, a redraft-core league with no `<sport>_roster_config` resolved to the global DB template
 * or the in-memory sport default, never to its own saved `starter_slots` — so the lineup editor, league
 * home, roster legality and lineup scans showed the DEFAULT lineup. Once the defaults carry FLEX and K
 * again, a league saved with QB, RB, WR, WR, TE, DEF would show empty FLEX / K slots. A league with no
 * saved layout still falls through to the defaults. Scoped to the redraft-core shell
 * (`isNflRedraftCoreDashboardLeague`), so dynasty / keeper / devy / IDP / best ball resolve as before.
 */
function savedFootballRedraftTemplate(
  league: {
    settings: unknown
    sport: string | null
    leagueType?: string | null
    isDynasty?: boolean | null
    leagueVariant?: string | null
    bestBallMode?: boolean | null
    guillotineMode?: boolean | null
    keeperPhaseActive?: boolean | null
  },
  leagueId: string,
  normalizedFormat: string,
): RosterTemplateDto | null {
  const sportRaw = String(league.sport ?? '').toUpperCase()
  if (sportRaw !== 'NFL' && sportRaw !== 'NCAAF') return null
  if (
    !isNflRedraftCoreDashboardLeague({
      sport: sportRaw,
      leagueType: league.leagueType,
      isDynasty: league.isDynasty,
      leagueVariant: league.leagueVariant,
      bestBallMode: league.bestBallMode,
      guillotineMode: league.guillotineMode,
      keeperPhaseActive: league.keeperPhaseActive,
    })
  ) {
    return null
  }
  const saved = readSavedRosterLayout(sportRaw, league.settings)
  if (!saved || saved.starterOrder.length === 0) return null

  const fallback = getRosterDefaults(sportRaw)
  // This template's vocabulary (defaultNflSlots, the registry): FLEX / SUPERFLEX / DST.
  const templateName = (token: string) =>
    token === 'FLX' ? 'FLEX' : token === 'SF' ? 'SUPERFLEX' : token === 'DEF' ? 'DST' : token
  const counts = new Map<string, number>()
  for (const token of saved.starterOrder) counts.set(token, (counts.get(token) ?? 0) + 1)

  const slots: RosterTemplateSlotDto[] = []
  const playerPositions = new Set<string>()
  let order = 0
  for (const [token, count] of counts) {
    const allowedPositions = allowedPositionsForCanonicalSlot(token)
    allowedPositions.forEach((position) => playerPositions.add(position))
    slots.push({
      slotName: templateName(token),
      allowedPositions,
      starterCount: count,
      benchCount: 0,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: isFlexibleCanonicalSlot(token),
      slotOrder: order++,
    })
  }
  const allPositions = [...playerPositions]
  const bench = saved.benchSlots ?? fallback.bench_slots
  const ir = saved.irSlots ?? fallback.IR_slots
  if (bench > 0) {
    slots.push({
      slotName: 'BENCH',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: bench,
      reserveCount: 0,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  if (ir > 0) {
    slots.push({
      slotName: 'IR',
      allowedPositions: allPositions,
      starterCount: 0,
      benchCount: 0,
      reserveCount: ir,
      taxiCount: 0,
      devyCount: 0,
      isFlexibleSlot: false,
      slotOrder: order++,
    })
  }
  return {
    templateId: `saved-${sportRaw}-${leagueId}`,
    sportType: sportRaw,
    name: 'Saved League Roster',
    formatType: normalizedFormat,
    slots,
  }
}

/**
 * Get roster template for sport (and optional format). Prefer DB; else in-memory default.
 * When leagueId is provided and league is IDP with config, uses commissioner IDP preset (roster slots from IdpLeagueConfig).
 */
export async function getRosterTemplate(
  sportType: SportType | string,
  formatType: string = 'standard',
  leagueId?: string
): Promise<RosterTemplateDto> {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  const normalizedFormat = normalizeRosterFormatType(sport, formatType)

  // Check for commissioner-customized roster config in League.settings (any sport)
  if (leagueId) {
    try {
      const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: {
          settings: true,
          sport: true,
          leagueType: true,
          isDynasty: true,
          leagueVariant: true,
          bestBallMode: true,
          guillotineMode: true,
          keeperPhaseActive: true,
        },
      })
      const settings = (league?.settings as Record<string, unknown>) ?? {}
      const sportPrefix = `${(league?.sport ?? sport).toLowerCase()}_roster_`
      const customConfig = settings[`${sportPrefix}config`] as Record<string, unknown> | undefined
      if (customConfig?.slots && typeof customConfig.slots === 'object') {
        const customSlots = customConfig.slots as Record<string, number>

        // Load sport-specific slot definitions for eligible positions
        let slotDefsMap: Map<string, string[]> | null = null
        try {
          if (sport === 'NFL') {
            const { NFL_SLOT_MAP } = await import('@/lib/nfl-roster/NflRosterTemplates')
            slotDefsMap = new Map([...NFL_SLOT_MAP].map(([k, v]) => [k, v.eligiblePositions]))
          } else if (sport === 'NBA') {
            const { NBA_SLOT_MAP } = await import('@/lib/nba-roster/NbaRosterTemplates')
            slotDefsMap = new Map([...NBA_SLOT_MAP].map(([k, v]) => [k, v.eligiblePositions]))
          } else if (sport === 'NCAAB') {
            const { NCAAB_SLOT_MAP } = await import('@/lib/ncaab-roster/NcaabRosterTemplates')
            slotDefsMap = new Map([...NCAAB_SLOT_MAP].map(([k, v]) => [k, v.eligiblePositions]))
          } else if (sport === 'MLB') {
            const { MLB_SLOT_MAP } = await import('@/lib/mlb-roster/MlbRosterTemplates')
            slotDefsMap = new Map([...MLB_SLOT_MAP].map(([k, v]) => [k, v.eligiblePositions]))
          } else if (sport === 'NCAAF') {
            const { NCAAF_SLOT_MAP } = await import('@/lib/ncaaf-roster/NcaafRosterTemplates')
            slotDefsMap = new Map([...NCAAF_SLOT_MAP].map(([k, v]) => [k, v.eligiblePositions]))
          } else if (sport === 'NHL') {
            const { NHL_SLOT_MAP } = await import('@/lib/nhl-roster/NhlRosterTemplates')
            slotDefsMap = new Map([...NHL_SLOT_MAP].map(([k, v]) => [k, v.eligiblePositions]))
          } else if (sport === 'SOCCER') {
            const { SOCCER_SLOT_MAP } = await import('@/lib/soccer-roster/SoccerRosterTemplates')
            slotDefsMap = new Map([...SOCCER_SLOT_MAP].map(([k, v]) => [k, v.eligiblePositions]))
          }
        } catch { /* fall through to generic */ }

        const reserveSlots = new Set([
          'BN', 'IR', 'IL', 'IL_PLUS', 'IR_PLUS', 'TAXI', 'DEVY', 'CAMPUS',
          // MLB
          'NA', 'PROSPECT', 'RIGHTS', 'MINORS',
          // NHL
          'RESERVE',
          // Soccer
          'YOUTH', 'DEVELOPMENT', 'ACADEMY',
        ])
        const flexSlots = new Set([
          'FLEX', 'SUPERFLEX', 'UTIL', 'SUPER_UTIL', 'IDP_FLEX',
          // NFL
          'FLEX_WR_RB', 'FLEX_WR_TE',
          // NBA/NCAAB
          'FLEX_PG_SG', 'FLEX_SF_PF', 'FLEX_G_F', 'FLEX_F_C',
          // NHL
          'FLEX_CW', 'FLEX_LW_RW', 'FLEX_FD', 'W', 'SKT',
          // Soccer
          'FLEX_DEF_MID', 'FLEX_MID_FWD',
          // MLB
          'CI', 'MI', 'H', 'P',
        ])

        const slots = Object.entries(customSlots)
          .filter(([, count]) => (count as number) > 0)
          .map(([slotName, count], idx) => {
            const isReserve = reserveSlots.has(slotName) || slotName.startsWith('C2C_BN')
            const isBench = slotName === 'BN' || slotName.startsWith('C2C_BN')
            const isTaxi = slotName === 'TAXI'
            const isDevy = slotName === 'DEVY' || slotName === 'CAMPUS'
            const isFlex = flexSlots.has(slotName) || slotName.includes('FLEX') || slotName.startsWith('C2C_UTIL')

            return {
              slotName,
              allowedPositions: slotDefsMap?.get(slotName) ?? [slotName],
              starterCount: isReserve ? 0 : (count as number),
              benchCount: isBench ? (count as number) : 0,
              reserveCount: (isReserve && !isBench) ? (count as number) : 0,
              taxiCount: isTaxi ? (count as number) : 0,
              devyCount: isDevy ? (count as number) : 0,
              isFlexibleSlot: isFlex,
              slotOrder: idx,
            }
          })

        return {
          templateId: `custom-${sport}-${leagueId}`,
          sportType: sport,
          name: 'Custom League Roster',
          formatType: normalizedFormat,
          slots,
        }
      }

      const savedTemplate = league ? savedFootballRedraftTemplate(league, leagueId, normalizedFormat) : null
      if (savedTemplate) return savedTemplate
    } catch {
      // Fall through to standard resolution
    }
  }

  if (
    leagueId &&
    supportsIdpLeagueSport(sport) &&
    (normalizedFormat === 'IDP' || normalizedFormat === 'idp' || normalizedFormat === 'DYNASTY_IDP')
  ) {
    try {
      const { getRosterDefaultsForIdpLeague } = await import('@/lib/idp/IDPLeagueConfig')
      const idpDefaults = await getRosterDefaultsForIdpLeague(leagueId)
      if (idpDefaults) {
        const positions = getPositionsForSport(sport, 'IDP')
        const slots = buildSlotsFromRosterDefaultsDef(idpDefaults, positions)
        return {
          templateId: `default-${sport}-IDP-${leagueId}`,
          sportType: sport,
          name: 'IDP League Roster',
          formatType: 'IDP',
          slots,
        }
      }
    } catch {
      // fall through to default
    }
  }
  let template: {
    id: string
    name: string
    formatType: string
    slots: Array<{
      slotName: string
      allowedPositions: unknown
      starterCount: number
      benchCount: number
      reserveCount: number
      taxiCount: number
      devyCount: number
      isFlexibleSlot: boolean
      slotOrder: number
    }>
  } | null = null
  try {
    template = await prisma.rosterTemplate.findUnique({
      where: {
        sportType_formatType: { sportType: sport, formatType: normalizedFormat },
      },
      include: { slots: { orderBy: { slotOrder: 'asc' } } },
    })
  } catch (error) {
    if (isRosterTemplateSchemaCompatibilityError(error)) {
      console.warn(
        `[RosterTemplateService] roster template schema mismatch for ${sport}/${normalizedFormat}; using in-memory defaults`
      )
      return buildInMemoryTemplate(sport, normalizedFormat)
    }
    throw error
  }
  if (template) {
    return {
      templateId: template.id,
      sportType: sport,
      name: template.name,
      formatType: template.formatType,
      slots: template.slots.map((s) => ({
        slotName: s.slotName,
        allowedPositions: (s.allowedPositions as string[]) ?? [],
        starterCount: s.starterCount,
        benchCount: s.benchCount,
        reserveCount: s.reserveCount,
        taxiCount: s.taxiCount,
        devyCount: s.devyCount,
        isFlexibleSlot: s.isFlexibleSlot,
        slotOrder: s.slotOrder,
      })),
    }
  }
  return buildInMemoryTemplate(sport, normalizedFormat)
}

/**
 * Ensure a league has a roster config (template id + overrides). Creates from template if missing.
 * When only in-memory default exists, no DB row is created; we return the default template id.
 */
export async function getOrCreateLeagueRosterConfig(
  leagueId: string,
  sportType: SportType | string,
  formatType: string = 'standard'
): Promise<{ templateId: string; overrides: Record<string, unknown> | null }> {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  const normalizedFormat = normalizeRosterFormatType(sport, formatType)
  const existing = await prisma.leagueRosterConfig.findUnique({
    where: { leagueId },
  })
  if (existing) {
    return {
      templateId: existing.templateId,
      overrides: (existing.overrides as Record<string, unknown>) ?? null,
    }
  }
  const template = await getRosterTemplate(sport, normalizedFormat)
  const isDefault = template.templateId.startsWith('default-')
  if (!isDefault) {
    await prisma.leagueRosterConfig.create({
      data: { leagueId, templateId: template.templateId, overrides: undefined },
    })
  }
  return { templateId: template.templateId, overrides: null }
}
