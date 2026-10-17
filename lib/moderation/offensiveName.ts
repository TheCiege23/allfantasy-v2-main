import { hasProfanity } from "@/lib/chat-core/censorProfanity"
import { containsProfanity } from "@/lib/profanity"

/**
 * Is this a name other people should not have to read? PURE, client-safe.
 *
 * 🛑 NAMES ARE USER-GENERATED CONTENT TOO (App Store guideline 1.2 — filter objectionable
 * material). Sign-up refused an offensive USERNAME, but Settings' username change skipped the
 * check entirely, and no path ever checked a DISPLAY NAME — which is what other managers see as
 * the sender of every chat message. Anyone could rename to a slur the day after signing up.
 *
 * Two filters, because the two kinds of name differ:
 *  - `lib/profanity` matches SUBSTRINGS. Right for a username, which has no spaces, so a slur can
 *    only be hidden inside it ("xxslurxx"). Wrong for a display name: real surnames contain
 *    fragments of swears, and substring matching is how a filter rejects "Dickerson".
 *  - `lib/chat-core/censorProfanity` matches WHOLE WORDS, slurs included — the filter chat already
 *    uses. A username is also split into its words first ("slur_guy", "SlurGuy", "slur99"), so
 *    the whole-word list reaches it too.
 */

/** "SlurGuy_99" -> "Slur Guy": camelCase, underscores, dashes, dots and digits become word breaks. */
function splitIntoWords(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.\d]+/g, " ")
}

export function isOffensiveUsername(username: string): boolean {
  if (!username) return false
  return containsProfanity(username) || hasProfanity(username) || hasProfanity(splitIntoWords(username))
}

export function isOffensiveDisplayName(displayName: string): boolean {
  if (!displayName) return false
  return hasProfanity(displayName) || hasProfanity(splitIntoWords(displayName))
}

export const OFFENSIVE_USERNAME_MESSAGE = "Please choose a different username."
export const OFFENSIVE_DISPLAY_NAME_MESSAGE = "Please choose a different display name."
