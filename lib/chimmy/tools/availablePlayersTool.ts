import 'server-only'

import { prisma } from '@/lib/prisma'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import type { FantasyCalcSettings } from '@/lib/fantasycalc'

/**
 * PLAYERS NOT ON ANY ROSTER IN THE LEAGUE IN SCOPE.
 *
 * "Who can I pick up?" was the last unanswered question from the original
 * capability list, and it was left alone because the obvious source is empty:
 * `waiver_claims` holds 0 rows, `waiver_transactions` 0. Measured 2026-08-28,
 * unchanged since the waiver-rules block was written.
 *
 * ⚠ SO THIS TOOL ANSWERS A DIFFERENT QUESTION THAN THE ONE ASKED, AND SAYS SO.
 * We cannot see who is ON WAIVERS — that is a claims-and-timing fact and we hold
 * none of it. What we can compute exactly is who is UNROSTERED: every NFL
 * league's rosters are synced (all touched today), so subtracting them from our
 * valued player set is arithmetic, not inference. "Unrostered" and "on waivers"
 * are different things on every platform — a just-dropped player is unrostered
 * AND unclaimable — so the wording has to keep them apart, or the model will say
 * "go grab him" about someone locked in a waiver period.
 *
 * ⚠ THE POOL IS BOUNDED BY OUR VALUE SET, NOT BY THE NFL. `PlayerIdentityMap`
 * holds 9,028 NFL sleeper ids, but most are retired, practice-squad or long
 * inactive, so "everyone unrostered" would be thousands of names and mostly
 * junk. `allfantasy_market_player_values` is the ranked set — 165 published rows
 * — and the ranking is the entire value of the answer. The cost is real and is
 * stated in the block: a deep league can have ZERO valued players available, and
 * that is a true statement about our rankings, not a claim that the waiver wire
 * is bare.
 *
 * Measured per league on 2026-08-28: Beta 1 Zombie League 41 available of 165,
 * KBFL 1, World Football League 0. The 32-team leagues really have rostered
 * essentially every ranked player.
 */

/** Enough to choose from; a longer list is noise the model will pad an answer with. */
const MAX_SHOWN = 15

/** The values table mixes 'WR' with 'Wide Receiver' in the same column. */
const POSITION_SHORT: Record<string, string> = {
  quarterback: 'QB',
  'running back': 'RB',
  'wide receiver': 'WR',
  'tight end': 'TE',
  kicker: 'K',
  defense: 'DEF',
}

function shortPosition(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return POSITION_SHORT[trimmed.toLowerCase()] ?? trimmed.toUpperCase()
}

/**
 * Below this the house set is not an answer, so the deeper source is tried.
 * Measured: World Football League yields 0 and KBFL yields 1 from our own
 * values, and a one-name pickup list reads as a broken feature.
 */
const MIN_USEFUL = 5

/**
 * ⚠ THE LIMITS TRAVEL WITH THE LIST, for the same reason the waiver-rules block
 * carries its own refusal: a bare ranked list reads as a complete pickup board,
 * and the model will then say "he is on waivers, put a claim in" about a player
 * whose availability we never checked. Shared so both the house-values path and
 * the FantasyCalc path carry them identically — a fallback that quietly drops
 * the caveats is worse than no fallback.
 */
function limitLines(basis: string, unrankedStarterSlots: string[]): string[] {
  const lines = [
    'LIMITS you must respect when using this block:',
    '1. "Unrostered" means on nobody\'s roster at our last sync. It does NOT mean "on waivers" or "free to add right now" — whether a player must clear waivers depends on the league\'s waiver rules and on when he was dropped, and we hold NO claim or drop timing at all.',
    '2. This covers only players the source ranks, so it lists the notable names rather than the full pool. Never say a player is unavailable just because he is missing here.',
    `3. These are ${basis} values — long-term asset worth, not a this-week start ranking. In a redraft league say so before recommending a rookie who is ranked here for years we have not played yet.`,
  ]

  /*
   * ⚠ NEITHER VALUE SOURCE THIS TOOL USES RANKS IDP OR KICKERS. FantasyCalc
   * publishes QB/RB/WR/TE (plus picks); our own published values are the same
   * four. KBFL starts seven defensive players and a kicker, so a manager whose
   * hole is at linebacker gets a list of receivers and no indication that the
   * position they asked about was never in scope — the same silent absence this
   * whole block exists to prevent.
   *
   * ⚠ BUT DO NOT SAY "NO SOURCE RANKS THEM". THAT IS FALSE, and the earlier
   * wording here said it: `lib/idp-projections/leagueIdpVorp.ts` and
   * `lib/idp-kicker-values.ts` build a VORP-based IDP board keyed on sleeperId,
   * already used by `decision-os/world/port`, `ai-tools-waiver` and
   * `idp/ai/idpChimmy`. It is simply not wired into THIS tool — it prices only
   * players already on a roster, so a pickup list needs its building blocks
   * (`loadIdpProjections`, `buildIdpValuations`) driven over the unrostered
   * pool instead. A capability we have and have not connected must not be
   * reported to the user as a capability we lack.
   *
   * ⚠ AND THE SCOPE IS SMALL: 10 of 94 NFL leagues carry real IDP roster slots,
   * 19 carry a kicker. An earlier note here claimed 70, from a grep that matched
   * the SCORING block — every Sleeper league ships `sack`/`int`/`ff` keys
   * whether or not it rosters defenders. `detectIdpLeague` in
   * `lib/idp-kicker-values.ts` is the strict predicate; prefer it over a grep.
   */
  if (unrankedStarterSlots.length > 0) {
    lines.push(
      `4. This league starts ${unrankedStarterSlots.join(', ')}, and the rankings behind this list do not cover those positions — it is quarterbacks, running backs, receivers and tight ends only. If the user asks about one of those positions, say plainly that this list does not rank it rather than offering an offensive player instead. Do NOT tell them AllFantasy cannot value the position at all.`,
    )
  }

  lines.push(
    'You may recommend from this list and compare these players against the user\'s roster. Do NOT state that anyone is claimable, and do NOT invent FAAB bids or waiver priority.',
  )
  return lines
}

/** Starting slots the league fills that neither value source can rank. */
const RANKED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'IR', 'TAXI'])

function unrankedStarterSlots(settings: unknown): string[] {
  const raw = (settings ?? null) as Record<string, unknown> | null
  const positions = raw?.roster_positions ?? raw?.rosterPositions
  if (!Array.isArray(positions)) return []

  const labels: Record<string, string> = {
    DL: 'defensive linemen',
    LB: 'linebackers',
    DB: 'defensive backs',
    IDP_FLEX: 'an IDP flex',
    DEF: 'a team defense',
    'D/ST': 'a team defense',
    K: 'a kicker',
  }
  const seen = new Set<string>()
  for (const p of positions) {
    const slot = String(p).toUpperCase()
    if (RANKED_POSITIONS.has(slot)) continue
    const label = labels[slot]
    if (label) seen.add(label)
  }
  return [...seen]
}

/**
 * The FantasyCalc board that matches THIS league, not a fixed default.
 *
 * ⚠ A FIXED DEFAULT PRODUCED A WRONG ANSWER IN PRODUCTION, not merely an
 * imprecise one. The first cut asked for a superflex (2QB), 12-team dynasty
 * board for every league. Asked "who can I pick up in KBFL?", Chimmy returned
 * Haynes King, Cole Payton and Jameis Winston — three quarterbacks in the top
 * three — for a league whose `roster_positions` start
 * ["QB","RB","WR","WR","TE","FLEX","FLEX","K",...]: ONE quarterback slot across
 * THIRTY-TWO teams, where a backup QB is close to worthless. The caveat that
 * shipped with it told the model to mention the skew and the model did not, so
 * the skew was reaching users as a recommendation.
 *
 * The settings were sitting in the league row the whole time —
 * `settings.roster_positions` is populated on 72 of 94 NFL leagues.
 *
 * Returns null when the league does not carry roster positions, so the caller
 * can keep the honest caveat for the 22 leagues that genuinely have no basis.
 */
function fantasyCalcSettingsForLeague(league: {
  isDynasty?: boolean | null
  scoring?: string | null
  settings?: unknown
  teamCount: number
}): FantasyCalcSettings | null {
  const raw = (league.settings ?? null) as Record<string, unknown> | null
  const positions = raw?.roster_positions ?? raw?.rosterPositions
  if (!Array.isArray(positions) || positions.length === 0) return null

  const slots = positions.map((p) => String(p).toUpperCase())
  /*
   * SUPER_FLEX is the usual spelling, but a league can also reach two starting
   * quarterbacks by simply listing QB twice — both are superflex to FantasyCalc.
   */
  const qbSlots = slots.filter((s) => s === 'QB').length
  const numQbs = slots.includes('SUPER_FLEX') || qbSlots >= 2 ? 2 : 1

  /*
   * ⚠ FantasyCalc PUBLISHES A FIXED LADDER OF LEAGUE SIZES. KBFL has 32 teams
   * and no such board exists, so it is clamped to the deepest one rather than
   * requesting a key that cannot be served. Deeper is the right direction: it
   * is the setting that most nearly reflects a thin waiver wire.
   */
  const SUPPORTED_TEAM_COUNTS = [8, 10, 12, 14, 16]
  const numTeams =
    SUPPORTED_TEAM_COUNTS.find((n) => n >= league.teamCount) ??
    SUPPORTED_TEAM_COUNTS[SUPPORTED_TEAM_COUNTS.length - 1]

  /* `scoring` is free text — "PPR TEP", "PPR Superflex TEP", "Half PPR". */
  const scoring = String(league.scoring ?? '').toLowerCase()
  const ppr = /half/.test(scoring) ? 0.5 : /ppr/.test(scoring) ? 1 : 0

  return { isDynasty: Boolean(league.isDynasty), numQbs, numTeams, ppr }
}

/**
 * The deeper ranked pool, for leagues that have rostered every name we value.
 *
 * ⚠ EXCLUDES DRAFT PICKS, WHICH IS NOT OPTIONAL. FantasyCalc ranks picks as
 * tradeable assets and they dominate the top of the list — the first four
 * unrostered entries in all three leagues measured were "2026 Pick 1.01", "2026
 * Pick 1.02", "2027 1st (Early)" and "2026 Pick 1.03". Offered as waiver
 * pickups those are nonsense, and confidently so. They carry `position: 'PICK'`
 * and a synthetic id (`DP_0_0`, `FP_2027_early_0`), so the position is the exact
 * discriminator — 78 of 474 entries — and beats parsing the name.
 *
 * ⚠ ITS ids ARE ALREADY THE ROSTER ID SPACE. `player.sleeperId` is populated on
 * all 474 entries, so no PlayerIdentityMap join is involved and none of that
 * table's known duplicate-group hazards apply here.
 */
async function deepPoolFromFantasyCalc(
  rostered: Set<string>,
  settings: FantasyCalcSettings,
): Promise<{ available: Array<{ name: string; position: string; overallRank: number }>; total: number } | null> {
  /*
   * Through the DB-first accessor, never the adapter: a cached key is a DB
   * read, and a miss self-populates through one fetch rather than serving
   * nulls. An uncached combination therefore costs latency, not correctness.
   */
  const players = await getFantasyCalcValuesDbFirst(settings).catch(() => [])

  const real = players.filter(
    (p) => String(p?.player?.position ?? '').toUpperCase() !== 'PICK' && p?.player?.sleeperId,
  )
  if (real.length === 0) return null

  const available = real
    .filter((p) => !rostered.has(String(p.player.sleeperId)))
    .sort((a, b) => a.overallRank - b.overallRank)
    .map((p) => ({
      name: p.player.name,
      position: String(p.player.position ?? '').toUpperCase(),
      overallRank: p.overallRank,
    }))

  return { available, total: real.length }
}

/** Roster player ids for EVERY team in the league, not just the reader's. */
async function rosteredPlayerIds(leagueId: string): Promise<Set<string>> {
  const rosters = await prisma.roster
    .findMany({ where: { leagueId }, select: { playerData: true } })
    .catch(() => [])

  const ids = new Set<string>()
  for (const r of rosters) {
    const data = r.playerData as { players?: unknown } | null
    const players = Array.isArray(data?.players) ? (data as { players: unknown[] }).players : []
    for (const p of players) {
      /*
       * ⚠ BOTH SHAPES REACH THE SAME ID SPACE. Some imports store bare ids and
       * some store objects; a missed entry here reports a ROSTERED player as
       * available, which is the one error this tool must never make.
       */
      if (typeof p === 'string' || typeof p === 'number') {
        ids.add(String(p))
      } else if (p && typeof p === 'object') {
        const o = p as Record<string, unknown>
        const id = o.playerId ?? o.player_id ?? o.id
        if (typeof id === 'string' || typeof id === 'number') ids.add(String(id))
      }
    }
  }
  return ids
}

/**
 * Prose listing the highest-valued unrostered players, or a sentence saying why
 * there are none. Never throws — an exception here aborts a live conversation.
 */
export async function buildAvailablePlayersContext(
  leagueId: string,
  userId: string,
): Promise<string> {
  if (!leagueId || !userId) {
    return 'No league is selected, so there is no player pool to read. Ask the user which league; do not name anyone as available.'
  }

  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: {
        name: true,
        sport: true,
        isDynasty: true,
        scoring: true,
        settings: true,
        _count: { select: { teams: true } },
      },
    })
    .catch(() => null)

  if (!league) {
    return 'That league could not be read, so its available players are unknown. Say so; do not name anyone.'
  }

  const leagueName = league.name ?? 'this league'

  /*
   * ⚠ NFL ONLY. The values table holds NFL assets; running this for an NBA or
   * MLB league would subtract NFL rosters from NFL values and present the
   * result as that league's waiver wire.
   */
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') {
    return `Player values are only published for NFL, so there is no available-player ranking for "${leagueName}" (${league.sport}). Say that plainly; do not name anyone.`
  }

  /* Starting slots this league fills that no source we hold can rank. */
  const unranked = unrankedStarterSlots(league.settings)

  const rostered = await rosteredPlayerIds(leagueId)

  /*
   * ⚠ NO ROSTERS MEANS NO ANSWER, NOT AN EMPTY SUBTRACTION. With an empty set
   * every ranked player would come back "available" — a confident, complete,
   * entirely wrong pickup board.
   */
  if (rostered.size === 0) {
    return [
      `No rosters are stored for "${leagueName}", so we cannot tell who is taken and who is free.`,
      'Everyone would look available, which would be wrong. Say the rosters have not synced;',
      'do NOT name any players as available.',
    ].join(' ')
  }

  const valued = await prisma.allFantasyMarketPlayerValue
    .findMany({
      where: { published: true, sport: 'NFL' },
      select: { playerId: true, playerName: true, position: true, marketValue: true, leagueConcept: true },
      orderBy: { marketValue: 'desc' },
    })
    .catch(() => [])

  if (valued.length === 0) {
    return [
      'No published player values are on file, so unrostered players cannot be ranked.',
      'Say we cannot rank the waiver wire right now; do not name anyone.',
    ].join(' ')
  }

  /*
   * ⚠ ONE PLAYER CAN HOLD SEVERAL ROWS. The unique key is
   * [sport, leagueConcept, playerId], so a player valued under both redraft and
   * dynasty appears twice. Only `redraft` is populated today, so this changes
   * nothing yet and prevents a duplicated pickup list the day it does.
   * Rows arrive highest-value first, so the first one seen is the one kept.
   */
  /*
   * ⚠ EVERY PUBLISHED ROW IS `dynasty` TODAY. A dynasty value is what a player
   * is worth for years, and offering that as a pickup ranking in a REDRAFT
   * league promotes rookies over producers — so the basis is named in the block
   * rather than assumed. Read from the rows so it stays true when redraft values
   * ship rather than becoming a comment that lies.
   */
  const concepts =
    [...new Set(valued.map((v) => String(v.leagueConcept ?? '').trim()).filter(Boolean))].join('/') ||
    'market'

  const seen = new Set<string>()
  const available = valued.filter((v) => {
    const id = String(v.playerId)
    if (rostered.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })

  const lines: string[] = []

  /*
   * ⚠ THE HOUSE SET RUNS OUT EXACTLY WHERE THE QUESTION MATTERS MOST. Measured
   * 2026-08-28: our 165 published values leave KBFL (32 teams) with ONE
   * available player and World Football League with NONE, because a deep league
   * has rostered every notable name. "Our rankings are exhausted" is true and
   * useless. FantasyCalc's cached set is 474 deep and covers the tail, and after
   * excluding picks it leaves KBFL 14 and WFL 19 — real answers.
   *
   * ⚠ ONE SCALE PER ANSWER, NEVER INTERLEAVED. An AllFantasy market value and a
   * FantasyCalc value are different scales; ordering one list by both would
   * misrank silently. So the house set is used whenever it yields a usable
   * answer, and otherwise it is replaced wholesale — never blended — and the
   * block names which source it used.
   */
  /*
   * ⚠ A CONCEPT MISMATCH IS A REASON TO SWITCH, NOT A REASON TO CAVEAT. Every
   * one of our 165 published rows is `leagueConcept: 'dynasty'`, and Beta 1
   * Zombie League is `isDynasty: false` — a redraft league being handed
   * long-term asset values. The block already carried a sentence telling the
   * model to mention that; the KBFL answer proved a caveat the model may drop
   * is not a fix. FantasyCalc publishes a redraft board, so the honest move is
   * to ask for the one that matches.
   *
   * Depth stays a reason to switch too — this widens when we fall back, it does
   * not replace the depth rule.
   */
  const houseIsDynasty = concepts.includes('dynasty')
  const conceptMismatch =
    concepts !== 'market' && Boolean(league.isDynasty) !== houseIsDynasty

  if (available.length < MIN_USEFUL || conceptMismatch) {
    const derived = fantasyCalcSettingsForLeague({
      isDynasty: league.isDynasty,
      scoring: league.scoring,
      settings: league.settings,
      teamCount: league._count?.teams ?? 12,
    })
    /* No roster positions on file means no basis to derive one — say so below. */
    const fcSettings = derived ?? { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 }
    const deep = await deepPoolFromFantasyCalc(rostered, fcSettings)
    /*
     * On a concept mismatch any non-empty matching board beats a mismatched one,
     * so depth is not required — but an EMPTY board never is, or the switch
     * would trade a wrong-concept answer for no answer.
     */
    const worthSwitching =
      deep && (deep.available.length > available.length || (conceptMismatch && deep.available.length > 0))
    if (deep && worthSwitching) {
      const shown = deep.available.slice(0, MAX_SHOWN).map((p) => `${p.name} (${p.position}, rank #${p.overallRank})`)
      const more =
        deep.available.length > shown.length
          ? ` (+${deep.available.length - shown.length} more ranked players available)`
          : ''
      lines.push(
        `UNROSTERED PLAYERS in "${leagueName}", best FantasyCalc dynasty rank first:`,
        `${shown.join('; ')}${more}`,
        `That is ${deep.available.length} of the ${deep.total} ranked players FantasyCalc covers.`,
        conceptMismatch
          ? `AllFantasy publishes ${concepts} values only, and this is a ${league.isDynasty ? 'dynasty' : 'redraft'} league, so this list uses FantasyCalc's matching board instead of a mismatched house value. Those are two different scales — do NOT compare a rank here against an AllFantasy value from another answer.`
          : `Only ${available.length} of the ${valued.length} players AllFantasy publishes its own value for are unrostered here, so this list uses FantasyCalc's deeper set instead. Those are two different scales — do NOT compare a rank here against an AllFantasy value from another answer.`,
        /*
         * ⚠ SAY WHICH BOARD THIS IS. The QB ladder moves hardest between a 1QB
         * and a superflex league, so the setting that produced the ranking has
         * to be visible rather than implied — and when it could not be derived,
         * the model must be told the ranking is not this league's.
         */
        derived
          ? `These ranks are FantasyCalc's ${derived.numQbs === 2 ? 'superflex (2QB)' : '1QB'}, ${derived.numTeams}-team, ${derived.ppr === 1 ? 'full PPR' : derived.ppr === 0.5 ? 'half PPR' : 'non-PPR'} ${derived.isDynasty ? 'dynasty' : 'redraft'} board, matched to this league's own roster settings.`
          : 'This league has no roster positions on file, so these ranks come from a SUPERFLEX (2QB), 12-team dynasty baseline rather than its own settings. If it is a 1QB league, quarterbacks are ranked higher here than they are worth to them — say so rather than recommending a quarterback off this list alone.',
      )
      lines.push(...limitLines(fcSettings.isDynasty ? 'FantasyCalc dynasty' : 'FantasyCalc redraft', unranked))
      return lines.join('\n')
    }
  }

  if (available.length === 0) {
    lines.push(
      `Every one of the ${valued.length} players we publish a value for is already rostered in "${leagueName}".`,
      'This means our RANKED set is exhausted — it does NOT mean the waiver wire is empty.',
      'Say that distinction plainly: there are unranked players available that we hold no value for.',
    )
  } else {
    const shown = available.slice(0, MAX_SHOWN).map((v) => {
      const pos = shortPosition(v.position)
      /* `playerName` is nullable; an unnamed row must not print as "null". */
      const name = v.playerName?.trim() || `player ${v.playerId}`
      const label = pos ? `${name} (${pos})` : name
      return `${label} — value ${Math.round(Number(v.marketValue))}`
    })
    const more =
      available.length > shown.length
        ? ` (+${available.length - shown.length} more ranked players available)`
        : ''
    lines.push(
      `UNROSTERED PLAYERS in "${leagueName}", highest AllFantasy market value first:`,
      `${shown.join('; ')}${more}`,
      `That is ${available.length} of the ${valued.length} players we publish a value for.`,
    )
  }

  lines.push(...limitLines(concepts, unranked))

  return lines.join('\n')
}
