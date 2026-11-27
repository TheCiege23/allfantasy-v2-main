/**
 * What a surface says when a league's rosters are unreadable because its player ids are the
 * provider's own (Fleaflicker / MFL / Fantrax / Yahoo) — see `isForeignIdSpace` in rosterIdSpace.ts.
 *
 * One sentence, shared, so a blank never borrows a different blank's words: "no starting lineup on
 * file", "not rostered", "you don't roster any defensive players" are each a claim about the league,
 * and none of them is true of a league we simply cannot read.
 *
 * Client-safe on purpose (no imports): rosterIdSpace.ts reads prisma, so a component cannot import
 * the rule — but it can import the words.
 */
export const FOREIGN_IDS_UNREADABLE = "This league's player ids can't be matched to ours yet"

/** The same, as a clause after a league's name: "Dynasty League — …". */
export const FOREIGN_IDS_UNREADABLE_CLAUSE = "its player ids can't be matched to ours yet"

/*
 * A PASTED YAHOO LEAGUE (declaredAvailability.ts). Most of its players carry a Sleeper id; the rest are
 * pasted players nobody could match. Two sentences, shared, so every screen that lists free agents says
 * the same thing:
 *
 *   - below the coverage bar, the list is withheld: an unmatched player is somebody's rostered player,
 *     and he would read as available;
 *   - above it, the list stands and says how many rostered players it could not see.
 *
 * Plain numbers in plain English; the Spanish lives in coreUiCopy.ts as patterns over these exact
 * templates.
 */
const players = (n: number) => `${n} player${n === 1 ? '' : 's'}`

/** Below the bar: who is available cannot be verified. */
export function availabilityUnverifiedSentence(unmatched: number): string {
  return `We can't verify who's available in this league: ${players(unmatched)} on its rosters couldn't be matched to ours.`
}

/** Above the bar: the list stands, with what it could not see. */
export function unmatchedRosteredNote(unmatched: number): string {
  return `${players(unmatched)} on rosters in this league couldn't be matched to ours.`
}

/** For a reader that needs the whole league (a trade read, a market count): it is not read. */
export function leagueUnverifiedClause(unmatched: number): string {
  return `${players(unmatched)} on its rosters couldn't be matched to ours`
}
