/**
 * Single source of truth for supported sports across the app.
 * Use this for sport-aware abstractions, resolvers, templates, and filters.
 *
 * SPORT SCOPE: Always support these sports unless explicitly told otherwise:
 * - NFL, NHL, NBA, MLB, NCAA Basketball (NCAAB), NCAA Football (NCAAF), Soccer
 */
import type { LeagueSport } from '@prisma/client'

/**
 * All supported league sports (values match Prisma `LeagueSport`).
 * Order: major US leagues, then NCAA, then soccer (EURO / UEFA in product UI).
 */
export const SUPPORTED_SPORTS: LeagueSport[] = [
  'NFL',
  'NBA',
  'NHL',
  'MLB',
  'NCAAF',
  'NCAAB',
  'SOCCER',
]

/** Rolling Insights / DataFeeds imports only these league sports (same seven as `SUPPORTED_SPORTS`). */
export const ROLLING_INSIGHTS_LEAGUE_SPORTS = SUPPORTED_SPORTS

/** Default sport when league/context has no sport (first in list; do not hardcode one sport). */
export const DEFAULT_SPORT: LeagueSport = SUPPORTED_SPORTS[0]!

/**
 * Devy and Campus-to-Canton (C2C) create flows: primary pro league only
 * (NCAAF / NCAAB college pools pair as NFL↔NCAAF, NBA↔NCAAB in defaults).
 */
export const COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS: LeagueSport[] = ['NFL', 'NBA']

/** @alias COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS */
export const DEVY_WIZARD_PRIMARY_SPORTS = COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS

/** @alias COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS */
export const C2C_WIZARD_PRIMARY_SPORTS = COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS

/** Type for supported sport string (aligns with LeagueSport). */
export type SupportedSport = LeagueSport

/** IDP leagues are explicitly supported only for pro + college football. */
export const IDP_SUPPORTED_SPORTS: readonly LeagueSport[] = ['NFL', 'NCAAF']

/** IDP create-flow draft types (pick-order + execution modes). */
export const IDP_ALLOWED_DRAFT_TYPES = ['snake', 'linear', 'auction', 'offline', 'auto'] as const
export type IdpAllowedDraftType = (typeof IDP_ALLOWED_DRAFT_TYPES)[number]

export function isSupportedSport(s: string | null | undefined): s is LeagueSport {
  if (s == null || typeof s !== 'string') return false
  return (SUPPORTED_SPORTS as readonly string[]).includes(s.toUpperCase())
}

/**
 * Normalize vendor / UI aliases to Prisma `LeagueSport`.
 * Rolling Insights uses `NCAAFB` / `CFB` while leagues store `NCAAF`; `NCAABB` maps to `NCAAB`.
 */
export function normalizeToSupportedSport(sport: string | null | undefined): LeagueSport {
  const raw = sport?.trim() ?? ''
  if (!raw) return DEFAULT_SPORT
  const u = raw.toUpperCase().replace(/[\s-]+/g, '_')

  if (
    u === 'NCAAFB' ||
    u === 'CFB' ||
    u === 'NCAAF' ||
    u === 'NCAA_FOOTBALL' ||
    u === 'COLLEGE_FOOTBALL' ||
    u === 'NCAA_FB' ||
    u === 'NCAA_F'
  ) {
    return 'NCAAF'
  }
  if (u === 'NCAABB' || u === 'NCAA_BASKETBALL' || u === 'NCAAM' || u === 'NCAAB_ALL') {
    return 'NCAAB'
  }

  if (
    u === 'EURO' ||
    u === 'UEFA' ||
    u === 'EURO_SOCCER' ||
    u === 'EPL' ||
    u === 'PREMIER_LEAGUE' ||
    u === 'ENGLISH_PREMIER_LEAGUE' ||
    u === 'LALIGA' ||
    u === 'LA_LIGA' ||
    u === 'LA_LIGA_SPAIN' ||
    u === 'SERIEA' ||
    u === 'SERIE_A' ||
    u === 'ITALIAN_SERIE_A'
  ) {
    return 'SOCCER'
  }

  if ((SUPPORTED_SPORTS as readonly string[]).includes(u)) return u as LeagueSport
  return DEFAULT_SPORT
}

export function supportsIdpLeagueSport(sport: string | null | undefined): boolean {
  const normalized = normalizeToSupportedSport(sport)
  return (IDP_SUPPORTED_SPORTS as readonly string[]).includes(normalized)
}

export function isAllowedIdpDraftType(draftType: string | null | undefined): draftType is IdpAllowedDraftType {
  const normalized = String(draftType ?? '').trim().toLowerCase()
  return (IDP_ALLOWED_DRAFT_TYPES as readonly string[]).includes(normalized)
}
