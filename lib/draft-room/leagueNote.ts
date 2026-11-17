/**
 * Room v2 league notes (2026-11): the one rule a league type drafts under, said next to its chip in
 * the header — a Guillotine league's chop schedule, a Pirate league's protection count, a salary-cap
 * league's cap, a tournament league's conference and round. Best Ball and Big Brother carry no draft-time
 * setting worth a number, so theirs is the format's own fixed rule. Facts only; the header words them
 * (`draftRoomHeaderMessages`), so they read in Spanish too.
 *
 * Client-safe types. The server reads them in `loadDraftRoomLeagueFacts`.
 */
export type LeagueNote =
  | { kind: 'guillotine'; startWeek: number; perChop: number }
  | { kind: 'pirate'; protect: number }
  | { kind: 'salary_cap'; cap: number }
  | { kind: 'tournament'; conference: string | null; round: string | null }
  /** Proper names from the league's Zombie universe, printed as they are. */
  | { kind: 'zombie'; universe: string | null; level: string | null }
  /** Fixed by the format: lineups set themselves. */
  | { kind: 'best_ball' }
  /** Fixed by the format: a Head of Household and an eviction every week. */
  | { kind: 'big_brother' }

/** A snake salary-cap slot: the contract that pick is signed to (`loadRookieContractTerms`). */
export type SlotSalary = { salary: number; years: number }

export type DraftRoomLeagueFacts = {
  note: LeagueNote | null
  /** Overall pick → salary, only for a salary-cap league drafting by snake. */
  slotSalaryByOverall: Record<number, SlotSalary> | null
  /**
   * Roster → its seed from the previous stage, for a stage 2/3 season tournament draft. From the
   * FROZEN field (`loadSeasonDraftContext`), so it cannot drift from the order the draft runs in.
   */
  seedByRosterId?: Record<string, number> | null
  /**
   * Keeper league: how many seasons each player has been a locked keeper, by `keeperPlayerKeys`
   * (player id, and normalized name + position). Only 2+ — a first-year keeper needs no label.
   */
  keeperYearsByPlayer?: Record<string, number> | null
}

export const NO_LEAGUE_FACTS: DraftRoomLeagueFacts = { note: null, slotSalaryByOverall: null, seedByRosterId: null, keeperYearsByPlayer: null }
