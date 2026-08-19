/**
 * Fantasy OS Suite — Phase V8.2: provider-neutral evidence contracts.
 *
 * Normalized shapes for the full historical evidence corpus. These carry ONLY deterministic, observed
 * facts (counts, participation, points, FAAB from completed transactions) — never inferred intent,
 * personality, skill, collusion, tanking, or trade-acceptance probability. Roster ids are league-LOCAL
 * slot integers (1..N), not global provider identifiers, and no provider user id/username appears here.
 */
import type { EvidenceCategory } from '../types'

/** The five honest states of a category — a valid empty week is NOT a failure. */
export type CategoryStatus =
  | 'unavailable' // the provider does not expose this
  | 'not-fetched' // this run did not request it
  | 'partial' // some of the expected range was fetched
  | 'empty' // fetched, and there is genuinely nothing
  | 'data' // fetched, with data

/** One league-local roster's membership snapshot. */
export type RosterMembership = {
  rosterId: number
  hasOwner: boolean
  playerCount: number
  starterCount: number
}

/** Win/loss record + points, derived from provider roster settings (not inferred). */
export type StandingRecord = {
  rosterId: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
}

/** One weekly matchup outcome for one roster. */
export type NormalizedMatchup = {
  week: number
  rosterId: number
  points: number
  matchupId: number | null
}

/** One completed transaction, provider-neutral. Participants are league-local roster ids. */
export type NormalizedTransaction = {
  type: 'trade' | 'waiver' | 'free_agent'
  week: number | null
  participatingRosterIds: number[]
  addsCount: number
  dropsCount: number
  /** FAAB spent, ONLY when the provider supplied a waiver budget bid; null otherwise. */
  faabSpent: number | null
}

/** Draft participation evidence (no pick-value inference). */
export type DraftParticipation = {
  draftId: boolean // presence only — never the raw id
  status: 'pre_draft' | 'drafting' | 'complete' | 'unknown'
  rounds: number | null
  pickCount: number
  participatingRosterCount: number
}

/** Postseason placement from a reachable bracket (winners/losers). */
export type PostseasonResult = {
  rosterId: number
  placement: number | null
  bracket: 'winners' | 'losers'
}

/** The full evidence bundle for one league/season. Every category carries its honest status. */
export type LeagueEvidenceBundle = {
  status: Partial<Record<EvidenceCategory, CategoryStatus>>
  rosterMembership: RosterMembership[]
  standings: StandingRecord[]
  matchups: NormalizedMatchup[]
  transactions: NormalizedTransaction[]
  draft: DraftParticipation | null
  postseason: PostseasonResult[]
  /** Checkpoints observed this import — advance the current-season incremental sync. */
  checkpoints: {
    latestMatchupWeek: number | null
    latestTransactionWeek: number | null
    draftComplete: boolean
  }
}

export function emptyEvidenceBundle(): LeagueEvidenceBundle {
  return {
    status: {},
    rosterMembership: [],
    standings: [],
    matchups: [],
    transactions: [],
    draft: null,
    postseason: [],
    checkpoints: { latestMatchupWeek: null, latestTransactionWeek: null, draftComplete: false },
  }
}
