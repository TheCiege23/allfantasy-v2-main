import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { findPricedPlayersByName, isUnpriced, loadPlayerMarketValue } from '@/lib/core-app/playerMarketValue'
import { CROSS_LEAGUE_BOOK, valueBookFor, type ValueBook } from '@/lib/core-app/valueBook'

/**
 * What one player is worth, for the model to read.
 *
 * 🛑 THE NUMBER IS THE PLAYER CARD'S (re-score 2026-11-17). It is read by `loadPlayerMarketValue` — the card's own
 * read — on the league's own chart (`valueBookFor`, the rule every screen uses), or on the card's cross-league
 * chart when no league is in scope. This tool used to quote the `AllFantasyMarketPlayerValue` house table instead,
 * so "what is he worth?" in chat could disagree with his card. The house value, where one is published, now follows
 * as a separately-labelled second measure rather than as THE value.
 *
 * (The notes below on concepts describe that house table.)
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
    `NO MARKET VALUE IS ON FILE FOR "${asked}" ON THIS CHART.`,
    'This is NOT a finding that the player is worthless, unranked, or unknown to AllFantasy,',
    'and you must NOT say any of those. The market prices the players who trade — kickers and',
    'defenders are not priced, and deep reserves often are not — so a miss is expected for many names.',
    'You must NOT substitute a number from general knowledge, from another site, or from your own',
    'estimate — a made-up value is the worst answer here, because the user cannot tell it apart from a real one.',
    'Say plainly that we have no market value for that player, and offer to compare two players',
    'we do value, or check the spelling of the name.',
  ].join(' ')
}

/** The chart a league prices on, or the card's cross-league chart. Never a default posing as the league's. */
async function bookFor(leagueId: string | null | undefined): Promise<{ book: ValueBook; basis: string }> {
  if (leagueId) {
    const row = await prisma.league
      .findUnique({ where: { id: leagueId }, select: { settings: true, leagueType: true, sport: true } })
      .catch(() => null)
    if (row && String(row.sport ?? 'NFL').toUpperCase() === 'NFL') {
      return { book: valueBookFor(row.settings, row.leagueType ?? null), basis: "this league's chart" }
    }
  }
  return { book: CROSS_LEAGUE_BOOK, basis: 'the cross-league chart (no NFL league in scope), as the league-less player card shows' }
}

function chartLabel(book: ValueBook): string {
  return `${book.format === 'DYNASTY' ? 'dynasty' : 'redraft'}, ${book.qbFormat === 'SUPERFLEX' ? 'superflex' : 'one-QB'}`
}

/** The house value as a SECOND, labelled measure — or nothing. Never presented as the player's value. */
async function houseValueLines(target: string): Promise<string[]> {
  const rows = await prisma.allFantasyMarketPlayerValue
    .findMany({ where: { published: true, sport: 'NFL' }, select: SELECT, orderBy: { marketValue: 'desc' } })
    .catch(() => [] as Array<Record<string, unknown>>)
  const matches = rows.filter(
    (r) => normalizePlayerName(String((r as { playerName?: unknown }).playerName ?? '')) === target,
  ) as Array<{ marketValue: number; leagueConcept: string | null; scoringFormat: string | null }>
  if (!matches.length) return []
  return [
    'Also published: the AllFantasy trade-market value, built from completed trades — a DIFFERENT measure from the chart value above. Quote it only if the user asks about the AllFantasy market:',
    ...matches.map((m) => {
      const concept = String(m.leagueConcept ?? '').trim() || 'market'
      const scoring = m.scoringFormat?.trim()
      return `- ${scoring ? `${concept}, ${scoring}` : concept}: ${m.marketValue.toLocaleString()}`
    }),
  ]
}

/**
 * Prose describing what a named player is worth, or a sentence saying why there is nothing.
 *
 * Never throws — the caller turns an exception into "could not read", but a lookup that returns a
 * misleading sentence is worse than one that throws, so the refusals above are the real product.
 */
export async function buildPlayerValueContext(args: { playerName: string; leagueId?: string | null }): Promise<string> {
  const asked = args.playerName.trim()
  if (!asked) {
    return 'No player name was given, so nothing was looked up. Ask the user which player they mean.'
  }

  const target = normalizePlayerName(asked)
  if (!target) return notFound(asked)

  const { book, basis } = await bookFor(args.leagueId)
  const { capturedAt, matches } = await findPricedPlayersByName(asked, book)

  /*
   * These must not collapse into one sentence. "We have no values at all" (or could not read them) and "we have
   * values and none is his" are different facts, and only the second says anything about the player.
   */
  if (!capturedAt) {
    return [
      'NO MARKET VALUES ARE ON FILE AT ALL FOR THIS CHART, so nothing could be looked up.',
      'This is NOT a finding about this player. Say we cannot read player values right now;',
      'do NOT give a number for anyone.',
    ].join(' ')
  }

  if (matches.length === 0) {
    const house = await houseValueLines(target)
    return house.length ? [notFound(asked), ...house].join('\n') : notFound(asked)
  }
  if (matches.length > 1) {
    return [
      `More than one player named "${asked}" is priced: ${matches.map((m) => [m.name, m.position].filter(Boolean).join(', ')).join('; ')}.`,
      'Do NOT pick one. Ask the user which player they mean (position or team), then look up that one.',
    ].join(' ')
  }

  const player = matches[0]!
  const market = await loadPlayerMarketValue(player.sleeperId, player.position, book)
  if (!market.available) {
    return isUnpriced(player.position) ? `${market.reason} ${notFound(asked)}` : notFound(asked)
  }
  const m = market.data
  const who = [player.name, player.position].filter(Boolean).join(', ')
  const lines: string[] = [
    `${who} — market value on ${basis} (${chartLabel(book)}): ${m.value.toLocaleString()}` +
      `${m.overallRank != null ? `, #${m.overallRank} overall` : ''}${m.positionRank != null ? `, #${m.positionRank} at his position` : ''}` +
      `${m.delta ? `, ${m.delta.change >= 0 ? '+' : ''}${m.delta.change.toLocaleString()} over ${m.delta.days} days` : ''}` +
      ` (as of ${m.capturedAt.slice(0, 10)}).`,
    'This is the SAME number his player card shows for this league. Quote it as his value.',
    /*
     * ⚠ THE SCALE HAS TO BE NAMED OR THE NUMBER IS UNREADABLE. 6,552 means nothing on its own, and a model given a
     * bare figure will reach for a comparison it invents.
     */
    'The scale runs 0-10000, where 10000 is the most valuable asset in the game. Compare it only to other values on this same chart — never to KeepTradeCut or Sleeper numbers, which use different scales.',
    /*
     * ⚠ WHAT THIS NUMBER IS NOT. Named explicitly because the most common follow-up question is a start/sit one,
     * and a long-term asset value is a bad answer to it.
     */
    "This is long-term asset worth for trading, NOT a projection of this week's points and NOT a start/sit ranking. If the user is asking who to start, say this number does not answer that.",
  ]
  lines.push(...(await houseValueLines(target)))
  return lines.join('\n')
}
