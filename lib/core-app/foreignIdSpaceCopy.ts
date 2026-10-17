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
