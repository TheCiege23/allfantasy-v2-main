/**
 * Decision OS — Phase 2 Canonical World Assembly: the PURE assembler.
 *
 * `assembleCanonicalWorld` turns already-loaded canonical rows (League / LeagueTeam / Roster /
 * TeamPerformance) into an origin-blind {@link CanonicalWorld}. It performs NO IO and NO writes — it
 * is a deterministic transform, which is what makes the read-only guarantee structural rather than
 * conventional (there is simply no prisma/write surface imported here).
 *
 * Roster↔Team identity is resolved here by a pure, write-free join (see {@link matchTeamIdForRoster}),
 * deliberately replacing the write-prone `resolveRedraftRosterLookup` (which performs owner repair via
 * `prisma.redraftRoster.update`). The substrate must never reach that path. See the module's follow-up
 * note in `index.ts`.
 */
import {
  deriveCurrentWeek,
  deriveFaab,
  derivePointsAgainst,
  projectRosterSlots,
  readWaiverBudgetUsed,
} from './derive'
import type {
  CanonicalWorld,
  CanonicalWorldRawInput,
  LeagueFacts,
  RawRosterRow,
  RawTeamRow,
  RosterFacts,
  TeamFacts,
  WorldCompleteness,
  WorldProvenance,
} from './facts'

export interface AssembleOptions {
  /** Clock injection for deterministic tests; defaults to `new Date()`. */
  now?: Date
  /** Freshness threshold; a league synced longer ago than this is flagged stale. Default 24h. */
  staleAfterMs?: number
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Scoring-PURPOSE top-level key names allow-listed out of the opaque `League.settings` blob. Listing
 * scoring purposes (never provider strings) is what keeps the substrate origin-blind: imported leagues
 * persist a full settings snapshot whose CHROME (`name` / `avatar` / `visualTheme` / `mediaSettings` /
 * `leagueSize`) and PROVENANCE (`source_tracking` / `identity_mappings` / `importCanonical` /
 * `conceptRules`) carry provider-branded strings — e.g. a `sleepercdn.com` logo URL. Those keys are
 * simply never selected, so a provider URL/tag in chrome cannot ride through into a fact. See Finding
 * F0-1 in `ADR_F0_NONPROD_IMPORTED_LEAGUE.md` §10.
 */
const SCORING_SETTINGS_KEY_NAMES = [
  'scoring',
  'scoringSettings',
  'scoring_settings',
  'scoringMode',
  'scoring_mode',
  'categoryPresetId',
  'categoryScoring',
] as const

/**
 * Provenance KEY NAMES stripped from any selected scoring object so an opaque provider tag (e.g. a
 * `source: '<provider>'` field nested inside a scoring slice) can never leak. These are purpose names,
 * not provider values — nothing here hardcodes a provider, preserving P1 purpose-blindness.
 */
const PROVENANCE_KEY_NAMES = new Set([
  'source',
  'provider',
  'importSource',
  'source_provider',
  'sourceProvider',
])

function stripProvenanceKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProvenanceKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PROVENANCE_KEY_NAMES.has(k)) continue
      out[k] = stripProvenanceKeys(v)
    }
    return out
  }
  return value
}

/**
 * Narrow the opaque `League.settings` blob down to ONLY origin-blind scoring config. Purpose-blind by
 * construction: allow-list scoring KEY NAMES ({@link SCORING_SETTINGS_KEY_NAMES}) and strip provenance
 * KEY NAMES ({@link PROVENANCE_KEY_NAMES}) — no provider string is hardcoded, and league chrome /
 * provenance never reaches the fact. Returns null when no scoring config is present (honest degradation).
 */
export function narrowScoringSettings(settings: unknown): unknown {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const blob = settings as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of SCORING_SETTINGS_KEY_NAMES) {
    if (key in blob && blob[key] !== undefined) {
      out[key] = stripProvenanceKeys(blob[key])
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

function readSourceTeamId(roster: RawRosterRow): string | null {
  const blob = (roster.playerData ?? {}) as Record<string, unknown>
  const direct = blob.source_team_id
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const importMeta = (blob.import ?? {}) as Record<string, unknown>
  const nested = importMeta.sourceTeamId
  if (typeof nested === 'string' && nested.trim()) return nested.trim()
  return null
}

function readSourceManagerId(roster: RawRosterRow): string | null {
  const blob = (roster.playerData ?? {}) as Record<string, unknown>
  const direct = blob.source_manager_id
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const importMeta = (blob.import ?? {}) as Record<string, unknown>
  const nested = importMeta.sourceManagerId
  if (typeof nested === 'string' && nested.trim()) return nested.trim()
  return null
}

/**
 * Pure, write-free resolution of which canonical team a roster belongs to. Tries, in order:
 *  1. `playerData.source_team_id` → `LeagueTeam.externalId` (provider import join — primary)
 *  2. `roster.platformUserId` → `LeagueTeam.platformUserId` (native / claimed manager)
 *  3. `roster.platformUserId` → `LeagueTeam.claimedByUserId` (AF-claimed orphan)
 * Returns null when no team matches (surfaced as a completeness warning, never repaired here).
 */
export function matchTeamIdForRoster(roster: RawRosterRow, teams: RawTeamRow[]): string | null {
  const sourceTeamId = readSourceTeamId(roster)
  if (sourceTeamId) {
    const byExternal = teams.find((t) => t.externalId === sourceTeamId)
    if (byExternal) return byExternal.id
  }
  if (roster.platformUserId) {
    const byPlatformUser = teams.find((t) => t.platformUserId === roster.platformUserId)
    if (byPlatformUser) return byPlatformUser.id
    const byClaim = teams.find((t) => t.claimedByUserId === roster.platformUserId)
    if (byClaim) return byClaim.id
  }
  return null
}

function assembleLeagueFacts(input: CanonicalWorldRawInput): LeagueFacts {
  const { league, performances } = input
  const starterSlots = Array.isArray(league.starters)
    ? (league.starters as unknown[]).filter((s): s is string => typeof s === 'string')
    : null

  const week = deriveCurrentWeek(performances, league.season)

  return {
    leagueId: league.id,
    sport: league.sport,
    season: league.season,
    leagueType: league.leagueType,
    isDynasty: league.isDynasty,
    scoringPresetId: league.scoringPresetId,
    // Origin-blind: narrow the opaque settings blob to scoring config only (drops chrome/provenance
    // that would otherwise leak a provider-branded string, e.g. a logo URL). See Finding F0-1.
    scoringSettings: narrowScoringSettings(league.settings),
    rosterSettings: {
      rosterSize: league.rosterSize,
      starterSlots,
      irSlots: league.irSlots,
      taxiSlots: league.taxiSlots,
    },
    waiverSettings: {
      type: league.waiverType,
      budget: league.waiverBudget,
      minBid: league.waiverMinBid,
      hours: league.waiverHours,
    },
    tradeSettings: {
      reviewHours: league.tradeReviewHours,
      deadlineWeek: league.tradeDeadlineWeek,
      pickTrading: league.draftPickTrading,
    },
    currentWeek: week.currentWeek,
    currentWeekBasis: week.basis,
  }
}

function assembleTeamFacts(input: CanonicalWorldRawInput): TeamFacts[] {
  const { league, teams, rosters, performances } = input
  return teams.map((team) => {
    const roster = rosters.find((r) => matchTeamIdForRoster(r, teams) === team.id)
    const storedRemaining = roster?.faabRemaining ?? null
    const used = roster ? readWaiverBudgetUsed(roster) : null
    const faab = deriveFaab({
      storedRemaining,
      budget: league.waiverBudget,
      used,
    })

    const pa = derivePointsAgainst({
      teamId: team.id,
      storedPointsAgainst: team.pointsAgainst,
      performances,
    })

    return {
      teamId: team.id,
      displayName: team.teamName || team.ownerName || team.externalId,
      ownerName: team.ownerName,
      managerUserId: team.claimedByUserId ?? team.platformUserId,
      isCommissioner: team.isCommissioner,
      isCoCommissioner: team.isCoCommissioner,
      isOrphan: team.isOrphan,
      rank: team.currentRank,
      record: { wins: team.wins, losses: team.losses, ties: team.ties },
      pointsFor: team.pointsFor,
      pointsAgainst: pa.value,
      pointsAgainstBasis: pa.basis,
      faab,
      source: {
        sourceTeamId: readSourceTeamId(roster ?? ({} as RawRosterRow)),
        sourceManagerId: readSourceManagerId(roster ?? ({} as RawRosterRow)),
      },
    }
  })
}

function assembleRosterFacts(input: CanonicalWorldRawInput): RosterFacts[] {
  const { teams, rosters } = input
  return rosters.map((roster) => {
    const projection = projectRosterSlots(roster.playerData)
    return {
      rosterId: roster.id,
      teamId: matchTeamIdForRoster(roster, teams),
      playerIds: projection.playerIds,
      starterIds: projection.starters,
      benchIds: projection.bench,
      reserveIds: projection.reserve,
      taxiIds: projection.taxi,
      playerCount: projection.playerIds.length,
      // Honest carry of the persisted per-team waiver order (priority leagues); null for FAAB / unset.
      waiverPriority: roster.waiverPriority ?? null,
      // Raw provider/native player ids — enrichment (position/injury/bye) is a downstream concern.
      playerMetadataEnriched: false,
    }
  })
}

function assembleProvenance(input: CanonicalWorldRawInput, now: Date, staleAfterMs: number): WorldProvenance {
  const { league, teams, rosters, performances } = input
  const sourceModels = ['League']
  if (teams.length > 0) sourceModels.push('LeagueTeam')
  if (rosters.length > 0) {
    // Honest provenance: report each store actually read. A raw roster without a `sourceModel` tag is
    // treated as canonical `Roster` (the historical single source), preserving existing behavior; redraft
    // rosters additionally surface `RedraftRoster` / `RedraftRosterPlayer`. Never a decision input.
    const rosterSources = new Set(rosters.map((r) => r.sourceModel ?? 'Roster'))
    if (rosterSources.has('Roster')) sourceModels.push('Roster')
    if (rosterSources.has('RedraftRoster')) {
      sourceModels.push('RedraftRoster')
      sourceModels.push('RedraftRosterPlayer')
    }
  }
  if (performances.length > 0) sourceModels.push('TeamPerformance')

  const lastSyncedAt = league.lastSyncedAt ? league.lastSyncedAt.toISOString() : null
  let isStale = false
  let staleReason: string | null = null
  if (!league.lastSyncedAt) {
    isStale = true
    staleReason = 'never_synced'
  } else if (now.getTime() - league.lastSyncedAt.getTime() > staleAfterMs) {
    isStale = true
    staleReason = 'sync_older_than_threshold'
  }

  return {
    sourceModels,
    provider: league.platform,
    sourceLeagueId: league.platformLeagueId,
    assembledAt: now.toISOString(),
    freshness: { lastSyncedAt, isStale, staleReason },
  }
}

function assembleCompleteness(
  input: CanonicalWorldRawInput,
  teamFacts: TeamFacts[],
  rosterFacts: RosterFacts[],
  leagueFacts: LeagueFacts,
): WorldCompleteness {
  const warnings: string[] = []
  const unsupported: string[] = []

  if (input.teams.length === 0) warnings.push('no_teams: league has no LeagueTeam rows')
  if (input.rosters.length === 0) warnings.push('no_rosters: league has no Roster rows')

  if (leagueFacts.currentWeekBasis === 'unavailable') {
    warnings.push('current_week_unavailable: no TeamPerformance rows to derive current week')
  }

  const unmatchedRosters = rosterFacts.filter((r) => r.teamId == null)
  if (unmatchedRosters.length > 0) {
    warnings.push(
      `roster_team_unmatched: ${unmatchedRosters.length} roster(s) could not be joined to a LeagueTeam`,
    )
  }

  const faabMissing = teamFacts.filter((t) => t.faab.remaining == null)
  if (faabMissing.length > 0) {
    warnings.push(
      `faab_remaining_unavailable: ${faabMissing.length} team(s) have no derivable FAAB remaining (no stored remaining and no persisted waiver_budget_used)`,
    )
  }

  const paMissing = teamFacts.filter((t) => t.pointsAgainstBasis === 'unavailable')
  if (paMissing.length > 0) {
    warnings.push(
      `points_against_unavailable: ${paMissing.length} team(s) have no stored or derivable points-against`,
    )
  }

  // Player metadata enrichment is explicitly out of scope for this substrate — mark, never hide.
  if (rosterFacts.length > 0) {
    unsupported.push('player_metadata: roster player ids are raw/unenriched (no position/injury/bye)')
  }

  // Completeness score: start at 100, subtract honest penalties for each degraded dimension.
  let score = 100
  if (input.teams.length === 0) score -= 40
  if (input.rosters.length === 0) score -= 25
  if (leagueFacts.currentWeekBasis === 'unavailable') score -= 10
  if (unmatchedRosters.length > 0) score -= 10
  if (faabMissing.length > 0) score -= 10
  if (paMissing.length > 0) score -= 5
  const dataCompleteness = Math.max(0, Math.min(100, score))

  return { dataCompleteness, warnings, unsupported }
}

/**
 * Assemble an origin-blind {@link CanonicalWorld} from already-loaded canonical rows. Pure: no IO, no
 * writes, no provider branching in the produced facts (origin survives only in `provenance`).
 */
export function assembleCanonicalWorld(
  input: CanonicalWorldRawInput,
  options?: AssembleOptions,
): CanonicalWorld {
  const now = options?.now ?? new Date()
  const staleAfterMs = options?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS

  const league = assembleLeagueFacts(input)
  const teams = assembleTeamFacts(input)
  const rosters = assembleRosterFacts(input)
  const provenance = assembleProvenance(input, now, staleAfterMs)
  const completeness = assembleCompleteness(input, teams, rosters, league)

  return { league, teams, rosters, provenance, completeness }
}
