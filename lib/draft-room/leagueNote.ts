/**
 * Room v2 league notes (2026-11): the one rule a league type drafts under, said next to its chip in
 * the header — a Guillotine league's chop schedule, a Pirate league's protection count, a salary-cap
 * league's cap, a tournament league's conference and round. Facts only; the header words them
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
}

export const NO_LEAGUE_FACTS: DraftRoomLeagueFacts = { note: null, slotSalaryByOverall: null, seedByRosterId: null }
