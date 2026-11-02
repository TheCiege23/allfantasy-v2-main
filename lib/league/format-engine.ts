import type { LeagueSport } from '@prisma/client'
import { SUPPORTED_SPORTS, normalizeToSupportedSport, supportsIdpLeagueSport } from '@/lib/sport-scope'
import { ZOMBIE_ELIGIBLE_LEAGUE_SPORTS } from '@/lib/zombie/zombie-sport-eligibility'
import { getLeagueDefaults, getDraftDefaults, getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import { resolveDefaultScheduleConfig } from '@/lib/sport-defaults/DefaultScheduleConfigResolver'
import { getLeagueTypeMedia, normalizeLeagueTypeKey } from '@/lib/league-media/leagueTypeMedia'
import { resolveFormatRosterDefaults, type FormatRosterModifierId } from './roster-defaults'
import { resolveFormatScoringDefaults, type FormatScoringModifierId } from './scoring-defaults'
import { resolveKeeperPolicy } from './keeper-policy'
import { DRAFT_TYPES_BY_LEAGUE_FORMAT } from '@/lib/draft-types/draftTypeRegistry'
import { BEST_BALL_SUPPORTED_SPORTS } from '@/lib/bestball/rules'

export type LeagueFormatId =
  | 'redraft'
  | 'dynasty'
  | 'keeper'
  | 'best_ball'
  | 'guillotine'
  | 'survivor'
  | 'tournament'
  | 'devy'
  | 'c2c'
  | 'zombie'
  | 'salary_cap'
  | 'big_brother'

export type LeagueDraftTypeId =
  | 'snake'
  | 'linear'
  | 'auction'
  | 'slow_draft'
  | 'mock_draft'
  | 'devy_snake'
  | 'devy_linear'
  | 'devy_auction'
  | 'c2c_snake'
  | 'c2c_linear'
  | 'c2c_auction'

export type LeagueFormatModifierId =
  | FormatRosterModifierId
  | FormatScoringModifierId

export type FormatAutomationAiCapabilities = {
  deterministicFeatures: string[]
  aiOptionalFeatures: string[]
  weeklyAutomation: boolean
  introVideoEnabled: boolean
  importReviewEnabled: boolean
}

export type LeagueFormatDefinition = {
  id: LeagueFormatId
  label: string
  description: string
  supportedSports: LeagueSport[]
  defaultRosterMode: 'redraft' | 'dynasty' | 'keeper'
  draftTypes: LeagueDraftTypeId[]
  defaultModifiers: LeagueFormatModifierId[]
  supportedModifiers: LeagueFormatModifierId[]
  capabilities: FormatAutomationAiCapabilities
}

export type LeagueFormatResolution = {
  sport: LeagueSport
  format: LeagueFormatDefinition
  draftType: LeagueDraftTypeId
  modifiers: LeagueFormatModifierId[]
  media: ReturnType<typeof getLeagueTypeMedia>
  roster: ReturnType<typeof resolveFormatRosterDefaults>
  scoring: ReturnType<typeof resolveFormatScoringDefaults>
  leagueDefaults: ReturnType<typeof getLeagueDefaults>
  draftDefaults: ReturnType<typeof getDraftDefaults>
  waiverDefaults: ReturnType<typeof getWaiverDefaults>
  playoffDefaults: ReturnType<typeof resolveDefaultPlayoffConfig>
  scheduleDefaults: ReturnType<typeof resolveDefaultScheduleConfig>
  keeperPolicy: ReturnType<typeof resolveKeeperPolicy>
}

const ALL_SPORTS = [...SUPPORTED_SPORTS]
/** Survivor fantasy format is not offered for Soccer in create flows. */
const SURVIVOR_ELIGIBLE_SPORTS = ALL_SPORTS.filter((s) => s !== 'SOCCER') as LeagueSport[]
const BEST_BALL_SPORTS: LeagueSport[] = [...BEST_BALL_SUPPORTED_SPORTS]

const FORMAT_REGISTRY: Record<LeagueFormatId, LeagueFormatDefinition> = {
  redraft: {
    id: 'redraft',
    label: 'Redraft',
    description: 'Seasonal leagues with a fresh player pool each year.',
    supportedSports: ALL_SPORTS,
    defaultRosterMode: 'redraft',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.redraft] as LeagueDraftTypeId[],
    defaultModifiers: [],
    supportedModifiers: ['superflex', 'idp', 'te_premium'],
    capabilities: {
      deterministicFeatures: ['scoring', 'waivers', 'playoffs', 'trade_review'],
      aiOptionalFeatures: ['draft_helper', 'waiver_advice', 'matchup_preview'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: true,
    },
  },
  dynasty: {
    id: 'dynasty',
    label: 'Dynasty',
    description: 'Carry rosters year to year with deeper benches and future planning.',
    supportedSports: ALL_SPORTS,
    defaultRosterMode: 'dynasty',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.dynasty] as LeagueDraftTypeId[],
    defaultModifiers: ['taxi'],
    supportedModifiers: ['superflex', 'idp', 'te_premium', 'taxi'],
    capabilities: {
      deterministicFeatures: ['scoring', 'rookie_draft', 'trade_review', 'taxi_legality'],
      aiOptionalFeatures: ['orphan_plan', 'dynasty_trade_advice', 'power_rankings'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: true,
    },
  },
  keeper: {
    id: 'keeper',
    label: 'Keeper',
    description: 'Seasonal play with controlled carryover into the next draft.',
    supportedSports: ALL_SPORTS,
    defaultRosterMode: 'keeper',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.keeper] as LeagueDraftTypeId[],
    defaultModifiers: [],
    supportedModifiers: ['superflex', 'te_premium'],
    capabilities: {
      deterministicFeatures: ['keeper_deadlines', 'draft_round_costs', 'scoring'],
      aiOptionalFeatures: ['keeper_advice', 'constitution_draft'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: true,
    },
  },
  best_ball: {
    id: 'best_ball',
    label: 'Best Ball',
    description: 'Automatic weekly lineup optimization with no manual sit/start decisions.',
    supportedSports: BEST_BALL_SPORTS,
    defaultRosterMode: 'redraft',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.best_ball] as LeagueDraftTypeId[],
    defaultModifiers: ['best_ball'],
    supportedModifiers: ['best_ball', 'superflex', 'te_premium'],
    capabilities: {
      deterministicFeatures: ['best_ball_optimization', 'scoring', 'standings'],
      aiOptionalFeatures: ['roster_construction_advice', 'weekly_storyline'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: true,
    },
  },
  guillotine: {
    id: 'guillotine',
    label: 'Guilly',
    description: 'Lowest score each period gets chopped and their roster is released.',
    supportedSports: ALL_SPORTS,
    defaultRosterMode: 'redraft',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.guillotine] as LeagueDraftTypeId[],
    defaultModifiers: [],
    supportedModifiers: [],
    capabilities: {
      deterministicFeatures: ['elimination', 'waiver_reset', 'chop_rules', 'standings'],
      aiOptionalFeatures: ['survival_advice', 'weekly_recap'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: false,
    },
  },
  survivor: {
    id: 'survivor',
    label: 'Survivor',
    description: 'Progressive elimination with specialty rules and weekly survival logic.',
    supportedSports: SURVIVOR_ELIGIBLE_SPORTS,
    defaultRosterMode: 'redraft',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.survivor] as LeagueDraftTypeId[],
    defaultModifiers: [],
    supportedModifiers: [],
    capabilities: {
      deterministicFeatures: ['elimination', 'challenge_scoring', 'state_transitions'],
      aiOptionalFeatures: ['host_narration', 'strategy_help'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: false,
    },
  },
  tournament: {
    id: 'tournament',
    label: 'Tournament',
    description: 'Multi-league elimination event layered on top of core league formats.',
    supportedSports: ALL_SPORTS,
    defaultRosterMode: 'redraft',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.tournament] as LeagueDraftTypeId[],
    defaultModifiers: [],
    supportedModifiers: [],
    capabilities: {
      deterministicFeatures: ['advancement', 'seeding', 'matchup_resolution'],
      aiOptionalFeatures: ['round_preview', 'tournament_storyline'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: false,
    },
  },
  devy: {
    id: 'devy',
    label: 'Devy',
    description: 'Dynasty leagues with a separate college asset pool and future rights.',
    /** NFL/NCAAF and NBA/NCAAB prospect pipelines — not offered for MLB/NHL/Soccer. */
    supportedSports: ['NFL', 'NCAAF', 'NBA', 'NCAAB'],
    defaultRosterMode: 'dynasty',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.devy] as LeagueDraftTypeId[],
    defaultModifiers: ['devy', 'taxi'],
    supportedModifiers: ['devy', 'taxi', 'superflex', 'te_premium'],
    capabilities: {
      deterministicFeatures: ['devy_rights', 'college_pool_management', 'promotion_rules'],
      aiOptionalFeatures: ['devy_rankings', 'stock_watch', 'draft_recap'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: true,
    },
  },
  c2c: {
    id: 'c2c',
    label: 'Campus To Canton',
    description: 'Two-track college and pro ecosystem with campus scoring and future pipelines.',
    /** NFL/NCAAF and NBA/NCAAB — not offered for MLB/NHL/Soccer. */
    supportedSports: ['NFL', 'NCAAF', 'NBA', 'NCAAB'],
    defaultRosterMode: 'dynasty',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.c2c] as LeagueDraftTypeId[],
    defaultModifiers: ['c2c', 'taxi'],
    supportedModifiers: ['c2c', 'taxi', 'superflex', 'te_premium', 'best_ball'],
    capabilities: {
      deterministicFeatures: ['college_scoring', 'promotion_rules', 'dual_rosters'],
      aiOptionalFeatures: ['c2c_strategy', 'matchup_preview', 'storyline'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: true,
    },
  },
  zombie: {
    id: 'zombie',
    label: 'Zombie',
    description: 'Themed elimination and role-shift mechanics layered onto standard league play.',
    /** Zombie creation is available for all seven supported sports. */
    supportedSports: ZOMBIE_ELIGIBLE_LEAGUE_SPORTS,
    defaultRosterMode: 'redraft',
    /** Snake / auction only at create; slow-draft removed as a discrete type (use timer presets). */
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.zombie] as LeagueDraftTypeId[],
    defaultModifiers: [],
    supportedModifiers: ['idp', 'te_premium'],
    capabilities: {
      deterministicFeatures: ['status_transformations', 'weekly_state_updates'],
      aiOptionalFeatures: ['weekly_recap', 'commissioner_summary'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: false,
    },
  },
  salary_cap: {
    id: 'salary_cap',
    label: 'Salary Cap',
    description: 'Contract and cap-sheet management with deterministic legality checks.',
    supportedSports: ALL_SPORTS,
    defaultRosterMode: 'dynasty',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.salary_cap] as LeagueDraftTypeId[],
    defaultModifiers: ['salary_cap'],
    supportedModifiers: ['salary_cap', 'superflex', 'te_premium', 'taxi'],
    capabilities: {
      deterministicFeatures: ['cap_legality', 'contracts', 'dead_money', 'salary_matching'],
      aiOptionalFeatures: ['contract_advice', 'cap_storyline', 'rebuild_plan'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: true,
    },
  },
  big_brother: {
    id: 'big_brother',
    label: 'Big Brother',
    description: 'Social-strategy elimination: HOH nominations, Veto competitions, private eviction voting, and jury finale.',
    supportedSports: ALL_SPORTS,
    defaultRosterMode: 'redraft',
    draftTypes: [...DRAFT_TYPES_BY_LEAGUE_FORMAT.big_brother] as LeagueDraftTypeId[],
    defaultModifiers: [],
    supportedModifiers: ['superflex', 'te_premium'],
    capabilities: {
      deterministicFeatures: ['hoh_assignment', 'nominations', 'veto_draw', 'veto_challenge', 'eviction_vote', 'jury_enrollment', 'finale_vote', 'roster_release'],
      aiOptionalFeatures: ['challenge_themes', 'ceremony_announcements', 'weekly_recap', 'chimmy_host'],
      weeklyAutomation: true,
      introVideoEnabled: true,
      importReviewEnabled: false,
    },
  },
}

function toFormatId(raw?: string | null): LeagueFormatId {
  const normalized = normalizeLeagueTypeKey(raw) as LeagueFormatId
  return FORMAT_REGISTRY[normalized] ? normalized : 'redraft'
}

function inferDraftType(formatId: LeagueFormatId, requested?: string | null): LeagueDraftTypeId {
  const normalized = String(requested ?? '').trim().toLowerCase() as LeagueDraftTypeId
  if (normalized && FORMAT_REGISTRY[formatId].draftTypes.includes(normalized)) {
    return normalized
  }
  if (formatId === 'devy') return 'devy_snake'
  if (formatId === 'c2c') return 'c2c_snake'
  if (formatId === 'salary_cap') return 'auction'
  return FORMAT_REGISTRY[formatId].draftTypes[0]!
}

function inferModifiers(
  format: LeagueFormatDefinition,
  sport: LeagueSport,
  options: {
    requestedModifiers?: string[] | null
    leagueVariant?: string | null
  }
): LeagueFormatModifierId[] {
  const requested = new Set(
    (options.requestedModifiers ?? []).map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
  )
  const variant = String(options.leagueVariant ?? '').trim().toLowerCase()
  if (variant === 'superflex') requested.add('superflex')
  if (variant === 'idp' || variant === 'dynasty_idp') requested.add('idp')
  if (variant === 'te_premium') requested.add('te_premium')
  if (variant === 'devy_dynasty') requested.add('devy')
  if (variant === 'merged_devy_c2c') requested.add('c2c')
  if (format.id === 'best_ball') requested.add('best_ball')
  if (format.id === 'salary_cap') requested.add('salary_cap')
  if (format.id === 'devy' || format.id === 'c2c' || format.id === 'dynasty') requested.add('taxi')

  const merged = [...new Set([...format.defaultModifiers, ...requested])]
  const sportScoped = merged.filter((modifier) =>
    modifier !== 'idp' || supportsIdpLeagueSport(sport)
  )
  return sportScoped.filter((modifier) =>
    format.supportedModifiers.includes(modifier as LeagueFormatModifierId) ||
    format.defaultModifiers.includes(modifier as LeagueFormatModifierId)
  ) as LeagueFormatModifierId[]
}

export function listLeagueFormats(): LeagueFormatDefinition[] {
  return Object.values(FORMAT_REGISTRY)
}

export function getLeagueFormatDefinition(raw?: string | null): LeagueFormatDefinition {
  return FORMAT_REGISTRY[toFormatId(raw)]
}

export function getFormatsForSport(sport: LeagueSport | string): LeagueFormatDefinition[] {
  const normalizedSport = normalizeToSupportedSport(sport)
  return listLeagueFormats().filter((format) => format.supportedSports.includes(normalizedSport))
}

export function getAllowedDraftTypesForFormat(
  sport: LeagueSport | string,
  rawFormat?: string | null
): LeagueDraftTypeId[] {
  const format = getLeagueFormatDefinition(rawFormat)
  const normalizedSport = normalizeToSupportedSport(sport)
  if (!format.supportedSports.includes(normalizedSport)) {
    return FORMAT_REGISTRY.redraft.draftTypes
  }
  return [...format.draftTypes]
}

/**
 * Draft types to show on the **create-league wizard** for a given sport + format.
 *
 * Rules (per product spec):
 * - `devy` / `c2c` — keep all specialty variants (devy_snake/linear/auction, c2c_*)
 * - `guillotine`   — keep full guillotine variants (snake/linear/auction)
 * - `salary_cap`  — auction only (that format's canonical type)
 * - `best_ball`    — show snake / linear / auction on create, then layer
 *   `offline` / `auto` execution modes in the v2 rules engine.
 * - All other formats — snake only at create time; linear and auction are
 *   moved to the Draft Settings tab so the wizard stays simple.
 */
export function getCreateLeagueDraftTypes(
  sport: LeagueSport | string,
  rawFormat?: string | null
): LeagueDraftTypeId[] {
  const all = getAllowedDraftTypesForFormat(sport, rawFormat)
  const fmt = String(rawFormat ?? 'redraft').trim().toLowerCase()
  // Specialty formats keep their full variant list on the create form.
  if (fmt === 'redraft' || fmt === 'keeper' || fmt === 'devy' || fmt === 'c2c' || fmt === 'salary_cap' || fmt === 'guillotine' || fmt === 'best_ball') {
    return all
  }
  // All other formats: only snake at create time.
  const snakeTypes = all.filter((t) => t === 'snake')
  return snakeTypes.length > 0 ? snakeTypes : ['snake' as LeagueDraftTypeId]
}

export function isLeagueFormatAllowedForSport(
  sport: LeagueSport | string,
  rawFormat?: string | null
): boolean {
  const format = getLeagueFormatDefinition(rawFormat)
  const normalizedSport = normalizeToSupportedSport(sport)
  return format.supportedSports.includes(normalizedSport)
}

export function isDraftTypeAllowedForFormat(
  sport: LeagueSport | string,
  rawFormat: string | null | undefined,
  rawDraftType: string | null | undefined
): boolean {
  const allowed = getAllowedDraftTypesForFormat(sport, rawFormat)
  return allowed.includes(String(rawDraftType ?? '').trim().toLowerCase() as LeagueDraftTypeId)
}

export function resolveLeagueFormat(options: {
  sport: LeagueSport | string
  leagueType?: string | null
  draftType?: string | null
  leagueVariant?: string | null
  requestedModifiers?: string[] | null
}): LeagueFormatResolution {
  const sport = normalizeToSupportedSport(options.sport)
  const format = getLeagueFormatDefinition(options.leagueType)
  const scopedModifiers = inferModifiers(format, sport, {
    requestedModifiers: options.requestedModifiers,
    leagueVariant: options.leagueVariant,
  })
  const draftType = inferDraftType(format.id, options.draftType)
  const media = getLeagueTypeMedia(format.id)
  const roster = resolveFormatRosterDefaults({ sport, formatId: format.id, modifiers: scopedModifiers })
  const scoring = resolveFormatScoringDefaults({ sport, formatId: format.id, modifiers: scopedModifiers })
  const leagueDefaults = getLeagueDefaults(sport)
  const draftDefaults = getDraftDefaults(
    sport,
    scopedModifiers.includes('idp')
      ? 'IDP'
      : format.id === 'devy'
        ? 'devy_dynasty'
        : format.id === 'c2c'
          ? 'merged_devy_c2c'
          : format.id === 'dynasty'
            ? 'dynasty'
            : format.id === 'keeper'
              ? 'KEEPER'
              : scopedModifiers.includes('superflex')
                ? 'SUPERFLEX'
                : null
  )
  const waiverDefaults = getWaiverDefaults(sport, format.id)
  const playoffDefaults = resolveDefaultPlayoffConfig(sport, format.id)
  const scheduleDefaults = resolveDefaultScheduleConfig(sport, format.id)
  const keeperPolicy = resolveKeeperPolicy({ sport, leagueType: format.id, draftType })

  return {
    sport,
    format,
    draftType,
    modifiers: scopedModifiers,
    media,
    roster,
    scoring,
    leagueDefaults,
    draftDefaults,
    waiverDefaults,
    playoffDefaults,
    scheduleDefaults,
    keeperPolicy,
  }
}

export function mapImportedLeagueToFormat(input: {
  sport?: string | null
  isDynasty?: boolean | null
  scoring?: string | null
  rosterPositions?: string[] | null
  leagueType?: string | null
}): {
  formatId: LeagueFormatId
  modifiers: LeagueFormatModifierId[]
} {
  const normalizedType = toFormatId(input.leagueType)
  const sport = normalizeToSupportedSport(input.sport)
  if (input.leagueType && normalizedType !== 'redraft') {
    return {
      formatId: normalizedType,
      modifiers: inferModifiers(FORMAT_REGISTRY[normalizedType], sport, { requestedModifiers: [], leagueVariant: null }),
    }
  }

  const modifiers = new Set<LeagueFormatModifierId>()
  const rosterPositions = (input.rosterPositions ?? []).map((slot) => slot.toUpperCase())
  const scoring = String(input.scoring ?? '').toLowerCase()

  if (rosterPositions.includes('SUPER_FLEX') || rosterPositions.includes('SUPERFLEX')) {
    modifiers.add('superflex')
  }
  if (rosterPositions.some((slot) => slot.startsWith('IDP') || ['DL', 'DB', 'LB'].includes(slot))) {
    modifiers.add('idp')
  }
  if (scoring.includes('te premium') || scoring.includes('tep')) {
    modifiers.add('te_premium')
  }

  return {
    formatId: input.isDynasty ? 'dynasty' : 'redraft',
    modifiers: [...modifiers],
  }
}

export function getLeagueFormatDefinitions(): LeagueFormatDefinition[] {
  return Object.values(FORMAT_REGISTRY)
}

export function getFormatIntroMetadata(options: {
  sport: LeagueSport | string
  leagueType?: string | null
  leagueVariant?: string | null
  requestedModifiers?: string[] | null
}): {
  title: string
  subtitle: string
  introVideo: string
  thumbnail: string
  fallbackCopy: string
} {
  const resolution = resolveLeagueFormat({
    sport: options.sport,
    leagueType: options.leagueType,
    leagueVariant: options.leagueVariant,
    requestedModifiers: options.requestedModifiers,
  })
  const modifierLabel = resolution.modifiers.length
    ? ` with ${resolution.modifiers.map((item) => item.replace(/_/g, ' ')).join(', ')}`
    : ''

  return {
    title: `${resolution.sport} ${resolution.format.label}`,
    subtitle: `${resolution.format.description}${modifierLabel}.`,
    introVideo: resolution.media.introVideo,
    thumbnail: resolution.media.thumbnail,
    fallbackCopy: `Welcome to ${resolution.format.label} on AllFantasy. Your ${resolution.sport} format is configured and ready to customize.`,
  }
}
