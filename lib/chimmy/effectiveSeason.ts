import 'server-only'

/**
 * WHICH SEASON AN ANSWER IS ABOUT, AND WHERE THAT CAME FROM.
 *
 * 🛑 THE CLIENT USED TO DECIDE THIS AND THE LEAGUE DID NOT GET A VOTE.
 * `buildLeagueSportsGroundingPacket` resolves `args.season ?? leagueRow.season`,
 * so a `season` field on the form outranked the league's own season — and that
 * field keys the SPORTS reads inside the packet (`loadPlayerPoolSummary`,
 * `loadFantasyData`, `loadScheduleSummary`, provider health), not just a label.
 * A packet could therefore describe a 2019 player pool as the evidence behind an
 * answer about a 2026 league, while the grounding line two lines above it said
 * `season=2026`. The league-scoped reads in that same packet were always keyed
 * on leagueId and userId and were never affected; it is the world-data half that
 * moved.
 *
 * ⚠ THE FIX IS NOT SIMPLY "THE LEAGUE ALWAYS WINS", because that silently
 * answers "how did I do in 2025?" with this season's data — a wrong answer with
 * no tell, which is worse than the bug being fixed. So the league wins by
 * DEFAULT and an explicit year in the QUESTION reopens the past.
 *
 * ⚠ AND A MESSAGE NAMING TWO YEARS RESOLVES TO NEITHER. "compare 2024 and 2025"
 * has no single answer, and picking one would be a guess presented as a fact.
 * Ambiguity falls back to the league season, which the grounding line states.
 *
 * The `source` is returned so the grounding line can SAY which season it used.
 * A past-season answer that does not announce itself is indistinguishable from a
 * current-season answer that is simply wrong.
 */
export function resolveEffectiveSeason(args: {
  leagueSeason: number | null
  requestedSeason: number | null
  message: string
  now?: Date
}): { season: number | null; source: 'question' | 'league' | 'request' | 'none' } {
  const year = (args.now ?? new Date()).getFullYear()

  /*
   * Bounded on BOTH sides, in two senses.
   *
   * The word boundaries stop a year matching inside a longer run of digits — a
   * Sleeper player id, a FAAB figure, a timestamp.
   *
   * 🛑 AND THEY WERE EATEN TWICE WHILE THIS FUNCTION WAS BEING WRITTEN, ARRIVING
   * AS A LITERAL BACKSPACE (0x08) IN THE SOURCE. The file still parsed, the
   * regex still compiled, and `/(20d{2})/` — the shape it degrades to — still
   * matched years, just also inside "120255". Same family as the NUL byte this
   * repo already records: a shell layer ate one level of escaping and the result
   * was valid code that meant something else. If you edit this line, read the
   * bytes back, not the rendered text.
   *
   * The numeric range is the second bound: it stops a four-digit number that is
   * not a season at all, and \d{4} matches a jersey number written
   * as 1987, a dollar figure, or a player's birth year; `year + 1` is the
   * furthest ahead anyone can sensibly ask about.
   */
  const named = new Set<number>()
  for (const match of args.message.matchAll(/\b(20\d{2})\b/g)) {
    const value = Number(match[1])
    if (value >= 2000 && value <= year + 1) named.add(value)
  }
  if (named.size === 1) {
    return { season: [...named][0], source: 'question' }
  }

  if (args.leagueSeason != null) return { season: args.leagueSeason, source: 'league' }
  /*
   * No league in scope, so there is nothing to outrank the client field and it
   * is the only season signal there is. This is the ONLY path on which it wins.
   */
  if (args.requestedSeason != null) return { season: args.requestedSeason, source: 'request' }
  return { season: null, source: 'none' }
}
