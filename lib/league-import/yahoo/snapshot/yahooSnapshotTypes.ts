/**
 * Yahoo league SNAPSHOT — a league brought in by the commissioner pasting (or screenshotting) their
 * own Yahoo league pages, while Yahoo's Fantasy API access is unapproved.
 *
 * WHY THIS EXISTS. Every Yahoo API read returns 403 until Yahoo approves the app, read-only included,
 * and nothing on our side changes that. Scraping is off the table (it means logging in as the user),
 * so the commissioner hands us the pages instead. These schemas are the contract between the AI
 * extraction and everything after it: an extraction that does not parse against them is discarded,
 * never "mostly used".
 *
 * ⚠ PASTED TEXT AND IMAGES ARE UNTRUSTED. Nothing here is executed or followed; the model is told
 * so, and its output is validated field by field. Bounds are on every array and string so one paste
 * cannot balloon a snapshot.
 */
import { z } from 'zod'

export const YAHOO_SNAPSHOT_PAGE_KINDS = ['settings', 'standings', 'draft', 'roster'] as const
export type YahooSnapshotPageKind = (typeof YAHOO_SNAPSHOT_PAGE_KINDS)[number]

const name = z.string().trim().min(1).max(120)
const optName = z.string().trim().max(120).nullish()
const count = z.number().int().min(0).max(1000)

/** A scoring row as the settings page shows it. `points` is per ONE unit: "25 yards per point" → 0.04. */
export const yahooSnapshotScoringRowSchema = z.object({
  group: z.enum(['offense', 'kickers', 'defense', 'other']),
  name,
  points: z.number().finite().min(-100).max(100),
})

export const yahooSnapshotSettingsSchema = z.object({
  kind: z.literal('settings'),
  leagueName: name,
  numTeams: z.number().int().min(2).max(32).nullish(),
  season: z.number().int().min(2000).max(2100).nullish(),
  /** "Head-to-Head - Points", "Points Only", … as Yahoo spells it. */
  scoringType: optName,
  draftType: optName,
  usesFaab: z.boolean().nullish(),
  playoffStartWeek: z.number().int().min(1).max(30).nullish(),
  playoffTeams: z.number().int().min(0).max(32).nullish(),
  tradeEndDate: optName,
  rosterPositions: z.array(z.object({ position: z.string().trim().min(1).max(12), count })).max(40),
  scoring: z.array(yahooSnapshotScoringRowSchema).max(150),
})

export const yahooSnapshotStandingsSchema = z.object({
  kind: z.literal('standings'),
  teams: z
    .array(
      z.object({
        rank: z.number().int().min(1).max(32).nullish(),
        teamName: name,
        managerName: optName,
        wins: count.nullish(),
        losses: count.nullish(),
        ties: count.nullish(),
        pointsFor: z.number().finite().min(0).max(100000).nullish(),
        pointsAgainst: z.number().finite().min(0).max(100000).nullish(),
      }),
    )
    .min(2)
    .max(32),
})

const playerRow = {
  playerName: name,
  position: z.string().trim().max(12).nullish(),
  /** NFL team abbreviation as shown ("KC", "Phi"). */
  nflTeam: z.string().trim().max(8).nullish(),
}

export const yahooSnapshotDraftSchema = z.object({
  kind: z.literal('draft'),
  picks: z
    .array(
      z.object({
        round: z.number().int().min(1).max(60),
        /**
         * The pick number WITHIN ITS ROUND, as Yahoo's draft results print it ("1. Saquon Barkley" in
         * Round 2 is round 2, pick 1). Measured on a real league 2026-11-14: Yahoo restarts at 1 every
         * round, so reading this as the overall pick gave every round the same numbers.
         */
        pick: z.number().int().min(1).max(40).nullish(),
        teamName: name,
        ...playerRow,
      }),
    )
    .min(1)
    .max(1000),
})

export const yahooSnapshotRosterSchema = z.object({
  kind: z.literal('roster'),
  teamName: name,
  managerName: optName,
  players: z
    .array(
      z.object({
        /** The roster slot the player sits in: QB, WR, W/R/T, BN, IR, … */
        slot: z.string().trim().min(1).max(12),
        ...playerRow,
      }),
    )
    .min(1)
    .max(60),
})

/** What one paste can be. `unknown` is a real answer, not a failure: "that is not a page we use". */
export const yahooSnapshotExtractionSchema = z.discriminatedUnion('kind', [
  yahooSnapshotSettingsSchema,
  yahooSnapshotStandingsSchema,
  yahooSnapshotDraftSchema,
  yahooSnapshotRosterSchema,
  z.object({ kind: z.literal('unknown'), reason: z.string().max(300).nullish() }),
])

export type YahooSnapshotSettings = z.infer<typeof yahooSnapshotSettingsSchema>
export type YahooSnapshotStandings = z.infer<typeof yahooSnapshotStandingsSchema>
export type YahooSnapshotDraft = z.infer<typeof yahooSnapshotDraftSchema>
export type YahooSnapshotRoster = z.infer<typeof yahooSnapshotRosterSchema>
export type YahooSnapshotExtraction = z.infer<typeof yahooSnapshotExtractionSchema>

/** Everything pasted so far for one league, by one user. Stored whole; see yahooSnapshotStore. */
export interface YahooLeagueSnapshot {
  version: 1
  /** Yahoo's numeric league id — the `<id>` in `/f1/<id>`. */
  leagueId: string
  settings: YahooSnapshotSettings | null
  standings: YahooSnapshotStandings | null
  draft: YahooSnapshotDraft | null
  /** Keyed by normalized team name, so re-pasting a team replaces it rather than duplicating. */
  rosters: Record<string, YahooSnapshotRoster>
  updatedAt: string
}

export function emptyYahooSnapshot(leagueId: string): YahooLeagueSnapshot {
  return { version: 1, leagueId, settings: null, standings: null, draft: null, rosters: {}, updatedAt: new Date(0).toISOString() }
}
