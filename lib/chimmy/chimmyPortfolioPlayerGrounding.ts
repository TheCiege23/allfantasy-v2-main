import 'server-only'

import { answerMentions } from '@/lib/chimmy/chimmyPlayerCards'
import { getPlayerDetail, searchPlayers, type PlayerDetail, type PlayerMatch } from '@/lib/core-app/playerFinder'
import { playerRef } from '@/lib/core-app/playerRef'
import { toPlayedLeagues } from '@/lib/core-app/playedLeagues'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'

/**
 * CROSS-LEAGUE PLAYER GROUNDING — "what about this player, across everything I'm in".
 *
 * 🛑 THE GAP THIS FILLS IS A MISSING LOOKUP, NOT A MISSING SUMMARY. Chimmy has two player
 * grounding paths and a portfolio question falls between them. With a league selected,
 * `buildLeagueSportsGroundingPacket` supplies full rosters. With NO league selected the only
 * player facts in the packet come from `resolvePortfolioGrounding`, which serialises
 * `exposure.rows.filter((r) => r.count > 1).slice(0, 4)` — at most FOUR players, and only ones
 * rostered more than once.
 *
 * So a question naming any other player grounded on nothing, and Chimmy said so honestly:
 * "this session returned no player-level data, so I can't evaluate a Rashee Rice trade in any
 * league right now." That is the single question a multi-league product exists to answer, and it
 * was the one question the packet could not carry.
 *
 * ⚠ NOTHING HERE IS A NEW READER. `searchPlayers` is the Player Finder's own ranked search and
 * `getPlayerDetail` already answers "which of your leagues roster him, in which slot, and who has
 * him otherwise" — with its own caching. This connects a query path that exists to a grounding
 * path that had none.
 *
 * ── Why resolution is deliberately conservative ────────────────────────────────────────────
 *
 * 🛑 `chimmyPlayerCards` MEASURED THE DANGER AND ITS FINDING GOVERNS THIS FILE: matching prose
 * against 13,010 NFL players by name "would be a coin flip: duplicate names are real (a production
 * dedupe pass merged ~900 of them), and the wrong face beside a start/sit call is worse than no
 * face." Grounding the WRONG player is worse still — a card shows a face, grounding drives advice.
 *
 * Three constraints keep it honest, and each exists for a different failure:
 *
 *   1. A search hit only counts when the resolved name ACTUALLY APPEARS in the message, tested by
 *      `answerMentions` — the same rule the player chips use, which already treats hyphen and
 *      apostrophe as name characters rather than boundaries. Without this a fuzzy top hit for a
 *      misread phrase grounds a player nobody asked about.
 *   2. AMBIGUITY IS REPORTED, NEVER RESOLVED. Where one name matches several players the packet
 *      says so and names them. Picking the top hit is exactly the coin flip above.
 *   3. THE RESOLVED IDENTITY IS ALWAYS SERIALISED — name, position, team. If resolution is wrong
 *      the reader can see it is wrong, rather than reading confident advice about someone else.
 */

/**
 * Beyond this a message is not really "about" these players, and each costs a search.
 *
 * ⚠ RAISED FROM 2 WHEN SUB-RUNS WERE ADDED. One capitalised run can now yield three candidates
 * ("Is Ja'Marr Chase" → plus "Is Ja'Marr", "Ja'Marr Chase"), and a cap of 2 would have searched
 * the two forms that do NOT name the player while dropping the one that does.
 */
const MAX_CANDIDATES = 3

/** Enough to detect a duplicate name; more is wasted work. */
const SEARCH_LIMIT = 5

/**
 * Capitalised runs of 2–3 tokens — the shape of a player name in a question.
 *
 * ⚠ IT IS A CANDIDATE GENERATOR, NOT A RESOLVER, AND THAT DIVISION IS THE POINT. It is allowed to
 * be over-eager ("Trade Rashee" or "Should I") because every candidate is then put through a real
 * search AND `answerMentions` before it can ground anything. A stricter extractor that tried to be
 * the resolver would fail the other way, silently dropping names it did not recognise.
 *
 * ⚠ SUFFIXES AND INTERNAL PUNCTUATION ARE PART OF A NAME. `Jr.`, `II`, `Amon-Ra`, `Ja'Marr` all
 * have to survive tokenisation, or the candidate never matches the row it refers to.
 */
export function extractNameCandidates(message: string): string[] {
  const text = String(message ?? '')
  if (!text.trim()) return []

  const token = "[A-Z][\\p{L}'\\u2019.-]*"
  const re = new RegExp(`${token}(?:\\s+${token}){1,3}`, 'gu')

  const out: string[] = []
  const seen = new Set<string>()

  const push = (phrase: string) => {
    /* A bare two-letter run is noise ("I Am"); a real name clears this easily. */
    if (phrase.length < 5) return
    const key = phrase.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(phrase)
  }

  for (const m of text.matchAll(re)) {
    const words = m[0].replace(/\s+/g, ' ').trim().split(' ')

    /*
     * 🛑 SUB-RUNS, BECAUSE A SENTENCE-OPENING CAPITAL JOINS THE RUN AND THE NAME IS THE TAIL.
     * "Is Ja'Marr Chase worth it" produces the run "Is Ja'Marr Chase", and searching THAT is not
     * searching for the player. English capitalises the first word of a question whether or not it
     * is a name, so the leading token is exactly the one that cannot be trusted.
     *
     * ⚠ TRAILING SUB-RUNS FIRST, and that order is the useful half. A name sits at the END of such
     * a run far more often than at the start, so under the candidate cap the tail is what gets
     * searched. Dropping a fixed list of opener words instead would need the list to be right in
     * every phrasing; taking the tail needs nothing to be right.
     */
    for (let size = Math.min(words.length, 3); size >= 2; size -= 1) {
      for (let start = words.length - size; start >= 0; start -= 1) {
        push(words.slice(start, start + size).join(' '))
      }
    }
  }
  return out
}

export type PortfolioPlayerResolution =
  | { kind: 'none' }
  | { kind: 'ambiguous'; name: string; options: PlayerMatch[] }
  | { kind: 'resolved'; match: PlayerMatch }

/**
 * Pick at most one player from a candidate's search hits.
 *
 * ⚠ PURE, SO THE RESOLUTION RULE IS TESTABLE WITHOUT A DATABASE. The search itself is not the
 * risky part; deciding what counts as a confident hit is.
 */
export function resolveFromMatches(message: string, matches: readonly PlayerMatch[]): PortfolioPlayerResolution {
  /*
   * Only hits whose real name is present in the message. A ranked search always returns SOMETHING,
   * so without this the top hit for a misread phrase becomes grounding.
   */
  const named = matches.filter((m) => m.name && answerMentions(message, m.name))
  if (named.length === 0) return { kind: 'none' }

  /*
   * Distinct PEOPLE, not distinct rows: the same athlete can surface under several sports or ids,
   * and treating that as ambiguity would refuse to answer about players who are perfectly clear.
   */
  const byIdentity = new Map<string, PlayerMatch[]>()
  for (const m of named) {
    const key = `${m.name.toLowerCase()}|${(m.position ?? '').toUpperCase()}|${(m.team ?? '').toUpperCase()}`
    const list = byIdentity.get(key)
    if (list) list.push(m)
    else byIdentity.set(key, [m])
  }

  if (byIdentity.size > 1) {
    return { kind: 'ambiguous', name: named[0]!.name, options: named.slice(0, 4) }
  }
  return { kind: 'resolved', match: named[0]! }
}

/**
 * One prompt section for one resolved player.
 *
 * ⚠ `rosterCoverage.unmatched` IS NOT OPTIONAL DETAIL — IT IS WHAT STOPS A FALSE NEGATIVE.
 * ESPN and Yahoo rosters arrive under the provider's own ids and do not resolve to our player
 * table, so those leagues are UNCHECKED rather than confirmed empty. Serialising the count is what
 * keeps Chimmy from turning "we could not look" into "he is not on any of your teams" — an absence
 * reported as a fact, which is the failure this repo keeps paying for in other forms.
 */
export function serializePortfolioPlayerGrounding(detail: PlayerDetail): string {
  const p = detail.player
  const identity = [p.name, p.position, p.team].filter(Boolean).join(' · ')
  const lines: string[] = [`PLAYER LOOKUP (cross-league): ${identity}`]

  if (!detail.leagues.available) {
    lines.push(`- Roster status unavailable: ${detail.leagues.reason}`)
  } else {
    const slots = detail.leagues.data
    const yours = slots.filter((s) => s.isYours)
    const theirs = slots.filter((s) => !s.isYours)

    if (yours.length > 0) {
      lines.push(
        `- ON YOUR ROSTER in ${yours.length} league${yours.length === 1 ? '' : 's'}: ${yours
          .map((s) => `${s.leagueName} (${s.platform}, ${s.slot})`)
          .join('; ')}`,
      )
    } else {
      lines.push('- Not on any of your rosters in the leagues that could be checked.')
    }

    if (theirs.length > 0) {
      lines.push(
        `- Rostered by another manager in ${theirs.length} league${theirs.length === 1 ? '' : 's'}: ${theirs
          .map((s) => `${s.leagueName} (${s.owner ? s.owner.teamName : 'manager not named'})`)
          .join('; ')}`,
      )
    }
  }

  const unmatched = detail.rosterCoverage?.unmatched ?? []
  if (unmatched.length > 0) {
    /*
     * Named, not just counted, up to a bound: "4 leagues were not checked" invites the reader to
     * assume they are the unimportant ones.
     */
    lines.push(
      `- NOT CHECKED — ${unmatched.length} league${unmatched.length === 1 ? '' : 's'} whose rosters do not resolve to our player table: ${unmatched
        .slice(0, 6)
        .map((u) => `${u.leagueName} (${u.platform})`)
        .join('; ')}${unmatched.length > 6 ? '; …' : ''}. Absence above is not evidence for these.`,
    )
  }

  if (detail.injury.available && detail.injury.data.status) {
    lines.push(`- Injury: ${detail.injury.data.status}${detail.injury.data.description ? ` — ${detail.injury.data.description}` : ''}`)
  }

  return lines.join('\n')
}

export type PortfolioPlayerGroundingResult = {
  serialized: string
  /** Resolved players, for observability — never for the answer, which reads `serialized`. */
  resolvedNames: string[]
}

/**
 * Resolve the players a league-less question names and ground on them.
 *
 * ⚠ RETURNS null RATHER THAN AN EMPTY SECTION. A heading with nothing under it reads to the model
 * as "we looked and there is nothing", which is a different and stronger claim than "we did not
 * look" — and the packet's own contract is that Chimmy says what is missing.
 *
 * ⚠ THE CALLER MUST BOUND THIS. Every contributor to that route limits itself and nothing limits
 * the total; the route documents that the failure it guards is a slow answer rather than an error,
 * which is why nothing would catch it.
 */
export async function buildPortfolioPlayerGrounding(args: {
  message: string
  userId: string | null
  /** Injected by tests. Production resolves the full set — see below for why it must be full. */
  userLeagueIds?: string[]
}): Promise<PortfolioPlayerGroundingResult | null> {
  const { message, userId } = args
  if (!message?.trim() || !userId) return null

  /*
   * ⚠ THE CANDIDATE CHECK COMES FIRST BECAUSE IT IS FREE AND THE LEAGUE READ IS NOT.
   * Most messages name no player at all, and resolving the league list for those would put a
   * dashboard-sized read on every chat turn to answer a question nobody asked.
   */
  const candidates = extractNameCandidates(message).slice(0, MAX_CANDIDATES)
  if (candidates.length === 0) return null

  /*
   * 🛑 THE FULL LEAGUE SET, NOT THE CLIENT'S. The request carries `connectedLeagueIds`, but that
   * field is capped at 20 ids — and this account holds 65 leagues. Grounding on a truncated list
   * makes "not on any of your rosters" a claim about the 20 that happened to be sent, and
   * `rosterCoverage.unmatched` cannot flag the leagues it was never given, so the packet would
   * report neither the rostering nor the gap. A false negative that also hides itself.
   *
   * ⚠ `toPlayedLeagues` IS THE SHARED RULE, not a re-inlined filter. `hasUnifiedRecord: false`
   * rows are AF Legacy career-import snapshots — 543 of them on one production account — and the
   * players page, /core and /dashboard all drop them for the same reason.
   */
  const userLeagueIds =
    args.userLeagueIds ??
    (await getDashboardLeagueListForUser(userId)
      .then((payload) => toPlayedLeagues((payload?.leagues ?? []) as Array<{ id?: unknown }>).map((l) => String(l.id ?? '')).filter(Boolean))
      .catch(() => [] as string[]))

  if (userLeagueIds.length === 0) return null

  const sections: string[] = []
  const resolvedNames: string[] = []
  const seenPlayers = new Set<string>()

  for (const candidate of candidates) {
    const matches = await searchPlayers(candidate, SEARCH_LIMIT).catch(() => [] as PlayerMatch[])
    if (matches.length === 0) continue

    const resolution = resolveFromMatches(message, matches)
    if (resolution.kind === 'none') continue

    if (resolution.kind === 'ambiguous') {
      /*
       * Reported rather than resolved — see this file's header. The reader can disambiguate in one
       * word; a wrong pick is invisible and drives the whole answer.
       */
      sections.push(
        `PLAYER LOOKUP (cross-league): "${resolution.name}" matches more than one player — ${resolution.options
          .map((o) => [o.name, o.position, o.team].filter(Boolean).join(' '))
          .join('; ')}. Ask which one before answering about him.`,
      )
      continue
    }

    const match = resolution.match
    const identityKey = `${match.sport}:${match.externalId}`
    if (seenPlayers.has(identityKey)) continue
    seenPlayers.add(identityKey)

    const detail = await getPlayerDetail(playerRef(match.sport, match.externalId), userLeagueIds, userId).catch(
      () => null,
    )
    if (!detail) continue

    sections.push(serializePortfolioPlayerGrounding(detail))
    resolvedNames.push(detail.player.name)
  }

  if (sections.length === 0) return null
  return { serialized: sections.join('\n\n'), resolvedNames }
}
