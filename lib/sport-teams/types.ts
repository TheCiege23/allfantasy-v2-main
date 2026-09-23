/**
 * Team metadata and player pool mapping by sport — types.
 */

export type SportType =
  | 'NFL'
  | 'NBA'
  | 'MLB'
  | 'NHL'
  | 'NCAAF'
  | 'NCAAB'
  | 'SOCCER'

/** Team metadata for display and logo resolution. */
export interface TeamMetadata {
  team_id: string
  sport_type: SportType
  team_name: string
  city: string
  abbreviation: string
  conference?: string | null
  division?: string | null
  primary_logo_url: string | null
  alternate_logo_url?: string | null
  primary_color?: string | null
}

/** Player record for pool/roster (sport-scoped). */
export interface PoolPlayerRecord {
  player_id: string
  sport_type: SportType
  league_variant?: string | null
  team_id: string | null
  team_abbreviation: string | null
  team?: string | null
  full_name: string
  position: string
  status: string | null
  injury_status: string | null
  external_source_id: string | null
  /**
   * The Sleeper id, when this row actually has one — NOT the same question as
   * `external_source_id`.
   *
   * 🛑 `external_source_id` IS `sleeperId ?? externalId`, SO A NUMERIC VALUE IN IT
   * CANNOT BE ATTRIBUTED TO AN ID SPACE. Rolling Insights numbers its players in the
   * same range Sleeper does and the two collide: `SportsPlayer` holds
   * `Clay Johnston ext=5850 src=rolling_insights`, and 5850 is Josh Jacobs' SLEEPER id.
   * A consumer that needs the id the NFL scoring path can actually address has to read
   * this field; reading `external_source_id` and hoping gets it a different man's stats.
   */
  sleeper_id?: string | null
  age?: number | null
  experience?: number | null
  secondary_positions?: string[]
  metadata?: Record<string, unknown>
}

/** Universal player model for multi-sport ingestion and display (alias + optional fields). */
export type UniversalPlayerRecord = PoolPlayerRecord
