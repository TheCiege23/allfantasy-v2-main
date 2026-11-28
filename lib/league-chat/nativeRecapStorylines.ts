/**
 * The weekly recap's storylines, from facts only.
 *
 * The native weekly recap (lib/league-chat/nativeWeeklyRecap.ts) used to compute its own closest game, biggest
 * margin, lowest score, streaks and upsets here — copies of rules other systems own (the weekly awards in
 * lib/league-history/sleeperH2HService.ts, the drama engine's upsets and streaks). The owner's rule is that the recap
 * plugs into those systems rather than keep a parallel generator, so since 2026-11-28 this file holds only what no
 * other system produces:
 *
 *   - rivalry games    — this week's games between a pair the league's rivalry scores name (the SAME scores rivalry
 *                        week pairs from: lib/schedule-runtime/rivalryWeekService.ts `loadSeasonRivalryPairKeys`),
 *                        and whether it was rivalry week;
 *   - trades completed this week, and pickups that started and scored — passed in by the loader.
 *
 * The week's awards (top score, low score, narrow escape, biggest blowout) come from `aggregateH2HSeasons` and are
 * worded by `weeklyAwardLines` (lib/league-chat/weeklyRecapMoment.ts), as the Sleeper recap's are. Upsets and streaks
 * belong to the drama engine, which does not read native leagues yet, so the recap names neither rather than guess.
 *
 * Pure (no I/O). Ids in, a namer turns them into team names at the end.
 */
export type SeasonGame = { week: number; homeId: string; awayId: string; homeScore: number; awayScore: number }
export type StorylinePickup = { rosterId: string; playerName: string; points: number }
export type StorylineTrade = { aId: string; bId: string }

export type StorylineFacts = {
  rivalries: Array<{ aId: string; bId: string; winnerId: string | null }>
  rivalryWeek: boolean
  trades: StorylineTrade[]
  pickups: StorylinePickup[]
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|')

export function buildStorylineFacts(input: {
  week: number
  /** This week's finished head-to-head games. */
  weekGames: readonly SeasonGame[]
  rivalryPairs: ReadonlySet<string>
  rivalryWeek: boolean
  trades?: StorylineTrade[]
  pickups?: StorylinePickup[]
}): StorylineFacts {
  const week = input.weekGames.filter((g) => g.week === input.week)
  const rivalries = week
    .filter((g) => input.rivalryPairs.has(pairKey(g.homeId, g.awayId)))
    .map((g) => ({
      aId: g.homeId,
      bId: g.awayId,
      winnerId: g.homeScore === g.awayScore ? null : g.homeScore > g.awayScore ? g.homeId : g.awayId,
    }))
  return {
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
  for (const t of facts.trades) lines.push(`  🤝 Trade completed: ${name(t.aId)} and ${name(t.bId)}`)
  for (const p of facts.pickups) lines.push(`  🧲 Pickup that paid off: ${p.playerName} started for ${name(p.rosterId)} and scored ${pts(p.points)}`)
  return lines
}

export { pairKey as rivalryPairKey }
