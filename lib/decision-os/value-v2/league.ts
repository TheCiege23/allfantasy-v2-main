import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import { leagueFingerprint } from './cohort'
import type { ScoringRule, StartingSlot } from './types'

export interface LeagueRuntimeV2 {
  leagueId: string
  fingerprint: string | null
  teamCount: number | null
  scoring: ScoringRule[] | null
  slots: StartingSlot[] | null
  benchSlots: number | null
  reserveSlots: number | null
  taxiSlots: number | null
  gaps: string[]
}

const DL = ['DL', 'DE', 'DT', 'NT']
const LB = ['LB', 'ILB', 'OLB', 'MLB']
const DB = ['DB', 'CB', 'S', 'FS', 'SS']
const ELIGIBILITY: Record<string, readonly string[]> = {
  QB: ['QB'], RB: ['RB', 'FB'], FB: ['FB'], WR: ['WR'], TE: ['TE'], K: ['K'], PK: ['K'],
  DEF: ['DEF'], DST: ['DEF'], 'D/ST': ['DEF'],
  FLEX: ['RB', 'FB', 'WR', 'TE'], WRRB_WRT: ['RB', 'FB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'FB', 'WR'], REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'FB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'FB', 'WR', 'TE'],
  SF: ['QB', 'RB', 'FB', 'WR', 'TE'], SFLEX: ['QB', 'RB', 'FB', 'WR', 'TE'], QB_FLEX: ['QB', 'RB', 'FB', 'WR', 'TE'],
  DL, LB, DB, IDP_FLEX: [...DL, ...LB, ...DB], IDP: [...DL, ...LB, ...DB],
  // Specific slots retain their restriction. A DT cannot fill a DE-only slot.
  DE: ['DE'], DT: ['DT'], NT: ['NT'], ILB: ['ILB'], OLB: ['OLB'], MLB: ['MLB'],
  CB: ['CB'], S: ['S', 'FS', 'SS'], FS: ['FS'], SS: ['SS'], EDGE: ['EDGE'],
}
const NON_STARTERS = new Set(['BN', 'BENCH', 'IR', 'RESERVE', 'TAXI'])
const NFL_STATS = new Set(`pass_yd pass_td pass_int pass_att pass_cmp pass_inc pass_sack pass_fd pass_2pt
  rush_yd rush_td rush_att rush_fd rush_2pt rec rec_yd rec_td rec_tgt rec_fd rec_2pt fum fum_lost fum_rec_td
  fgm fgmiss xpm xpmiss fgm_yds fgm_yds_over_30
  fgm_0_19 fgm_20_29 fgm_30_39 fgm_40_49 fgm_50_59 fgm_50p fgm_60p
  fgmiss_0_19 fgmiss_20_29 fgmiss_30_39 fgmiss_40_49 fgmiss_50_59 fgmiss_50p fgmiss_60p
  idp_tkl idp_tkl_solo idp_tkl_ast idp_tkl_loss idp_sack idp_sack_yd idp_qb_hit idp_int idp_int_ret_yd
  idp_ff idp_fum_rec idp_fum_ret_yd idp_def_td idp_pass_def idp_blk_kick idp_safety
  sack sack_yd int fum_rec ff safe def_td blk_kick def_st_td def_st_ff def_st_fum_rec
  pts_allow_0 pts_allow_1_6 pts_allow_7_13 pts_allow_14_20 pts_allow_21_27 pts_allow_28_34 pts_allow_35p
  bonus_pass_yd_300 bonus_pass_yd_400 bonus_rush_yd_100 bonus_rush_yd_200 bonus_rec_yd_100 bonus_rec_yd_200
  bonus_pass_td_40p bonus_pass_td_50p bonus_rush_td_40p bonus_rush_td_50p bonus_rec_td_40p bonus_rec_td_50p`.split(/\s+/).filter(Boolean))
const count = (v: unknown): number | null => typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Canonical worlds wrap scoring settings; normalized contexts already supply a numeric map. */
function scoringMap(raw: unknown, gaps: string[]): Record<string, number> | null {
  if (!object(raw) || !Object.keys(raw).length) { gaps.push('league_scoring_missing'); return null }
  const wrappers = ['scoring_settings', 'scoringSettings', 'scoring'].filter(k => object(raw[k]))
  const maps = wrappers.length ? wrappers.map(k => raw[k] as Record<string, unknown>) : [raw]
  if (raw.categoryScoring != null || raw.categoryPresetId != null || ['category', 'hybrid'].includes(String(raw.scoringMode ?? raw.scoring_mode))) {
    gaps.push('league_scoring_model_unsupported'); return null
  }
  const result: Record<string, number> = {}
  for (const map of maps) for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) { gaps.push(`league_scoring_invalid:${key}`); return null }
    if (Object.hasOwn(result, key) && result[key] !== value) { gaps.push(`league_scoring_conflict:${key}`); return null }
    result[key] = value
  }
  if (!Object.keys(result).length) { gaps.push('league_scoring_missing'); return null }
  return result
}

export function resolveLeagueRuntimeV2(input: {
  leagueId: string; sport: string; format: string; teamCount: number | null
  scoringSettings: unknown; starterSlots: unknown; rosterSize: number | null
  irSlots: number | null; taxiSlots: number | null; formatRules: Record<string, unknown> | null
}): LeagueRuntimeV2 {
  const gaps: string[] = []
  const teamCount = count(input.teamCount) || null
  if (teamCount === null) gaps.push('league_team_count_missing')
  const weights = scoringMap(input.scoringSettings, gaps)
  const scoring: ScoringRule[] = []
  for (const [stat, points] of Object.entries(weights ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const bonus = /^bonus_rec_(rb|wr|te)$/.exec(stat)
    if (bonus) scoring.push({ stat: 'rec', points, positions: [bonus[1].toUpperCase()] })
    else if (NFL_STATS.has(stat)) scoring.push({ stat, points })
    else gaps.push(`league_scoring_unmapped:${stat}`)
  }
  if (input.sport.toUpperCase() !== 'NFL') gaps.push('league_sport_adapter_unsupported')
  const slots: StartingSlot[] = []
  if (!Array.isArray(input.starterSlots) || !input.starterSlots.length) gaps.push('league_slots_missing')
  else for (const [index, raw] of input.starterSlots.entries()) {
    const slot = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
    if (NON_STARTERS.has(slot)) continue
    const eligiblePositions = Object.hasOwn(ELIGIBILITY, slot) ? ELIGIBILITY[slot] : undefined
    if (!eligiblePositions) gaps.push(`league_slot_unmapped:${slot || index}`)
    else slots.push({ id: `${slot}:${index}`, count: 1, eligiblePositions: [...eligiblePositions] })
  }
  const topologyKnown = slots.length > 0 && !gaps.some(g => g.startsWith('league_slot')) && input.sport.toUpperCase() === 'NFL'
  const rosterSize = count(input.rosterSize)
  const benchSlots = topologyKnown && rosterSize !== null && rosterSize >= slots.length ? rosterSize - slots.length : null
  if (benchSlots === null) gaps.push('league_roster_capacity_missing_or_inconsistent')
  const reserveSlots = count(input.irSlots), taxiSlots = count(input.taxiSlots)
  if (reserveSlots === null) gaps.push('league_reserve_capacity_missing')
  if (taxiSlots === null) gaps.push('league_taxi_capacity_missing')
  const resolvedScoring = weights && !gaps.some(g => g.startsWith('league_scoring_') || g === 'league_sport_adapter_unsupported') ? scoring : null
  const resolvedSlots = topologyKnown ? slots : null
  let fingerprint: string | null = null
  if (teamCount !== null && weights && resolvedSlots) {
    try { fingerprint = leagueFingerprint({ sport: input.sport, format: input.format, teamCount,
      scoring: resolvedScoring, slots: resolvedSlots, benchSlots, reserveSlots, taxiSlots,
      formatRules: { rules: input.formatRules, exactScoringWeights: weights } }) }
    catch { gaps.push('league_fingerprint_invalid') }
  }
  return { leagueId: input.leagueId, fingerprint, teamCount, scoring: resolvedScoring, slots: resolvedSlots,
    benchSlots, reserveSlots, taxiSlots, gaps }
}

/** Called only after world membership resolution. Uses recorded league capacity, never imported row count. */
export function leagueRuntimeFromWorld(world: CanonicalWorld): LeagueRuntimeV2 {
  const { league } = world
  return resolveLeagueRuntimeV2({ leagueId: league.leagueId, sport: league.sport,
    format: league.leagueType ?? (league.isDynasty ? 'dynasty' : 'redraft'), teamCount: league.teamCount ?? null,
    scoringSettings: league.scoringSettings, starterSlots: league.rosterSettings.starterSlots,
    rosterSize: league.rosterSettings.rosterSize, irSlots: league.rosterSettings.irSlots, taxiSlots: league.rosterSettings.taxiSlots,
    formatRules: { isDynasty: league.isDynasty, waiver: { ...league.waiverSettings }, trade: { ...league.tradeSettings } } })
}

/** Authenticated context owns all league settings; hypothetical console controls do not rewrite it. */
export function leagueRuntimeFromNormalized(context: NormalizedLeagueContext, teamCount: number | null): LeagueRuntimeV2 {
  return resolveLeagueRuntimeV2({ leagueId: context.leagueId, sport: context.sport,
    format: context.leagueType ?? (context.flags.isDynasty ? 'dynasty' : 'redraft'), teamCount,
    scoringSettings: context.scoring.scoringModel === 'points' ? context.scoring.pointsByStat : null,
    starterSlots: context.roster.starters, rosterSize: context.roster.rosterSize,
    irSlots: context.roster.irSlots, taxiSlots: context.roster.taxiSlots,
    formatRules: { flags: context.flags, waiver: context.waiver, trade: context.trade, playoff: context.playoff,
      salaryCap: context.salaryCap, variant: context.leagueVariant,
      taxiAllowNonRookies: context.roster.taxiAllowNonRookies, taxiYearsLimit: context.roster.taxiYearsLimit } })
}
