/**
 * A Survivor league's season rulebook, as plain facts the rulebook panel can word in any language
 * (components/core-app/survivor/SurvivorRulebook.tsx). Read from the league's Survivor config, which
 * both the summary and the commissioner dashboard carry. Pure.
 */

export type RulebookConfig = {
  tribeCount?: number | null
  tribeSize?: number | null
  tribeFormation?: string | null
  mergeTrigger?: string | null
  mergeWeek?: number | null
  mergePlayerCount?: number | null
  juryStartAfterMerge?: number | null
  exileReturnEnabled?: boolean | null
  exileReturnTokens?: number | null
  idolCount?: number | null
  tribeShuffleEnabled?: boolean | null
  voteDeadlineDayOfWeek?: number | null
  voteDeadlineTimeUtc?: string | null
  selfVoteDisallowed?: boolean | null
  minigameFrequency?: string | null
  seasonThemeLabel?: string | null
}

export type RulebookRule =
  | { id: 'tribes'; count: number; size: number | null; formation: 'random' | 'commissioner' }
  | { id: 'merge'; byWeek: number | null; byPlayers: number | null }
  | { id: 'jury'; afterMerge: number }
  | { id: 'exile'; on: boolean; tokens: number }
  | { id: 'idols'; count: number }
  | { id: 'swap'; on: boolean }
  | { id: 'vote'; day: number | null; timeUtc: string | null; selfVote: boolean }
  | { id: 'challenges'; frequency: string }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Every rule the config states. A rule whose facts are missing is left out rather than guessed. */
export function rulebook(c: RulebookConfig | null | undefined): RulebookRule[] {
  if (!c) return []
  const rules: RulebookRule[] = []
  const count = num(c.tribeCount)
  if (count && count > 0) rules.push({ id: 'tribes', count, size: num(c.tribeSize), formation: c.tribeFormation === 'commissioner' ? 'commissioner' : 'random' })
  const byWeek = c.mergeTrigger === 'player_count' ? null : num(c.mergeWeek)
  const byPlayers = c.mergeTrigger === 'player_count' ? num(c.mergePlayerCount) : null
  if (byWeek != null || byPlayers != null) rules.push({ id: 'merge', byWeek, byPlayers })
  const jury = num(c.juryStartAfterMerge)
  if (jury != null) rules.push({ id: 'jury', afterMerge: Math.max(0, jury) })
  if (c.exileReturnEnabled != null) rules.push({ id: 'exile', on: Boolean(c.exileReturnEnabled), tokens: num(c.exileReturnTokens) ?? 0 })
  const idols = num(c.idolCount)
  if (idols != null) rules.push({ id: 'idols', count: idols })
  if (c.tribeShuffleEnabled != null) rules.push({ id: 'swap', on: Boolean(c.tribeShuffleEnabled) })
  const day = num(c.voteDeadlineDayOfWeek)
  const time = typeof c.voteDeadlineTimeUtc === 'string' && /^\d{1,2}:\d{2}/.test(c.voteDeadlineTimeUtc) ? c.voteDeadlineTimeUtc.slice(0, 5) : null
  if (day != null || time != null) rules.push({ id: 'vote', day: day != null && day >= 0 && day <= 6 ? day : null, timeUtc: time, selfVote: c.selfVoteDisallowed === false })
  if (c.minigameFrequency && c.minigameFrequency !== 'none') rules.push({ id: 'challenges', frequency: c.minigameFrequency })
  return rules
}

/**
 * The vote deadline in the reader's own time zone: the weekday and time a UTC "day + HH:MM" lands on
 * this week. Null when either half is missing.
 */
export function localDeadline(day: number | null, timeUtc: string | null, locale?: string): string | null {
  if (day == null || !timeUtc) return null
  const [h, m] = timeUtc.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  // A fixed reference week (Sunday 2026-11-01 UTC) so the weekday maths never depends on today.
  const at = new Date(Date.UTC(2026, 10, 1 + day, h, m))
  return at.toLocaleString(locale, { weekday: 'long', hour: 'numeric', minute: '2-digit' })
}
