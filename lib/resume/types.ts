/**
 * Phase 6B — Fantasy Resume Domain Model (foundation)
 *
 * Sport-agnostic, provider-agnostic identity layer that sits on top of the
 * existing `lib/ranking` primitives (`AFUserRating`, `RankingSnapshot`,
 * `LeagueDifficultyRating`, historical-analysis dimensions).
 *
 * Hard rules for this phase:
 *   - Types only. No DB migrations, no I/O, no UI.
 *   - All fields nullable or carry an explicit `verified` flag so unknown
 *     data degrades to "unverified" rather than fabricated zeros.
 *   - Sport union mirrors `RankingSport` exactly.
 *   - Visibility is defined as a contract here so every renderer/consumer
 *     downstream filters through the same gate.
 */

import type {
  AFUserRating,
  RankingSource,
  RankingSport,
} from "@/lib/ranking/types"

/* -------------------------------------------------------------------------- */
/* 1. Visibility                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Coarse visibility scope. Order matters: `public` > `friends` > `leagues` >
 * `private`. A viewer with privilege `>= required` may see the field.
 */
type ResumeVisibility = "public" | "friends" | "leagues" | "private"

/** Per-section visibility map. Missing keys default to `private`. */
interface ResumeVisibilityMap {
  overall?: ResumeVisibility
  trophies?: ResumeVisibility
  importedHistory?: ResumeVisibility
  commissionerRecord?: ResumeVisibility
  dynastyRecord?: ResumeVisibility
  survivorRecord?: ResumeVisibility
  matchmakingProfile?: ResumeVisibility
  archetype?: ResumeVisibility
}

/** Anonymous mode toggle. When true, identity fields strip to handle only. */
interface ResumeAnonymityMode {
  enabled: boolean
  /** Hide username too (synthesizes a stable opaque alias). */
  hideUsername?: boolean
}

/* -------------------------------------------------------------------------- */
/* 2. Verification + credibility                                              */
/* -------------------------------------------------------------------------- */

/** How a piece of resume data was confirmed. */
type VerificationStatus =
  | "verified_platform" // earned natively on AllFantasy
  | "verified_import" // import passed checks (provider, championship row, etc.)
  | "unverified" // user-claimed or low-signal import
  | "disputed" // duplicate / mismatch flagged
  | "synthetic" // derived/estimated (e.g. percentile bands)

/** Per-source trust weight. 0..1. */
export type ProviderTrust = Readonly<Record<RankingSource, number>>

/** Why a row was flagged. Stable enum for downstream UI/QA filters. */
type SuspiciousFlag =
  | "duplicate_championship"
  | "duplicate_league_import"
  | "season_overlap_conflict"
  | "team_count_mismatch"
  | "impossible_record"
  | "unverified_high_value"

interface CredibilitySignal {
  /** 0..1. 1 = fully trusted, 0 = unusable. */
  confidence: number
  /** Underlying provider weight contributions. */
  providerWeights: Partial<Record<RankingSource, number>>
  flags: SuspiciousFlag[]
}

/* -------------------------------------------------------------------------- */
/* 3. Core resume records                                                     */
/* -------------------------------------------------------------------------- */

interface TrophyRecord {
  /** Stable id e.g. `champ:${leagueId}:${season}`. */
  id: string
  kind: "championship" | "playoff_appearance" | "survivor_win" | "tournament_win"
  sport: RankingSport
  season: number
  leagueId: string | null
  leagueName: string | null
  format: string | null // dynasty/keeper/redraft/bestball/survivor/...
  status: VerificationStatus
  source: RankingSource | null
}

interface CommissionerRecord {
  leaguesAsCommish: number
  /** Total seasons-as-commish across all leagues. */
  seasonsAsCommish: number
  /** Heuristic 0..1 — retention, dispute frequency, activity. */
  reputationScore: number | null
  status: VerificationStatus
}

interface DynastyRecord {
  leagues: number
  championships: number
  /** Average finish across dynasty seasons, 1 = first. null when unknown. */
  avgFinish: number | null
  status: VerificationStatus
}

interface SurvivorRecord {
  attempts: number
  wins: number
  longestSurvivalWeeks: number
  status: VerificationStatus
}

interface SportResumeSlice {
  sport: RankingSport
  wins: number
  losses: number
  ties: number
  championships: number
  playoffAppearances: number
  seasons: number
  longestWinStreak: number
  longestLossStreak: number
  /** Average per-league difficulty (effective scale 0..10000). */
  avgLeagueDifficulty: number | null
  status: VerificationStatus
}

/* -------------------------------------------------------------------------- */
/* 4. Aggregate AF Resume                                                     */
/* -------------------------------------------------------------------------- */

interface ResumeArchetype {
  /** AI-derived later. Today we expose a slot but never auto-populate. */
  label: string | null
  confidence: number | null
}

export interface FantasyResume {
  userId: string
  capturedAt: string // ISO

  /** Pulled from the latest `RankingSnapshot.rating`. Never mutated here. */
  rating: AFUserRating | null

  trophies: TrophyRecord[]
  sports: SportResumeSlice[]

  commissioner: CommissionerRecord | null
  dynasty: DynastyRecord | null
  survivor: SurvivorRecord | null

  /** Overall credibility for the resume as a whole. */
  credibility: CredibilitySignal

  archetype: ResumeArchetype

  visibility: ResumeVisibilityMap
  anonymity: ResumeAnonymityMode
}

/* -------------------------------------------------------------------------- */
/* 5. Snapshot cards (consumer contracts)                                     */
/* -------------------------------------------------------------------------- */

export interface ResumePublicCard {
  userId: string
  username: string | null
  overallRating: number | null
  percentile: number | null
  topSport: RankingSport | null
  championships: number
  seasons: number
  archetypeLabel: string | null
  verified: boolean
}

export interface ResumeLeagueApplicationCard extends ResumePublicCard {
  reliabilityScore: number | null
  activityScore: number | null
  commissionerRating: number | null
  consistencyScore: number | null
  /** Compatibility 0..1 with the requested league's profile. */
  compatibility: number | null
}

export interface ResumeMatchmakingProfile {
  userId: string
  preferredSports: RankingSport[]
  preferredFormats: string[]
  preferredDifficultyBand: [number, number]
  activityScore: number
  reliabilityScore: number
  socialAffinity: number
  competitivenessIndex: number
}
