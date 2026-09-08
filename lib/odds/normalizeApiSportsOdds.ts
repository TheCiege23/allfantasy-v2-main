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
 * 🛑 CLASSIFY ON THE BET **ID**, NEVER ON A SUBSTRING OF THE NAME.
 *
 * This file first shipped with substring alias matching, and `/odds/bets` was then
 * captured live (the fixture is committed at
 * `contracts/api-sports/fixtures/odds-bets.json`). It returns **361** markets, not
 * the 78 the docs' collapsed sample implies, and measuring the old aliases against
 * that real list is what condemned them:
 *
 *   `'total'`    matched **59** markets. Exactly ONE is the game total.
 *                The rest include `Total Passing Yards` (~520), `Total Touchdowns`
 *                (~5.5), `Total Field Goals` (~3.5), `Total Punts`, `Total Sacks`,
 *                `Total - Home` and `Total - Away` (TEAM totals, not the game's).
 *   `'handicap'` matched `Handicap Result`, a THREE-way handicap — a different
 *                market from the two-way spread.
 *   `'2-way'`    matched `Team To Make First Score 2-Way`.
 *
 * Any of those would have landed in `total_points` or `spread_home` as a number
 * that is the right type, the right shape, and completely wrong — and, worse, they
 * would NOT have appeared in `unrecognizedBets`, because they were wrongly
 * RECOGNISED. The diagnostic could not have saved us; only the ids can.
 *
 * The docs state ids are stable and usable as filters ("All bets id can be used in
 * endpoint odds as filters"), so they are the identifier and the name is cosmetic.
 */
const BET_ID_MONEYLINE = 1 // "Home/Away"
const BET_ID_SPREAD = 2 // "Asian Handicap"
const BET_ID_TOTAL = 3 // "Over/Under"

/*
 * EXACT-name fallback, for the single case the ids cannot cover: a provider that
 * renumbers. Compared on the whole normalized string — never a substring — so
 * `Total Touchdowns` can no longer reach `Over/Under`'s branch by containing a word.
 */
const EXACT_NAME_TO_MARKET: Record<string, Market> = {
  'home/away': 'moneyline',
  'asian handicap': 'spread',
  'over/under': 'total',
}

type Market = 'moneyline' | 'spread' | 'total'

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Which of the three full-game markets this bet is, or null for the other ~358.
 *
 * Note there is a bet in the live list whose `name` is literally `null` (id 86).
 * It is handled by the caller's empty-name guard rather than here.
 */
export function classifyBet(bet: { id?: number; name?: string }): Market | null {
  if (bet.id === BET_ID_MONEYLINE) return 'moneyline'
  if (bet.id === BET_ID_SPREAD) return 'spread'
  if (bet.id === BET_ID_TOTAL) return 'total'
  return EXACT_NAME_TO_MARKET[normalizeName(String(bet.name ?? ''))] ?? null
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

  const seenNames: string[] = []

  for (const bet of bookmaker.bets ?? []) {
    const name = String(bet?.name ?? '')
    // id 86 in the live list has a null name; `values` can also be absent.
    if (!name) continue
    if (seenNames.length < 10) seenNames.push(name)

    const market = classifyBet(bet)
    if (market === null) {
      /*
       * ~358 of the 361 markets land here — player props, period splits, team
       * totals, touchdown scorers. Pushing them all into `unrecognizedBets` would
       * write a few hundred names on every row and drown the one signal that
       * matters. What gets recorded instead is handled after the loop.
       */
      continue
    }

    const values = Array.isArray(bet.values) ? bet.values : []

    if (market === 'moneyline') {
      for (const entry of values) {
        const side = sideOf(entry.value, opts.homeTeamName, opts.awayTeamName)
        const odd = parseOddToDecimal(entry.odd)
        if (odd === null) continue
        if (side === 'home') out.moneylineHome = odd
        else if (side === 'away') out.moneylineAway = odd
      }
      continue
    }

    if (market === 'spread') {
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

    if (market === 'total') {
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

  }

  /*
   * The diagnostic, re-aimed now that classification is id-based.
   *
   * A vendor RENAME no longer breaks anything (ids carry the meaning), so listing
   * unmatched names on every row would be pure noise. The failure that CAN still
   * happen is that ids 1/2/3 are absent or renumbered — and its signature is a
   * bookmaker that quoted markets from which we extracted nothing at all. Only then
   * is it worth recording what was on offer, so a human can see whether the primary
   * ids moved. Capped at 10; a book quotes hundreds.
   */
  const gotNothing =
    out.spreadHome === null &&
    out.totalPoints === null &&
    out.moneylineHome === null &&
    out.moneylineAway === null
  if (gotNothing && seenNames.length > 0) out.unrecognizedBets = seenNames

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
