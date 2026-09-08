/**
 * API-Sports odds → normalized market rows.
 *
 * PURE. No prisma, no fetch, no env. That is deliberate: the writer in
 * `lib/api-sports.ts` is allowlisted by the DB-first guard, and the parsing is
 * the part most likely to be wrong, so it lives where a unit test can reach it
 * without a database or a provider key.
 *
 * 🛑 THE BET NAMES ARE STILL NOT VERIFIED, EVEN WITH THE DOCS IN HAND.
 * The v1 American Football documentation was read on 2026-09-08 and it settles the
 * envelope — `/odds` takes a REQUIRED `game` id plus optional `bookmaker` and
 * `bet`, prices exist 1-7 days pre-match, 78 bet types exist, 18 bookmakers. What
 * it does NOT give is the one thing this file needs: every response sample in the
 * docs is collapsed (`"results": 78` with the array rendered as `{}`), so not a
 * single literal `bets[].name` string appears anywhere in them. The committed
 * `APISportsOdds` interface types it as a bare `string` and says no more.
 *
 * ✅ THE CHEAP WAY TO RESOLVE IT, when someone wants to: `/odds/bets` returns all
 * 78 names in ONE call, and `fetchAPISportsBetTypes()` in lib/api-sports.ts already
 * wraps it. Run it once against a live key, read the names, and replace the guesses
 * below with the real strings. Until then:
 *
 * every alias list below is a BEST GUESS from API-Sports' cross-sport odds
 * conventions, and the normalizer is built to make a wrong guess LOUD rather than
 * silent:
 *
 *   - Anything it cannot parse yields `null`, never `0`. A zero spread and a
 *     missing spread are different facts and a pick-em is a real market, so the
 *     two must never collapse into one value.
 *   - Every bet name it did not recognise is returned in `unrecognizedBets`. The
 *     writer persists that list, so a vendor rename shows up as data instead of
 *     as quietly-empty columns.
 *
 * When the first real payload lands, read `unrecognizedBets` off the stored rows
 * and widen the alias sets — that is the intended feedback loop, and it is why
 * the raw payload is stored alongside the parsed columns.
 */

/** One bookmaker's parsed view of a single game. */
export interface NormalizedGameOdds {
  bookmakerId: number
  bookmakerName: string

  /**
   * Point spread from the HOME team's perspective, in points.
   * Negative = home favoured (the standard convention). `-3.5` means home gives 3.5.
   */
  spreadHome: number | null
  /** Decimal odds attached to each side of the spread, when present. */
  spreadHomeOdd: number | null
  spreadAwayOdd: number | null

  /** Moneyline as DECIMAL odds (2.50 = +150). Converted from American when needed. */
  moneylineHome: number | null
  moneylineAway: number | null

  /** Game total (over/under) in points. */
  totalPoints: number | null
  overOdd: number | null
  underOdd: number | null

  /**
   * Implied team totals — the whole reason this feed is worth ingesting.
   * Derived, not quoted: home = total/2 - spread/2, away = total/2 + spread/2.
   * Null unless BOTH a total and a spread parsed, because half the inputs give
   * half an answer, and half an answer here looks exactly like a real one.
   */
  impliedHomeTotal: number | null
  impliedAwayTotal: number | null

  /**
   * Vig-free home win probability from the two moneylines
   * (1/home) / (1/home + 1/away). Null unless both sides parsed — a one-sided
   * book price still implies a probability, but one that silently includes the
   * hold, which is not the number anyone wants.
   */
  homeWinProbability: number | null

  /** Bet names present in the payload that no alias set matched. */
  unrecognizedBets: string[]
}

/*
 * Alias sets. Matched case-insensitively as SUBSTRINGS, because vendors decorate
 * ("Asian Handicap (1st Half)"), and ordering matters: a name is tested against
 * every set and the first match wins, so the more specific sets are listed first.
 */
/*
 * 🛑 `'line'` IS NOT AN ALIAS FOR SPREAD, AND IT USED TO BE. Substring matching
 * meant `'Moneyline'` contained `'line'`, so a moneyline market was classified as a
 * spread, its team-named values parsed for a points number, found none, and the
 * whole market vanished — moneylineHome/Away null, no error, no unrecognised name.
 * Caught by the team-named-sides test in __tests__/odds. Some books do label the
 * spread "Line"; such a book now lands in `unrecognizedBets` instead, which is the
 * failure this file is built to prefer — visible rather than silent.
 *
 * MONEYLINE IS ALSO TESTED FIRST for the same reason: it is the set whose names most
 * readily contain another set's words, so it gets first refusal.
 */
const MONEYLINE_ALIASES = ['home/away', 'moneyline', 'money line', 'match winner', 'winner', 'to win', '2way', '2-way']
const SPREAD_ALIASES = ['handicap', 'point spread', 'spread']
const TOTAL_ALIASES = ['over/under', 'over under', 'total points', 'totals', 'total']

/*
 * ⚠ PERIOD-SCOPED MARKETS MUST BE REJECTED, NOT PARSED.
 * A book quotes the same three markets for halves and quarters, and those names
 * contain the full-game aliases as substrings ("Over/Under 1st Half"). Matching
 * on substring alone would let a 1st-quarter total overwrite the game total with
 * a number roughly a quarter the size — a value that is entirely plausible, lands
 * in the right column, and is wrong. Checked BEFORE the alias sets.
 */
const PERIOD_SCOPED_MARKERS = [
  '1st half', '2nd half', 'first half', 'second half', 'halftime', 'half time',
  '1st quarter', '2nd quarter', '3rd quarter', '4th quarter',
  'quarter', 'period', 'inning', 'drive',
]

function isPeriodScoped(betName: string): boolean {
  const lower = betName.toLowerCase()
  return PERIOD_SCOPED_MARKERS.some((marker) => lower.includes(marker))
}

function matchesAny(betName: string, aliases: string[]): boolean {
  const lower = betName.toLowerCase()
  return aliases.some((alias) => lower.includes(alias))
}

/**
 * Parse a price into DECIMAL odds.
 *
 * The vendor's `odd` field is a string and the interface does not say which
 * format it carries, so this detects rather than assumes:
 *   "+150" / "-110"  → American  (explicit sign, or |v| >= 100)
 *   "2.50" / "1.91"  → decimal   (1 < v < 100)
 *
 * The two ranges do not overlap for any real price: decimal odds above 100 would
 * be a 100-1 longshot, and an American price is never inside (-100, +100). A
 * value that is neither returns null rather than a guess.
 */
export function parseOddToDecimal(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (!text) return null

  const value = Number(text.replace(/[^0-9.+-]/g, ''))
  if (!Number.isFinite(value) || value === 0) return null

  // American: explicit leading sign, or magnitude at/above 100.
  const hasExplicitSign = /^[+-]/.test(text)
  if (hasExplicitSign || Math.abs(value) >= 100) {
    if (value > 0) return 1 + value / 100
    return 1 + 100 / Math.abs(value)
  }

  // Decimal odds are strictly greater than 1 (an even-money price is 2.0).
  if (value > 1) return value

  return null
}

/**
 * Pull a signed points number out of a market value string.
 * Handles "Home -3.5", "-3.5", "Over 45.5", "+7".
 * Returns null when there is no number, so "Home" alone does not become 0.
 */
export function parsePoints(value: string | null | undefined): number | null {
  if (!value) return null
  const match = String(value).match(/[+-]?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

/** Which side of a two-way market a value string refers to. */
function sideOf(value: string, homeTeamName?: string | null, awayTeamName?: string | null): 'home' | 'away' | null {
  const lower = value.trim().toLowerCase()
  if (lower.startsWith('home') || lower === '1') return 'home'
  if (lower.startsWith('away') || lower === '2') return 'away'
  if (homeTeamName && lower.includes(homeTeamName.trim().toLowerCase())) return 'home'
  if (awayTeamName && lower.includes(awayTeamName.trim().toLowerCase())) return 'away'
  return null
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export interface RawBookmaker {
  id: number
  name: string
  bets: Array<{
    id: number
    name: string
    values: Array<{ value: string; odd: string }>
  }>
}

/**
 * Normalize one bookmaker's bets for one game.
 *
 * `homeTeamName` / `awayTeamName` are optional and only used to resolve values
 * that name the team instead of saying "Home"/"Away". Without them a team-named
 * market simply does not parse — which is the correct outcome, not a silent
 * mis-assignment to the wrong side.
 */
export function normalizeBookmakerOdds(
  bookmaker: RawBookmaker,
  opts: { homeTeamName?: string | null; awayTeamName?: string | null } = {},
): NormalizedGameOdds {
  const out: NormalizedGameOdds = {
    bookmakerId: bookmaker.id,
    bookmakerName: bookmaker.name,
    spreadHome: null,
    spreadHomeOdd: null,
    spreadAwayOdd: null,
    moneylineHome: null,
    moneylineAway: null,
    totalPoints: null,
    overOdd: null,
    underOdd: null,
    impliedHomeTotal: null,
    impliedAwayTotal: null,
    homeWinProbability: null,
    unrecognizedBets: [],
  }

  for (const bet of bookmaker.bets ?? []) {
    const name = String(bet?.name ?? '')
    if (!name) continue

    if (isPeriodScoped(name)) {
      // Not "unrecognized" — recognised and deliberately skipped. Recording it as
      // unknown would bury the genuine vendor-rename signal under routine noise.
      continue
    }

    const values = Array.isArray(bet.values) ? bet.values : []

    // Moneyline first — see the alias-set comment for the collision this ordering fixes.
    if (matchesAny(name, MONEYLINE_ALIASES)) {
      for (const entry of values) {
        const side = sideOf(entry.value, opts.homeTeamName, opts.awayTeamName)
        const odd = parseOddToDecimal(entry.odd)
        if (odd === null) continue
        if (side === 'home') out.moneylineHome = odd
        else if (side === 'away') out.moneylineAway = odd
      }
      continue
    }

    if (matchesAny(name, SPREAD_ALIASES)) {
      for (const entry of values) {
        const side = sideOf(entry.value, opts.homeTeamName, opts.awayTeamName)
        const points = parsePoints(entry.value)
        const odd = parseOddToDecimal(entry.odd)
        if (side === 'home') {
          if (points !== null) out.spreadHome = points
          if (odd !== null) out.spreadHomeOdd = odd
        } else if (side === 'away') {
          if (odd !== null) out.spreadAwayOdd = odd
          // Away line only fills the home number when home never supplied one;
          // the two are mirror images, so this keeps a one-sided quote usable.
          if (points !== null && out.spreadHome === null) out.spreadHome = -points
        }
      }
      continue
    }

    if (matchesAny(name, TOTAL_ALIASES)) {
      for (const entry of values) {
        const lower = String(entry.value ?? '').trim().toLowerCase()
        const points = parsePoints(entry.value)
        const odd = parseOddToDecimal(entry.odd)
        if (lower.startsWith('over')) {
          if (points !== null) out.totalPoints = points
          if (odd !== null) out.overOdd = odd
        } else if (lower.startsWith('under')) {
          if (points !== null && out.totalPoints === null) out.totalPoints = points
          if (odd !== null) out.underOdd = odd
        }
      }
      continue
    }

    out.unrecognizedBets.push(name)
  }

  // Derived fields. Both require a complete pair by design — see the field docs.
  if (out.totalPoints !== null && out.spreadHome !== null) {
    out.impliedHomeTotal = roundTo(out.totalPoints / 2 - out.spreadHome / 2, 2)
    out.impliedAwayTotal = roundTo(out.totalPoints / 2 + out.spreadHome / 2, 2)
  }

  if (out.moneylineHome !== null && out.moneylineAway !== null) {
    const homeRaw = 1 / out.moneylineHome
    const awayRaw = 1 / out.moneylineAway
    const overround = homeRaw + awayRaw
    if (overround > 0) out.homeWinProbability = roundTo(homeRaw / overround, 4)
  }

  return out
}

/**
 * Pick the single best row for a game from every bookmaker quoted.
 *
 * "Best" = most complete, then lowest bookmaker id as a stable tiebreak. A
 * consensus/median across books would be a better number, but it is a different
 * feature with its own failure modes (a stale book drags the median), so this
 * stays deliberately simple and the per-book rows are all persisted anyway.
 */
export function pickPrimaryBookmaker(rows: NormalizedGameOdds[]): NormalizedGameOdds | null {
  if (!rows.length) return null
  const score = (row: NormalizedGameOdds) =>
    (row.spreadHome !== null ? 1 : 0) +
    (row.totalPoints !== null ? 1 : 0) +
    (row.moneylineHome !== null && row.moneylineAway !== null ? 1 : 0)

  return [...rows].sort((a, b) => {
    const diff = score(b) - score(a)
    if (diff !== 0) return diff
    return a.bookmakerId - b.bookmakerId
  })[0]
}
