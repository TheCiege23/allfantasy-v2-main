/**
 * Import review — what a commissioner sees between "we read your league" and "it is live in AF".
 *
 * Built on the server from the preview payload (plus two database reads: player matching and the
 * league as AF already holds it), rendered by `components/import/ImportReviewPanel.tsx`.
 * Everything here is plain data so it can cross the network and be unit-tested without I/O.
 */

type ImportReviewSeverity = 'blocking' | 'warning' | 'info'

/** What the commissioner can fix in place for a given warning. */
type ImportReviewFixKind = 'team_name' | 'owner' | 'player_match'

type ImportReviewWarningCode =
  | 'players_unmatched'
  | 'team_no_owner'
  | 'team_name_missing'
  | 'roster_size_mismatch'
  | 'roster_fetch_failed'
  | 'fewer_teams_than_declared'
  | 'no_teams'
  | 'unsupported_roster_slots'
  | 'unsupported_concept'
  | 'specialty_format_partial'
  | 'scoring_preset_assumed'
  | 'scoring_rule_collision'
  | 'player_matching_unchecked'

export interface ImportReviewWarning {
  code: ImportReviewWarningCode
  severity: ImportReviewSeverity
  /** Short, plain-English headline. */
  title: string
  /** What it means and what AF will do about it. */
  detail: string
  fix?: ImportReviewFixKind
  /** The team the warning is about, when it is about one team. */
  teamId?: string
  /** Source player ids the warning is about (unmatched players). */
  playerIds?: string[]
  count?: number
}

export type ImportReviewSlot = 'starter' | 'bench' | 'ir' | 'taxi'

export interface ImportReviewPlayer {
  id: string
  name: string
  position: string
  team: string
  slot: ImportReviewSlot
  /** true = found in AF's player database; false = not found; null = not checked. */
  matched: boolean | null
}

export interface ImportReviewTeam {
  teamId: string
  teamName: string
  ownerName: string
  ownerMissing: boolean
  rosterCount: number
  players: ImportReviewPlayer[]
  rosterFetchFailed: boolean
}

export interface ImportReviewSettingRow {
  label: string
  value: string
}

interface ImportReviewNotImported {
  key: string
  label: string
  state: 'partial' | 'missing'
}

type ImportReviewChangeKind = 'added' | 'removed' | 'changed'

export interface ImportReviewChange {
  kind: ImportReviewChangeKind
  /** 'team' | 'player' | 'setting' */
  scope: 'team' | 'player' | 'setting'
  label: string
  /** For players: the team they moved on/off. For settings: from → to. */
  detail?: string
}

export interface ImportReviewChanges {
  /** When AF last stored this league. ISO string, or null when unknown. */
  lastImportedAt: string | null
  items: ImportReviewChange[]
  /** Number of player moves, for a one-line headline. */
  playersAdded: number
  playersRemoved: number
  settingsChanged: number
  teamsChanged: number
}

export interface ImportReview {
  version: 1
  league: {
    name: string
    platform: string
    sport: string
    season: number | null
    /** redraft | keeper | dynasty | best_ball | … (AF vocabulary) */
    leagueType: string
    leagueTypeLabel: string
    declaredTeamCount: number
    importedTeamCount: number
    rosterSize: number | null
  }
  teams: ImportReviewTeam[]
  scoring: ImportReviewSettingRow[]
  rosterSlots: Array<{ slot: string; count: number }>
  schedule: ImportReviewSettingRow[]
  draft: ImportReviewSettingRow[]
  notImported: ImportReviewNotImported[]
  warnings: ImportReviewWarning[]
  playerMatching: { checked: boolean; total: number; matched: number; unmatched: number }
  /** Present only when AF already holds this league (re-import or sync). */
  changes: ImportReviewChanges | null
}

/**
 * Facts the preview builder already had and used to throw away. Additive on
 * `ImportPreviewResponse.reviewFacts`; every field optional so an older build's payload
 * still produces a review (with fewer rows), never a crash.
 */
export interface ImportReviewFacts {
  rosterSize?: number | null
  regularSeasonLength?: number | null
  playoffStartWeek?: number | null
  playoffTeamCount?: number | null
  isDynasty?: boolean
  isKeeper?: boolean
  maxKeepers?: number | null
  rawLeagueType?: string | null
  scoringFormat?: string | null
  /** `normalized.league.scoring` — the value stored in `League.settings.scoring`, used for diffs. */
  leagueScoring?: string | null
  scoringRuleCount?: number
  waiverType?: string | null
  faabBudget?: number | null
  tradeDeadlineWeek?: number | null
  taxiSlots?: number | null
  reserveSlots?: number | null
  orphanTeamIds?: string[]
  failedRosterTeamIds?: string[]
  tradedPickCount?: number
  standingsCount?: number
}

/** The subset of the preview payload the review is built from. */
export interface ImportReviewPreviewInput {
  league: {
    name: string
    sport: string
    season: number | null
    teamCount: number
    playoffTeams?: number
    settings?: { ppr?: boolean; superflex?: boolean; tep?: boolean }
  }
  managers: Array<{
    rosterId: string
    teamName: string
    displayName: string
    username?: string
    players: string[]
    starters: string[]
    reserve: string[]
    taxi: string[]
  }>
  rosterPositions: string[]
  formatSummary?: { detectedFormat?: string; unsupportedPositions?: string[] }
  playerMap: Record<string, { name: string; position: string; team: string }>
  draftPickCount: number
  transactionCount?: number
  matchupWeeks: number
  dataQuality?: { coverageSummary?: Array<{ key: string; label: string; state: string }> }
  reviewFacts?: ImportReviewFacts
}

export interface ImportReviewCanonicalInput {
  inferredConcept?: string | null
  warnings?: Array<{ code: string; message: string; severity?: string; metadata?: Record<string, unknown> }>
}

/** The league as AF holds it now, for the "what changed" view. */
export interface PreviousImportSnapshot {
  lastImportedAt: string | null
  teams: Array<{ teamId: string; teamName: string; ownerName: string }>
  /** teamId → source player ids */
  rosters: Record<string, string[]>
  /** player id → display name, best effort (from the previous player map). */
  playerNames?: Record<string, string>
  settings: {
    teamCount?: number | null
    rosterPositions?: string[]
    scoringFormat?: string | null
    playoffTeamCount?: number | null
    regularSeasonLength?: number | null
    isDynasty?: boolean | null
  }
}

/** Commissioner edits made on the review screen, sent with the commit. */
export interface ImportReviewOverrides {
  /** source team id → new team name */
  teamNames?: Record<string, string>
  /** source team id → owner display name */
  ownerNames?: Record<string, string>
  /** source player id → the AF player they picked */
  playerMatches?: Record<string, { afPlayerId: string; name: string; position?: string | null; team?: string | null }>
}
