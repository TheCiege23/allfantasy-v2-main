/**
 * SURVIVOR PROMPT / ANNOUNCEMENT TEMPLATES — pure text builders. No DB, no AI calls.
 *
 * Deterministic copy for the host intro/rules announcement. NEVER leaks hidden idol/power
 * ownership or any private strategic state — it only states that idols/advantages MAY exist.
 * Tone: dramatic Survivor host with a fantasy-football twist. Sourced from the Phase 0 docs
 * (Welcome to the Island rules + social-strategy/confidentiality policy).
 */

export interface SurvivorIntroContext {
  leagueName: string
  sport: string
  castSize: number
  tribeCount: number
  mergeAtActivePlayers: number
  privateVotesOnly: boolean
  coManagerDisallowed: boolean
  screenshotsAllowedExceptHostDm: boolean
}

/** The host intro/rules announcement body (markdown). Hidden game state is never included. */
export function buildSurvivorIntroAnnouncement(ctx: SurvivorIntroContext): string {
  const lines: string[] = []
  lines.push(`🔥 **Welcome to Survivor: ${ctx.leagueName}** 🔥`)
  lines.push('')
  lines.push('**Outwit. Outplay. Outlast.** This is fantasy football as a social-strategy game.')
  lines.push(
    `${ctx.castSize} managers begin split across **${ctx.tribeCount} tribes**. Each scoring period a tribe goes to Elimination Council and votes someone out. The game **merges at ${ctx.mergeAtActivePlayers} remaining players** — then it is every survivor for themselves.`,
  )
  lines.push('')
  lines.push('**How to last:**')
  lines.push('- 🧠 **Information is currency.** Talk in your tribe chat, build trust, and read the room.')
  lines.push('- ⏰ **Deadlines matter.** Miss a vote deadline and you forfeit your voice that round.')
  lines.push(
    `- 🤫 **Votes are private.** ${ctx.privateVotesOnly ? 'Only your final ballot counts, and it stays secret until the reveal.' : 'Voting visibility follows your league settings.'}`,
  )
  lines.push('- 💬 **Tribe chats are your war room.** Other tribes cannot see them.')
  lines.push('- 🗿 **Idols & advantages may be in play.** Some players may quietly hold a hidden idol or advantage — play accordingly.')
  lines.push('')
  lines.push('**House rules:**')
  if (ctx.coManagerDisallowed) lines.push('- 🚫 **No co-managers.** One human, one game. Outside help is not allowed.')
  lines.push(
    `- 📸 **Screenshots:** ${ctx.screenshotsAllowedExceptHostDm ? 'sharing chat screenshots is allowed as a strategy tool — EXCEPT private host/AI DMs, which are confidential.' : 'follow your league screenshot policy.'}`,
  )
  lines.push('- 🤝 **Respect the players.** No harassment, hate, threats, or platform abuse. Play hard, play clean.')
  lines.push('')
  lines.push('_Your host (Chimmy) posts deadlines, results, and twists here. Hidden details stay hidden — that is the game._')
  return lines.join('\n')
}

/** Short system summary used when a full chat post cannot be made (dashboard pending state). */
export function buildSurvivorIntroSummary(ctx: SurvivorIntroContext): string {
  return `Survivor intro & rules for ${ctx.leagueName}: ${ctx.castSize} managers, ${ctx.tribeCount} tribes, merge at ${ctx.mergeAtActivePlayers}. Outwit, Outplay, Outlast — private votes, tribe chats, hidden advantages may exist.`
}
