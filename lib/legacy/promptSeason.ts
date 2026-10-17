import { currentFantasySeason } from '@/lib/core-app/connectLeague'

/**
 * Seasons for the legacy AI prompts, derived from the clock rather than typed in.
 *
 * 🛑 THESE PROMPTS CARRIED LITERAL YEARS AND WENT STALE (2026-10-11). The AI Coach told the model the 2024
 * draft class had "ALREADY completed their rookie seasons" and listed Omarion Hampton in it — he was drafted
 * in 2025 (`SportsPlayer.yearsExp` 1 in 2026, against 2 for Nabers and Bowers); the league transfer wrote
 * storylines "for an upcoming 2025 fantasy football season"; the legacy report's top label was
 * "Best 2025 Outlook". In October 2026 every one of those was a year out of date.
 */

/** The fantasy season a prompt is about: the current one, or — January and February — the one just ending. */
export function legacyPromptSeason(now: Date = new Date()): number {
  return currentFantasySeason(now)
}

/**
 * The most recent NFL Draft that has HAPPENED. The draft is held in late April, so from May on it is this
 * year's; before that it is last year's. (In late April itself this under-claims by a few days, which only
 * means the model is not told about a class it may already know of — never the reverse.)
 */
export function latestNflDraftYear(now: Date = new Date()): number {
  return now.getUTCMonth() >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

/**
 * One sentence telling the model who is a prospect, with no player list to go stale: anyone already taken in
 * an NFL Draft is an NFL player.
 */
export function nflDraftClassReminder(now: Date = new Date()): string {
  const latest = latestNflDraftYear(now)
  return `The most recent NFL Draft was in ${latest}. Every player selected in the ${latest} NFL Draft or any earlier one is an active NFL player, not a prospect — do NOT refer to them as prospects. Only players not yet drafted are prospects.`
}

/**
 * The "Best <season> Outlook" offseason label. /af-legacy colours it by pattern (`/^Best \d{4} Outlook$/`),
 * so stored reports carrying an older year keep their badge.
 */
export function bestOutlookLabel(now: Date = new Date()): string {
  return `Best ${legacyPromptSeason(now)} Outlook`
}
