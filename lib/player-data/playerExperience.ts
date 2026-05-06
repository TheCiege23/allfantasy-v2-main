/**
 * Sport-aware pro experience / rookie-veteran resolution.
 * Does not invent signals — unknown is valid when no provider stores usable fields.
 */

import type { LeagueSport } from '@prisma/client'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  extractExperienceSignalsFromProviderPayload,
  getExperienceSignalsFromSportsPlayer,
  type ProviderExperienceSignal,
} from '@/lib/player-data/providerExperienceFields'
import { getCollegeClassBucket, normalizeCollegeClass } from '@/lib/draft-room/collegeClass'
import { resolveNflRookieSource } from '@/lib/providers/nflRookieSourcePolicy'

export type ProSport = 'NFL' | 'NBA' | 'MLB' | 'NHL'

export type PlayerExperienceStatus = 'rookie' | 'veteran' | 'college' | 'devy' | 'unknown'

export type PlayerExperienceSource =
  | 'rolling_insights_imported'
  | 'thesportsdb'
  | 'clearsports'
  | 'sleeper_years_exp'
  | 'sportsdata_cache'
  | 'derived_from_draft_year'
  | 'derived_from_debut_year'
  | 'college_class'
  | 'manual'
  | 'unknown'

export type PlayerExperienceResult = {
  status: PlayerExperienceStatus
  proYears: number | null
  draftYear: number | null
  debutYear: number | null
  rookie: boolean | null
  veteran: boolean | null
  collegeClass: string | null
  collegeClassBucket: string | null
  devyEligible: boolean
  c2cEligible: boolean
  taxiEligibleDefault: boolean
  source: PlayerExperienceSource
  reason: string
}

function mapSignalSource(s: ProviderExperienceSignal['source']): PlayerExperienceSource {
  switch (s) {
    case 'rolling_insights':
      return 'rolling_insights_imported'
    case 'thesportsdb':
      return 'thesportsdb'
    case 'clearsports':
      return 'clearsports'
    case 'sleeper':
      return 'sleeper_years_exp'
    case 'derived_from_draft_year':
      return 'derived_from_draft_year'
    case 'derived_from_debut_year':
      return 'derived_from_debut_year'
    default:
      return 'unknown'
  }
}

export function calculateProYearsFromDraftYear(
  draftYear: number | null | undefined,
  currentSeason: number,
): { proYears: number | null; source: PlayerExperienceSource; reason: string } {
  if (draftYear == null || !Number.isFinite(draftYear)) {
    return { proYears: null, source: 'unknown', reason: 'missing_draft_year' }
  }
  const y = Math.floor(draftYear)
  if (y < 1900 || y > 2100) {
    return { proYears: null, source: 'unknown', reason: 'invalid_draft_year' }
  }
  if (y > currentSeason) {
    return { proYears: 0, source: 'derived_from_draft_year', reason: 'draft_year_future_treated_as_rookie_clock_start' }
  }
  const proYears = Math.max(0, currentSeason - y)
  return { proYears, source: 'derived_from_draft_year', reason: 'currentSeason_minus_draftYear' }
}

export function calculateProYearsFromDebutYear(
  debutYear: number | null | undefined,
  currentSeason: number,
): { proYears: number | null; source: PlayerExperienceSource; reason: string } {
  return calculateProYearsFromDraftYear(debutYear, currentSeason)
}

export type ResolvePlayerExperienceInput = {
  sport: LeagueSport | string
  /** Normalized draft/waiver row */
  entry?: NormalizedDraftEntry
  /** Extra JSON blobs (e.g. sports_players.stats merged at call site) */
  statsJson?: Record<string, unknown>
  projectionsJson?: Record<string, unknown>
  dataSource?: string | null
  /** Calendar year used for draft/debut derivation (defaults to UTC year). */
  currentSeasonYear?: number
  /** True when player is from devy/college pool context */
  isDevyContext?: boolean
}

function looseEntryBag(entry?: NormalizedDraftEntry): Record<string, unknown> {
  if (!entry) return {}
  const top = entry as Record<string, unknown>
  const dm = entry.display?.metadata as Record<string, unknown> | undefined
  return { ...top, ...(dm ?? {}) }
}

export function resolvePlayerExperience(input: ResolvePlayerExperienceInput): PlayerExperienceResult {
  const sport = normalizeToSupportedSport(input.sport) as LeagueSport
  const season = input.currentSeasonYear ?? new Date().getUTCFullYear()

  const collegeSports: LeagueSport[] = ['NCAAF', 'NCAAB']
  if (collegeSports.includes(sport)) {
    const meta = input.entry?.display?.metadata
    const classRaw =
      input.entry?.classYearLabel ??
      meta?.classYearLabel ??
      (typeof looseEntryBag(input.entry).class === 'string' ? String(looseEntryBag(input.entry).class) : null)
    const bucket = getCollegeClassBucket(classRaw)
    const collegeClassLabel = classRaw != null ? String(classRaw) : null

    return {
      status: bucket !== 'unknown' ? 'college' : 'unknown',
      proYears: null,
      draftYear: null,
      debutYear: null,
      rookie: null,
      veteran: null,
      collegeClass: collegeClassLabel,
      collegeClassBucket: bucket,
      devyEligible:
        sport === 'NCAAF' || sport === 'NCAAB'
          ? true
          : Boolean(input.isDevyContext ?? input.entry?.isDevy),
      c2cEligible: sport === 'NCAAF' || sport === 'NCAAB',
      taxiEligibleDefault: false,
      source: bucket !== 'unknown' ? 'college_class' : 'unknown',
      reason:
        bucket !== 'unknown'
          ? 'ncaa_uses_class_not_pro_years'
          : 'missing_college_class',
    }
  }

  const bag: Record<string, unknown> = {
    ...looseEntryBag(input.entry),
    ...(input.statsJson ?? {}),
    ...(input.projectionsJson ?? {}),
  }

  const payloadSignal =
    input.dataSource && (input.statsJson != null || input.projectionsJson != null)
      ? getExperienceSignalsFromSportsPlayer({
          stats: input.statsJson ?? {},
          projections: input.projectionsJson ?? {},
          dataSource: input.dataSource,
        })
      : extractExperienceSignalsFromProviderPayload(bag, 'unknown')

  let proYears: number | null = payloadSignal.proYears
  let rookie: boolean | null = payloadSignal.rookie
  let draftYear: number | null = payloadSignal.draftYear
  let debutYear: number | null = payloadSignal.debutYear
  let source: PlayerExperienceSource = mapSignalSource(payloadSignal.source)
  let reason = payloadSignal.reason

  /** Merge plain bag scan when sports_players row had no keys */
  if (payloadSignal.reason === 'no_matching_fields') {
    const loose = extractExperienceSignalsFromProviderPayload(bag, 'unknown')
    if (loose.reason !== 'no_matching_fields') {
      proYears = loose.proYears
      rookie = loose.rookie
      draftYear = loose.draftYear
      debutYear = loose.debutYear
      source = mapSignalSource(loose.source)
      reason = loose.reason
    }
  }

  /** NFL pool `yearsExp` is Sleeper-backed — surface correct source when bag scan matched it */
  if (
    sport === 'NFL' &&
    input.entry?.yearsExp != null &&
    Number.isFinite(Number(input.entry.yearsExp)) &&
    proYears === Math.max(0, Math.floor(Number(input.entry.yearsExp))) &&
    source === 'unknown'
  ) {
    source = 'sleeper_years_exp'
    reason = 'entry_years_exp'
  }

  /** NFL Sleeper years_exp when still missing */
  if (proYears == null && rookie == null) {
    if (sport === 'NFL' && input.entry?.yearsExp != null && Number.isFinite(Number(input.entry.yearsExp))) {
      const ye = Math.max(0, Math.floor(Number(input.entry.yearsExp)))
      proYears = ye
      rookie = ye === 0 ? true : false
      source = 'sleeper_years_exp'
      reason = 'entry_years_exp'
    }
  }

  /** Draft-year-derived pro seasons */
  if (proYears == null && draftYear != null) {
    const d = calculateProYearsFromDraftYear(draftYear, season)
    if (d.proYears != null) {
      proYears = d.proYears
      rookie = proYears === 0 ? true : proYears >= 1 ? false : null
      source = d.source
      reason = d.reason
    }
  }

  /** Debut-year-derived */
  if (proYears == null && debutYear != null) {
    const d = calculateProYearsFromDebutYear(debutYear, season)
    if (d.proYears != null) {
      proYears = d.proYears
      rookie = proYears === 0 ? true : proYears >= 1 ? false : null
      source = 'derived_from_debut_year'
      reason = d.reason
    }
  }

  /** NFL policy alignment when still ambiguous */
  if (sport === 'NFL' && rookie === null && proYears === null) {
    const nfl = resolveNflRookieSource({
      ...input.entry,
      display: input.entry?.display,
      yearsExp: input.entry?.yearsExp ?? null,
      isRookie: input.entry?.isRookie,
    })
    if (nfl.isRookie === true) {
      rookie = true
      proYears = 0
      source =
        nfl.source === 'rolling_insights_imported'
          ? 'rolling_insights_imported'
          : nfl.source === 'sleeper_years_exp'
            ? 'sleeper_years_exp'
            : nfl.source === 'sleeper_cache'
              ? 'sportsdata_cache'
              : 'unknown'
      reason = nfl.reason
    } else if (nfl.isRookie === false) {
      rookie = false
      if (input.entry?.yearsExp != null && Number.isFinite(Number(input.entry.yearsExp))) {
        proYears = Math.max(0, Math.floor(Number(input.entry.yearsExp)))
      }
      source =
        nfl.source === 'rolling_insights_imported'
          ? 'rolling_insights_imported'
          : nfl.source === 'sleeper_years_exp'
            ? 'sleeper_years_exp'
            : 'unknown'
      reason = nfl.reason
    }
  }

  let status: PlayerExperienceStatus = 'unknown'
  if (proYears != null) {
    status = proYears === 0 ? 'rookie' : 'veteran'
  } else if (rookie === true) {
    status = 'rookie'
  } else if (rookie === false) {
    status = 'veteran'
  }

  const veteran = status === 'veteran' ? true : status === 'rookie' ? false : null

  const taxiEligibleDefault =
    status === 'rookie' || (proYears != null && proYears <= 2 && ['NFL', 'NBA', 'MLB', 'NHL'].includes(sport))

  return {
    status,
    proYears,
    draftYear,
    debutYear,
    rookie,
    veteran,
    collegeClass: null,
    collegeClassBucket: null,
    devyEligible: false,
    c2cEligible: false,
    taxiEligibleDefault,
    source,
    reason:
      status === 'unknown' && source === 'unknown'
        ? 'no_usable_experience_fields_in_imported_payloads'
        : reason,
  }
}

export function isProRookie(r: PlayerExperienceResult): boolean {
  return r.rookie === true || r.status === 'rookie'
}

export function isVeteran(r: PlayerExperienceResult): boolean {
  return r.veteran === true || r.status === 'veteran'
}

export function getProYears(r: PlayerExperienceResult): number | null {
  return r.proYears
}

export function getExperienceBadge(r: PlayerExperienceResult): string {
  if (r.status === 'college' && r.collegeClassBucket && r.collegeClassBucket !== 'unknown') {
    return r.collegeClassBucket
  }
  if (r.status === 'rookie' || r.rookie === true) return 'Rookie'
  if (r.proYears != null && r.proYears === 1) return '2nd Year'
  if (r.proYears != null && r.proYears === 2) return '3rd Year'
  if (r.status === 'veteran' || r.veteran === true) return 'Veteran'
  return '—'
}

export function getTaxiEligibilityDefault(r: PlayerExperienceResult): boolean {
  return r.taxiEligibleDefault
}
