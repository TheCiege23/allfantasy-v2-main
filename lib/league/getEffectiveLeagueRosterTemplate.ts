/**
 * Single resolver for a league’s effective roster template — base template + format + commissioner
 * overrides via `getRosterTemplate` (see `RosterTemplateService`).
 *
 * Draft, waivers, lineup, and AI should consume this (or fields derived here), not ad hoc slot strings.
 */

import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isIdpLeague } from '@/lib/idp'
import { leagueSportToSportType } from '@/lib/multi-sport/SportConfigResolver'
import type { SportType } from '@/lib/multi-sport/sport-types'
import {
  getRosterTemplate,
  type RosterTemplateDto,
  type RosterTemplateSlotDto,
} from '@/lib/multi-sport/RosterTemplateService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'
import { normalizePositionToken } from '@/lib/auto-sub-lineup-engine/normalize-position'

const SUPERFLEX_SLOT_RE = /^SUPER[_\s]?FLEX$|^SUPERFLEX$|^SFLEX$/i

function normalizePositionTokenForSet(p: string): string {
  return String(p ?? '')
    .trim()
    .toUpperCase()
}

/**
 * Union of player positions that may appear on the roster (starters, flex, bench/IR/taxi as modeled by slot allowedPositions).
 */
export function allowedPlayerPositionsFromTemplate(template: RosterTemplateDto): Set<string> {
  const set = new Set<string>()
  for (const slot of template.slots) {
    for (const p of slot.allowedPositions ?? []) {
      const u = normalizePositionTokenForSet(p)
      if (u) set.add(u)
    }
  }
  return set
}

/**
 * Positions that can fill a **starting** lineup slot (starters + flex rows with starterCount &gt; 0).
 * Excludes pure bench / IR / taxi rows whose allowed lists are often “any rostered position”, so e.g. kickers
 * do not appear in the draft pool when the league has no K starter (only BN could hold a K otherwise).
 */
export function starterEligiblePlayerPositionsFromTemplate(template: RosterTemplateDto): Set<string> {
  const set = new Set<string>()
  for (const slot of template.slots) {
    if ((slot.starterCount ?? 0) <= 0) continue
    for (const p of slot.allowedPositions ?? []) {
      const u = normalizePositionToken(String(p ?? '').trim()).toUpperCase()
      if (u) set.add(u)
    }
  }
  return set
}

function classifyFlexSlots(slots: RosterTemplateSlotDto[]): { flexSlotNames: string[]; superflexSlotNames: string[] } {
  const flexSlotNames: string[] = []
  const superflexSlotNames: string[] = []
  for (const slot of slots) {
    const name = String(slot.slotName ?? '').trim()
    if (!name) continue
    const isSuper = SUPERFLEX_SLOT_RE.test(name)
    const isFlexLike =
      isSuper ||
      slot.isFlexibleSlot ||
      /^FLEX/i.test(name) ||
      name === 'UTIL' ||
      name === 'SUPER_UTIL' ||
      name === 'IDP_FLEX' ||
      /^FLEX_/i.test(name)
    if (isSuper) superflexSlotNames.push(name)
    else if (isFlexLike) flexSlotNames.push(name)
  }
  return { flexSlotNames, superflexSlotNames }
}

/**
 * Detect Sleeper-style / commissioner-persisted roster schema (not merely “default template exists”).
 */
export function detectPersistedRosterSchema(
  leagueSport: LeagueSport,
  settings: Record<string, unknown> | null | undefined,
  starters: unknown,
): boolean {
  if (Array.isArray(starters) && starters.length > 0) return true
  if (starters && typeof starters === 'object' && !Array.isArray(starters)) {
    for (const [, v] of Object.entries(starters as Record<string, unknown>)) {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n) && n > 0) return true
    }
  }
  if (Array.isArray(settings?.rosterPositions) && (settings!.rosterPositions as unknown[]).length > 0) return true

  const prefix = `${String(leagueSport).toLowerCase()}_roster_config`
  const custom = settings?.[prefix] as { slots?: Record<string, unknown> } | undefined
  if (custom?.slots && typeof custom.slots === 'object') {
    for (const [, v] of Object.entries(custom.slots)) {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n) && n > 0) return true
    }
  }
  return false
}

export type EffectiveLeagueRosterTemplate = {
  leagueId: string
  sport: LeagueSport
  /** Format string passed through to `getRosterTemplate` after variant + IDP resolution */
  formatType: string
  leagueVariant: string | null
  /** True when league uses IDP template path (variant or `isIdpLeague`) */
  idpEnabled: boolean
  template: RosterTemplateDto
  /** Full roster union (starters + bench/IR/taxi allowed lists) — capacity / post-draft eligibility, not draft targeting. */
  allowedPositions: ReadonlySet<string>
  /**
   * Positions that can fill a starting slot (`starterCount` &gt; 0). Draft pool / autopick / queue validation
   * should use this (with empty fallback to {@link allowedPositions}), not the full union.
   */
  starterEligiblePositions: ReadonlySet<string>
  flexSlotNames: string[]
  superflexSlotNames: string[]
  /**
   * True when imported or commissioner-persisted roster slots exist (`starters`, `settings.rosterPositions`,
   * or sport-specific `*_roster_config.slots`). When false, product policy: do not treat draft as configured.
   */
  hasPersistedRosterSchema: boolean
}

function resolveFormatTypeForLeague(params: {
  sportType: SportType
  leagueVariant: string | null | undefined
  isIdpFromDb: boolean
}): string {
  let formatType = getFormatTypeForVariant(params.sportType, params.leagueVariant)
  const v = String(params.leagueVariant ?? '').toLowerCase()
  const isDevyVariant = v === 'devy_dynasty' || v === 'devy'

  if (supportsIdpLeagueSport(params.sportType) && params.isIdpFromDb && !isDevyVariant) {
    formatType = 'IDP'
  }
  return formatType
}

const TEMPLATE_MEMO_TTL_MS = 20_000
const effectiveTemplateMemo = new Map<string, { at: number; value: EffectiveLeagueRosterTemplate }>()

/** Bust after commissioner roster save or tests; also used by `invalidateLeagueDraftCaches`. */
export function clearEffectiveLeagueRosterTemplateCache(leagueId: string): void {
  effectiveTemplateMemo.delete(leagueId)
}

/**
 * Resolve the single effective roster template for a league (async; loads league + IDP flag).
 */
export async function getEffectiveLeagueRosterTemplate(leagueId: string): Promise<EffectiveLeagueRosterTemplate> {
  const memo = effectiveTemplateMemo.get(leagueId)
  if (memo && Date.now() - memo.at < TEMPLATE_MEMO_TTL_MS) {
    return memo.value
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      leagueVariant: true,
      settings: true,
      starters: true,
    },
  })

  if (!league) {
    throw new Error(`League not found: ${leagueId}`)
  }

  const sport = league.sport
  const sportType = leagueSportToSportType(sport)
  const settings = (league.settings as Record<string, unknown>) ?? {}

  const isIdpFromDb = await isIdpLeague(leagueId)

  const formatType = resolveFormatTypeForLeague({
    sportType,
    leagueVariant: league.leagueVariant,
    isIdpFromDb,
  })

  const template = await getRosterTemplate(sportType, formatType, leagueId)
  const allowedPositions = allowedPlayerPositionsFromTemplate(template)
  const starterEligiblePositions = starterEligiblePlayerPositionsFromTemplate(template)
  const { flexSlotNames, superflexSlotNames } = classifyFlexSlots(template.slots)

  const idpEnabled =
    formatType.toUpperCase() === 'IDP' ||
    (supportsIdpLeagueSport(sport) && isIdpFromDb)

  const rosterCfgRow = await prisma.leagueRosterConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  const hasPersistedRosterSchema =
    detectPersistedRosterSchema(sport, settings, league.starters) || Boolean(rosterCfgRow)

  const result: EffectiveLeagueRosterTemplate = {
    leagueId: league.id,
    sport,
    formatType: template.formatType ?? formatType,
    leagueVariant: league.leagueVariant ?? null,
    idpEnabled,
    template,
    allowedPositions,
    starterEligiblePositions,
    flexSlotNames,
    superflexSlotNames,
    hasPersistedRosterSchema,
  }
  effectiveTemplateMemo.set(leagueId, { at: Date.now(), value: result })
  return result
}
