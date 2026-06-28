/**
 * Matchup-source boundary (G11 Phase 2c).
 *
 * A concept-pluggable seam for *where a matchup's pairing + rosters come from*.
 * The matchup-center used to read pairing from `TeamWeekResult` and rosters from
 * the generic `Roster` (the `weeklyProcessor` model), which the redraft pipeline
 * never populates. Each league concept resolves its own structural matchup context
 * (who plays whom + each side's starters/record), then the matchup-center applies
 * the SHARED scoring (canonical score adapter), media, and payload assembly. This
 * keeps scoring math single-sourced and lets Keeper/Dynasty/Best Ball/Guillotine/
 * Survivor/etc. each plug in their own source without a redraft-only hack.
 */

/** One side of a matchup, before scoring/media/payload assembly. */
export type MatchupSideContext = {
  /** Roster identity used for keys, the canonical score lookup, and labels. */
  rosterId: string
  teamName: string
  avatarUrl: string | null
  record: { wins: number; losses: number; ties: number }
  /** Starter rows in display order (id + position + optional name/team). */
  starters: Array<{ id: string; position: string; name?: string; team?: string }>
  /** Canonical week status for this side: 'upcoming' | 'live' | 'final'. */
  weekStatus: 'upcoming' | 'live' | 'final'
  /**
   * Engine-authoritative team total when the source already computed one (redraft
   * persists `RedraftMatchup.homeScore/awayScore`). Null → the assembler sums the
   * per-player canonical scores instead (generic path preserves prior behavior).
   */
  engineTotalPoints: number | null
  /**
   * Season/week to use for the canonical per-player score lookup. A concept's
   * scores live under its own season (e.g. redraft scores are keyed to
   * `RedraftSeason.season`, which can differ from `League.season`). When omitted the
   * assembler falls back to the matchup-center's season/week (generic behavior).
   */
  scoreSeason?: number
  scoreWeek?: number
}

/**
 * Result of resolving a matchup for a viewer. `none` carries an explainable reason
 * (no crash, no invented pairing) so the UI can show a clear empty state.
 */
export type MatchupContextResult =
  | { kind: 'matchup'; selected: MatchupSideContext; opponent: MatchupSideContext }
  | { kind: 'bye'; selected: MatchupSideContext }
  | { kind: 'none'; reason: string }

export type MatchupSourceParams = {
  leagueId: string
  viewerUserId: string
  season: number
  week: number
}
