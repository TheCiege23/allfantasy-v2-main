/**
 * The weekly recap's storylines, from facts only (2026-11-15).
 *
 * The native weekly recap (lib/league-chat/nativeWeeklyRecap.ts) listed results, the top of the table and the top score.
 * These are the week's stories a league talks about, each computed from stored results — never invented, never a
 * prediction, never a label on a manager:
 *
 *   - closest game, biggest margin, lowest score            — this week's final games;
 *   - streaks of 3+ after this week                          — the season's final games, newest first;
 *   - upsets                                                 — the winner had at least 2 fewer wins going in (the rule
 *                                                              DramaEventDetector uses), counted from earlier final games,
 *                                                              because the roster's win total already includes this week;
 *   - rivalry games                                          — this week's games between a pair the rivalry engine
 *                                                              recorded, and whether it was rivalry week;
 *   - trades completed this week, pickups that started and scored — passed in by the loader.
 *
 * Pure (no I/O). Ids in, a namer turns them into team names at the end.
 */
export type SeasonGame = { week: number; homeId: string; awayId: string; homeScore: number; awayScore: number }
export type StorylinePickup = { rosterId: string; playerName: string; points: number }
export type StorylineTrade = { aId: string; bId: string }

export type StorylineFacts = {
  closest: { winnerId: string; loserId: string; margin: number } | null
  blowout: { winnerId: string; loserId: string; margin: number } | null
  lowScore: { rosterId: string; score: number } | null
  streaks: Array<{ rosterId: string; length: number; kind: 'win' | 'loss' }>
  upsets: Array<{ winnerId: string; loserId: string; winnerWinsBefore: number; loserWinsBefore: number }>
  rivalries: Array<{ aId: string; bId: string; winnerId: string | null }>
  rivalryWeek: boolean
  trades: StorylineTrade[]
  pickups: StorylinePickup[]
}

const STREAK_MIN = 3
const UPSET_WIN_GAP = 2
const pairKey = (a: string, b: string) => [a, b].sort().join('|')

function winsBefore(games: readonly SeasonGame[], week: number): Map<string, number> {
  const wins = new Map<string, number>()
  for (const g of games) {
    if (g.week >= week || g.homeScore === g.awayScore) continue
    const w = g.homeScore > g.awayScore ? g.homeId : g.awayId
    wins.set(w, (wins.get(w) ?? 0) + 1)
  }
  return wins
}

function streakAfter(games: readonly SeasonGame[], rosterId: string, week: number): number {
  const mine = games.filter((g) => g.week <= week && (g.homeId === rosterId || g.awayId === rosterId)).sort((a, b) => b.week - a.week)
  let streak = 0
  for (const g of mine) {
    const own = g.homeId === rosterId ? g.homeScore : g.awayScore
    const opp = g.homeId === rosterId ? g.awayScore : g.homeScore
    if (own === opp) break
    const won = own > opp
    if (streak === 0) streak = won ? 1 : -1
    else if (won && streak > 0) streak += 1
    else if (!won && streak < 0) streak -= 1
    else break
  }
  return streak
}

export function buildStorylineFacts(input: {
  week: number
  seasonGames: readonly SeasonGame[]
  rivalryPairs: ReadonlySet<string>
  rivalryWeek: boolean
  trades?: StorylineTrade[]
  pickups?: StorylinePickup[]
}): StorylineFacts {
  const week = input.seasonGames.filter((g) => g.week === input.week)
  const decided = week.filter((g) => g.homeScore !== g.awayScore)
  const margin = (g: SeasonGame) => Math.abs(g.homeScore - g.awayScore)
  const side = (g: SeasonGame) =>
    g.homeScore > g.awayScore ? { winnerId: g.homeId, loserId: g.awayId } : { winnerId: g.awayId, loserId: g.homeId }
  const byMargin = [...decided].sort((a, b) => margin(a) - margin(b))
  const closestGame = byMargin[0]
  const blowoutGame = byMargin.length > 1 ? byMargin[byMargin.length - 1] : undefined

  const scores = week.flatMap((g) => [
    { rosterId: g.homeId, score: g.homeScore },
    { rosterId: g.awayId, score: g.awayScore },
  ])
  const low = [...scores].sort((a, b) => a.score - b.score)[0] ?? null

  const teams = [...new Set(week.flatMap((g) => [g.homeId, g.awayId]))]
  const streaks = teams
    .map((rosterId) => ({ rosterId, s: streakAfter(input.seasonGames, rosterId, input.week) }))
    .filter((x) => Math.abs(x.s) >= STREAK_MIN)
    .map((x) => ({ rosterId: x.rosterId, length: Math.abs(x.s), kind: (x.s > 0 ? 'win' : 'loss') as 'win' | 'loss' }))
    .sort((a, b) => b.length - a.length)

  const before = winsBefore(input.seasonGames, input.week)
  const upsets = decided
    .map((g) => {
      const s = side(g)
      return { ...s, winnerWinsBefore: before.get(s.winnerId) ?? 0, loserWinsBefore: before.get(s.loserId) ?? 0 }
    })
    .filter((u) => u.loserWinsBefore - u.winnerWinsBefore >= UPSET_WIN_GAP)

  const rivalries = week
    .filter((g) => input.rivalryPairs.has(pairKey(g.homeId, g.awayId)))
    .map((g) => ({ aId: g.homeId, bId: g.awayId, winnerId: g.homeScore === g.awayScore ? null : side(g).winnerId }))

  return {
    closest: closestGame ? { ...side(closestGame), margin: margin(closestGame) } : null,
    blowout: blowoutGame && margin(blowoutGame) > margin(closestGame!) ? { ...side(blowoutGame), margin: margin(blowoutGame) } : null,
    lowScore: low,
    streaks,
    upsets,
    rivalries,
    rivalryWeek: input.rivalryWeek,
    trades: input.trades ?? [],
    pickups: [...(input.pickups ?? [])].filter((p) => p.points > 0).sort((a, b) => b.points - a.points).slice(0, 3),
  }
}

const pts = (n: number) => n.toFixed(1)

/** The storyline lines, in a fixed order. Empty when there is nothing to say. */
export function storylineLines(facts: StorylineFacts, name: (rosterId: string) => string): string[] {
  const lines: string[] = []
  if (facts.rivalryWeek) lines.push('  🔥 It was rivalry week.')
  for (const r of facts.rivalries) {
    lines.push(
      r.winnerId
        ? `  ⚔️ Rivalry: ${name(r.winnerId)} beat ${name(r.winnerId === r.aId ? r.bId : r.aId)}`
        : `  ⚔️ Rivalry: ${name(r.aId)} and ${name(r.bId)} tied`,
    )
  }
  for (const u of facts.upsets) {
    const wins = (n: number) => `${n} win${n === 1 ? '' : 's'}`
    lines.push(`  😮 Upset: ${name(u.winnerId)} (${wins(u.winnerWinsBefore)} going in) beat ${name(u.loserId)} (${wins(u.loserWinsBefore)})`)
  }
  if (facts.closest) lines.push(`  🎯 Closest game: ${name(facts.closest.winnerId)} over ${name(facts.closest.loserId)} by ${pts(facts.closest.margin)}`)
  if (facts.blowout) lines.push(`  💥 Biggest margin: ${name(facts.blowout.winnerId)} over ${name(facts.blowout.loserId)} by ${pts(facts.blowout.margin)}`)
  for (const s of facts.streaks) {
    lines.push(`  ${s.kind === 'win' ? '📈' : '📉'} ${name(s.rosterId)} has ${s.kind === 'win' ? 'won' : 'lost'} ${s.length} straight`)
  }
  if (facts.lowScore) lines.push(`  🧊 Lowest score: ${name(facts.lowScore.rosterId)}, ${pts(facts.lowScore.score)}`)
  for (const t of facts.trades) lines.push(`  🤝 Trade completed: ${name(t.aId)} and ${name(t.bId)}`)
  for (const p of facts.pickups) lines.push(`  🧲 Pickup that paid off: ${p.playerName} started for ${name(p.rosterId)} and scored ${pts(p.points)}`)
  return lines
}

export { pairKey as rivalryPairKey }
