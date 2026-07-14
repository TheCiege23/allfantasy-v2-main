import type { IExternalLeagueMapper } from '../../mappers/ExternalLeagueMapper'
import type { NormalizedLeagueSettings } from '../../types'
import type { SleeperImportPayload } from './types'

/**
 * Tier 0 helpers — Sleeper stores most settings as numbers (0/1 flags, week ints,
 * day counts). These helpers normalize into the shape the canonical normalizer and
 * persistence layer expect. `undefined` means "source did not provide" so downstream
 * code can distinguish it from an explicit zero.
 */
function toIntOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function toBoolFromNumeric(v: unknown): boolean | undefined {
  if (v === true) return true
  if (v === false) return false
  if (v === 1) return true
  if (v === 0) return false
  if (typeof v === 'string') {
    if (v === '1' || v.toLowerCase() === 'true') return true
    if (v === '0' || v.toLowerCase() === 'false') return false
  }
  return undefined
}

/**
 * Sleeper `settings.waiver_type` int → AF vocabulary.
 *   2 → 'faab', 1 → 'rolling', 0 → 'off'.
 * Unknown / missing returns `undefined` so downstream keeps whatever default it holds.
 */
function mapSleeperWaiverType(v: unknown): string | undefined {
  const n = toIntOrUndef(v)
  if (n === 2) return 'faab'
  if (n === 1) return 'rolling'
  if (n === 0) return 'off'
  return undefined
}

export const SleeperLeagueMapper: IExternalLeagueMapper<SleeperImportPayload> = {
  map(source) {
    const league = source.league
    if (!league) return null
    const seasonNum = league.season ? parseInt(league.season, 10) : null
    const rosterCount = league.total_rosters ?? league.settings?.num_teams ?? 0
    const settings = (league.settings ?? {}) as Record<string, unknown>
    const type = settings.type
    const isDynasty = type === 2
    const rosterPositions = league.roster_positions ?? []
    const rosterSize = rosterPositions.length || null
    const ppr = league.scoring_settings?.rec ?? 0
    const superflex = rosterPositions.filter((p: string) => p === 'SUPER_FLEX').length > 0
    const tep = league.scoring_settings?.bonus_rec_te ?? 0
    const scoring = [ppr > 0 && 'PPR', superflex && 'Superflex', tep > 0 && 'TEP'].filter(Boolean).join(' ') || 'Standard'

    // Tier 0 — every field below was audit-verified as previously dropped by this
    // mapper. Each now flows through the normalizer + persistence via the type
    // extension in `lib/league-import/types.ts`.
    const waiverType = mapSleeperWaiverType(settings.waiver_type)
    const waiverBudget = toIntOrUndef(settings.waiver_budget)
    const waiverBidMin = toIntOrUndef(settings.waiver_bid_min)
    const playoffStartWeek = toIntOrUndef(settings.playoff_week_start)
    const playoffTeams = toIntOrUndef(settings.playoff_teams)
    const tradeDeadlineWeek = toIntOrUndef(settings.trade_deadline)
    const tradeReviewDays = toIntOrUndef(settings.trade_review_days)
    const pickTrading = toBoolFromNumeric(settings.pick_trading)
    const reserveSlots = toIntOrUndef(settings.reserve_slots)
    const taxiSlots = toIntOrUndef(settings.taxi_slots)
    const taxiYears = toIntOrUndef(settings.taxi_years)
    const taxiAllowVets = toBoolFromNumeric(settings.taxi_allow_vets)
    const taxiDeadlineWeek = toIntOrUndef(settings.taxi_deadline)
    const maxKeepers = toIntOrUndef(settings.max_keepers)
    const reserveAllowCov = toBoolFromNumeric(settings.reserve_allow_cov)
    const reserveAllowSus = toBoolFromNumeric(settings.reserve_allow_sus)
    const reserveAllowOut = toBoolFromNumeric(settings.reserve_allow_out)
    const reserveAllowNa = toBoolFromNumeric(settings.reserve_allow_na)
    const reserveAllowDnr = toBoolFromNumeric(settings.reserve_allow_dnr)
    const reserveAllowDoubtful = toBoolFromNumeric(settings.reserve_allow_doubtful)

    // Sleeper regular season = weeks before playoff_week_start. Previously hardcoded
    // to 14 which broke every league whose playoffs didn't start on week 15.
    const regularSeasonLength =
      playoffStartWeek != null && playoffStartWeek > 0 ? playoffStartWeek - 1 : undefined

    return {
      name: league.name || 'Imported League',
      sport: league.sport === 'nfl' ? 'NFL' : (league.sport?.toUpperCase?.() || 'NFL'),
      season: Number.isNaN(seasonNum) ? null : seasonNum,
      leagueSize: rosterCount,
      rosterSize,
      scoring: scoring || null,
      isDynasty,
      // Sleeper's real league.status ('pre_draft' | 'drafting' | 'in_season' | 'complete').
      // Never omit this: `League.status` has no DB default, so a missing value here
      // leaves the row `status: null`, which `leagueListFilter.ts` reads as an
      // incomplete/legacy-only import and hides from the commissioner's own Dashboard.
      // Explicit `null` (not `undefined`) when genuinely absent — an honest "no status
      // reported" signal, never a fabricated default.
      status: league.status ?? null,
      playoff_team_count: playoffTeams ?? undefined,
      regular_season_length: regularSeasonLength,
      schedule_unit: 'week',
      matchup_frequency: 'weekly',
      roster_positions: rosterPositions,
      scoring_settings: league.scoring_settings,
      avatar: league.avatar,
      // Tier 0 fields
      waiver_type: waiverType,
      faab_budget: waiverBudget ?? null,
      waiver_bid_min: waiverBidMin,
      playoff_start_week: playoffStartWeek,
      playoff_teams: playoffTeams,
      trade_deadline_week: tradeDeadlineWeek,
      trade_review_days: tradeReviewDays,
      pick_trading: pickTrading,
      reserve_slots: reserveSlots,
      taxi_slots: taxiSlots,
      taxi_years: taxiYears,
      taxi_allow_vets: taxiAllowVets,
      taxi_deadline_week: taxiDeadlineWeek,
      max_keepers: maxKeepers,
      reserve_allow_cov: reserveAllowCov,
      reserve_allow_sus: reserveAllowSus,
      reserve_allow_out: reserveAllowOut,
      reserve_allow_na: reserveAllowNa,
      reserve_allow_dnr: reserveAllowDnr,
      reserve_allow_doubtful: reserveAllowDoubtful,
    }
  },
}
