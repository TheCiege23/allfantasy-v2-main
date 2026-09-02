import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'

/**
 * What one player is worth, for the model to read.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────
 * `get_available_players` already surfaces AllFantasy market values, but only as a RANKED LIST
 * of unrostered players. A manager asking "what is Ja'Marr Chase worth" got nothing: the player
 * is rostered, so he never appears in that list, and the model then answered from general
 * knowledge in the same confident voice it uses for grounded answers.
 *
 * ── 🛑 IT TAKES A NAME, NEVER AN ID, AND NEVER A LEAGUE ID ──────────────────────────────────
 * The rule from `chimmyTools.ts` holds here: a model that can pass a league id can pass somebody
 * else's. This tool needs no league at all — a market value is a property of the player and the
 * concept, not of the asker's league — so it takes neither.
 *
 * ── ⚠ ONE PLAYER HOLDS SEVERAL ROWS, AND THE CONCEPT IS READ, NEVER ASSUMED ────────────────
 * The unique key is [sport, leagueConcept, playerId], so a player valued under both redraft and
 * dynasty appears twice, at genuinely different numbers — a rookie is worth far more in dynasty
 * than in redraft, and collapsing them would answer a question nobody asked.
 *
 * 🛑 AND THE REPO DISAGREES WITH ITSELF ABOUT WHICH CONCEPT IS POPULATED. Two comments in
 * `availablePlayersTool.ts`, about forty lines apart, say "Only `redraft` is populated today" and
 * "EVERY PUBLISHED ROW IS `dynasty` TODAY". Both cannot be true. This tool therefore asserts
 * NEITHER: it reports every concept it finds, labelled, straight off the rows. That is the
 * instruction the second comment gives for exactly this reason — "read from the rows so it stays
 * true when redraft values ship rather than becoming a comment that lies" — and it also means
 * this file is correct whichever of the two is right.
 */

/** Columns the answer is built from. Narrow on purpose; nothing here needs the signal counts. */
const SELECT = {
  playerId: true,
  playerName: true,
  position: true,
  team: true,
  marketValue: true,
  leagueConcept: true,
  scoringFormat: true,
  confidence: true,
} as const

/**
 * ⚠ ABSENCE IS A SENTENCE THAT FORBIDS THE PARAPHRASE, NOT AN EMPTY RESULT.
 *
 * The precedent is `NO_LEAGUE` in `chimmyTools.ts`, and it was written after a measured
 * production failure: the model turned "I could not look" into "your league has no records". The
 * same rewrite here would be "AllFantasy does not value Player X" — which reads as a statement
 * about our coverage, from a lookup that found no ROW. A published set of a few hundred names
 * missing a backup tight end is not a claim that he is worthless.
 */
function notFound(asked: string): string {
  return [
    `NO PUBLISHED ALLFANTASY VALUE ROW MATCHED "${asked}".`,
    'This is NOT a finding that the player is worthless, unranked, or unknown to AllFantasy,',
    'and you must NOT say any of those. Only a few hundred players carry a published house value,',
    'so a miss is expected for most of the league. You must NOT substitute a number from general',
    'knowledge, from another site, or from your own estimate — a made-up value is the worst answer',
    'here, because the user cannot tell it apart from a real one.',
    'Say plainly that we do not publish a value for that player, and offer to compare two players',
    'we do value, or check the spelling of the name.',
  ].join(' ')
}

/**
 * Prose describing what a named player is worth, or a sentence saying why there is nothing.
 *
 * Never throws — the caller turns an exception into "could not read", but a lookup that returns a
 * misleading sentence is worse than one that throws, so the refusals above are the real product.
 */
export async function buildPlayerValueContext(args: { playerName: string }): Promise<string> {
  const asked = args.playerName.trim()
  if (!asked) {
    return 'No player name was given, so nothing was looked up. Ask the user which player they mean.'
  }

  const target = normalizePlayerName(asked)
  if (!target) return notFound(asked)

  /*
   * ⚠ FETCHED AND MATCHED IN MEMORY RATHER THAN FILTERED IN SQL, DELIBERATELY.
   *
   * The stored `playerName` is raw ("Ja'Marr Chase", "Marvin Harrison Jr."), and the user types
   * whatever they type. Matching needs `normalizePlayerName` — the identity authority, which
   * delegates to `canonicalName` for the apostrophe and generational-suffix rules — and that is
   * JavaScript, not SQL.
   *
   * 🛑 REIMPLEMENTING IT AS A SQL `regexp_replace` IS THE ONE THING NOT TO DO HERE. CLAUDE.md
   * records the measurement: a SQL copy of this normalizer disagreed with the real one on 7.2% of
   * 500 rows, on exactly these cases. The table is a few hundred published rows, so reading it is
   * cheap and correctness is free.
   */
  const rows = await prisma.allFantasyMarketPlayerValue
    .findMany({
      where: { published: true, sport: 'NFL' },
      select: SELECT,
      orderBy: { marketValue: 'desc' },
    })
    .catch(() => [] as Array<Record<string, unknown>>)

  if (rows.length === 0) {
    return [
      'NO PUBLISHED ALLFANTASY VALUES ARE ON FILE AT ALL, so nothing could be looked up.',
      'This is NOT a finding about this player. Say we cannot read player values right now;',
      'do NOT give a number for anyone.',
    ].join(' ')
  }

  const matches = rows.filter(
    (r) => normalizePlayerName(String((r as { playerName?: unknown }).playerName ?? '')) === target,
  ) as Array<{
    playerName: string | null
    position: string | null
    team: string | null
    marketValue: number
    leagueConcept: string | null
    scoringFormat: string | null
    confidence: number
  }>

  if (matches.length === 0) return notFound(asked)

  const display = matches[0].playerName?.trim() || asked
  const position = matches[0].position?.trim() || null
  const team = matches[0].team?.trim() || null
  const who = [display, position, team].filter(Boolean).join(', ')

  const lines: string[] = [
    `AllFantasy published market value for ${who}:`,
    ...matches.map((m) => {
      const concept = String(m.leagueConcept ?? '').trim() || 'market'
      const scoring = m.scoringFormat?.trim()
      const label = scoring ? `${concept}, ${scoring}` : concept
      return `- ${label}: ${m.marketValue.toLocaleString()} (confidence ${m.confidence})`
    }),
  ]

  /*
   * ⚠ THE SCALE HAS TO BE NAMED OR THE NUMBER IS UNREADABLE. 6,552 means nothing on its own, and
   * a model given a bare figure will reach for a comparison it invents. The 0–10000 convention is
   * FantasyCalc's, which is why two AllFantasy numbers can be compared to each other and an
   * AllFantasy number cannot be compared to a KeepTradeCut one.
   */
  lines.push(
    'These are AllFantasy house values on a 0-10000 scale, where 10000 is the most valuable asset in the game. Compare them only to other AllFantasy values — never to KeepTradeCut, Sleeper or FantasyCalc numbers, which use different scales.',
  )

  if (matches.length > 1) {
    lines.push(
      'The values above are for DIFFERENT league concepts and are not alternatives to average. Quote the one matching the league the user is asking about, and say which concept it is.',
    )
  } else {
    const only = String(matches[0].leagueConcept ?? '').trim()
    if (only) {
      lines.push(
        `Only the ${only} value is published for this player. Do NOT present it as a value for any other format — if the user is asking about a different concept, say we do not publish one.`,
      )
    }
  }

  /*
   * ⚠ WHAT THIS NUMBER IS NOT. Named explicitly because the most common follow-up question is a
   * start/sit one, and a long-term asset value is a bad answer to it — the same trap
   * `availablePlayersTool` names when it warns against ranking a rookie over a producer.
   */
  lines.push(
    'This is long-term asset worth for trading, NOT a projection of this week\'s points and NOT a start/sit ranking. If the user is asking who to start, say this number does not answer that.',
  )

  return lines.join('\n')
}
