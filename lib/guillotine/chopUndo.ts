/**
 * Undo a chop (2026-11-15) — the rules. The commissioner can take back the league's most recent chop, and
 * optionally chop a different team instead (the one a stat correction says should have gone).
 *
 * 🛑 A CHOP WAS THE ONE DECISION IN A GUILLOTINE LEAGUE THAT COULD NOT BE TAKEN BACK. A stat correction that
 * would have chopped someone else was detected and logged ("The chop stands") and nothing could be done about
 * it: a manager knocked out by a scoring error, in front of the whole league, with no tool to fix it.
 *
 * WHAT A NATIVE CHOP WRITES, and what undo does to each (./chopUndoService.ts):
 *
 *   GuillotineRosterState.choppedAt / choppedInPeriod   cleared — the engine's "who is alive" source
 *   RedraftRoster.isEliminated                          false — standings and Chimmy read it
 *   LeagueTeam.eliminatedAt                             null  — the team lifecycle axis
 *   GuillotineElimination rows for the week              deleted — the chop history (the undo is logged)
 *   GuillotineSurvivalLog for the week                   back to 'survived'
 *   GuillotineSeason.currentTeamsActive                  incremented back
 *   RedraftRosterPlayer.droppedAt (the released players) cleared, from the GuillotineWaiverRelease list
 *   GuillotineWaiverRelease rows                         deleted — the players are no longer released
 *   pending waiver claims on those players               denied, with the reason
 *   FAAB split to the survivors (when the league splits) taken back from each survivor, returned to its team
 *   Roster.playerData emptied by the release             restored from the snapshot, or rebuilt
 *   GuillotinePeriodScore                                kept — the week was played
 *   chat posts and alerts already sent                   kept — a new post and alerts say it was undone
 *
 * ⚠ REFUSAL FIRST, LIKE THE TRADE REVERSAL (lib/redraft/tradeReversal.ts). Undo is allowed only while the world
 * still looks the way the chop left it; otherwise it refuses and says why, rather than half-reversing:
 *
 *   - only the MOST RECENT chop, and only before the season has moved past its week;
 *   - only before ANY waiver claim has been processed since the chop — that one rule covers both "someone picked
 *     up a released player" and "a survivor spent the FAAB that was split to them";
 *   - never on an imported league (the provider chops it), in the final stage, or after the season ended;
 *   - never when the released-player list is missing, or a chopped team cannot be matched to its roster —
 *     undo restores only what this codebase recorded, and does not guess.
 *
 * Pure (no I/O).
 */

export type ChopUndoBlocker =
  | 'imported_league'
  | 'no_chop'
  | 'not_latest'
  | 'season_over'
  | 'final_stage'
  | 'waivers_ran'
  | 'players_claimed'
  | 'no_release_record'
  | 'unmatched_team'
  | 'faab_unknown'

export const CHOP_UNDO_BLOCKER_MESSAGES: Record<ChopUndoBlocker, string> = {
  imported_league: 'This league is chopped by its provider, so the chop can only be changed there.',
  no_chop: 'No team has been chopped yet.',
  not_latest: 'Only the most recent chop can be undone, and the season has already moved past it.',
  season_over: 'The season is over, so the chop can no longer be undone.',
  final_stage: 'The league has reached its final stage, so the chop can no longer be undone.',
  waivers_ran: 'A waiver run has already processed claims since the chop, so undoing it now would unwind other teams’ moves.',
  players_claimed: 'Someone has already picked up one of the released players.',
  no_release_record: 'The released players were not recorded for this chop, so they cannot be put back safely.',
  unmatched_team: 'A chopped team could not be matched to its roster, so it cannot be restored safely.',
  faab_unknown: 'The chopped teams’ FAAB was split without a record of each team’s share, so it cannot be returned exactly.',
}

export type ChopUndoFacts = {
  importedLeague: boolean
  /** The latest chopped week, or null when no team has been chopped. */
  week: number | null
  /** The highest week the season has recorded (its scoring period and any later chop). */
  latestRecordedWeek: number
  seasonComplete: boolean
  inFinalStage: boolean
  /** Waiver claims processed after the chop. */
  claimsProcessedSinceChop: number
  /** Released players already back on a team. */
  claimedReleasedPlayers: number
  /** Chopped teams with players but no released-player rows. */
  teamsWithoutReleaseRecord: number
  /** Chopped engine rosters with no redraft roster. */
  unmatchedTeams: number
  /** A FAAB split happened for more than one chopped team and did not record each team's share. */
  faabSplitWithoutShares: boolean
}

/** Everything that stops this chop being undone, in the order a commissioner should read them. */
export function chopUndoBlockers(f: ChopUndoFacts): ChopUndoBlocker[] {
  if (f.importedLeague) return ['imported_league']
  if (f.week == null) return ['no_chop']
  const out: ChopUndoBlocker[] = []
  if (f.seasonComplete) out.push('season_over')
  else if (f.inFinalStage) out.push('final_stage')
  if (f.latestRecordedWeek > f.week) out.push('not_latest')
  if (f.claimsProcessedSinceChop > 0) out.push('waivers_ran')
  if (f.claimedReleasedPlayers > 0) out.push('players_claimed')
  if (f.unmatchedTeams > 0) out.push('unmatched_team')
  if (f.teamsWithoutReleaseRecord > 0) out.push('no_release_record')
  if (f.faabSplitWithoutShares) out.push('faab_unknown')
  return out
}

/** "Chop this team instead": the same number of teams, each alive in that week and not one being restored. */
export function validateChopInstead(args: {
  requested: unknown
  undoneRosterIds: readonly string[]
  eligibleRosterIds: readonly string[]
}): { ok: true; rosterIds: string[] } | { ok: false; error: string } {
  if (args.requested == null) return { ok: true, rosterIds: [] }
  const ids = Array.isArray(args.requested)
    ? [...new Set(args.requested.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    : []
  if (ids.length === 0) return { ok: true, rosterIds: [] }
  if (ids.length !== args.undoneRosterIds.length) {
    return { ok: false, error: args.undoneRosterIds.length === 1 ? 'Pick one team to chop instead.' : `Pick ${args.undoneRosterIds.length} teams to chop instead.` }
  }
  if (ids.some((id) => args.undoneRosterIds.includes(id))) return { ok: false, error: 'Pick a different team from the one being brought back.' }
  if (ids.some((id) => !args.eligibleRosterIds.includes(id))) return { ok: false, error: 'You can only chop a team that played that week and is still alive.' }
  return { ok: true, rosterIds: ids }
}

/** Each survivor gives back its share; each chopped team gets back what it gave. Null when that cannot be known. */
export function faabReturnPlan(
  event: { shares?: unknown; taken?: unknown; pool?: unknown } | null,
  choppedRosterIds: readonly string[],
): { fromSurvivors: Map<string, number>; toChopped: Map<string, number> } | null {
  if (!event) return { fromSurvivors: new Map(), toChopped: new Map() }
  const numbers = (v: unknown) =>
    new Map(
      Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}).filter(
        (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0,
      ),
    )
  const fromSurvivors = numbers(event.shares)
  let toChopped = numbers(event.taken)
  if (toChopped.size === 0) {
    // Recorded before each team's share was: exact only when one team was chopped.
    const pool = typeof event.pool === 'number' ? event.pool : [...fromSurvivors.values()].reduce((a, b) => a + b, 0)
    if (choppedRosterIds.length !== 1) return pool > 0 ? null : { fromSurvivors, toChopped }
    toChopped = new Map(pool > 0 ? [[choppedRosterIds[0]!, pool]] : [])
  }
  return { fromSurvivors, toChopped }
}
