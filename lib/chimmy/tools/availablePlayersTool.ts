import 'server-only'

import { prisma } from '@/lib/prisma'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'

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
function limitLines(basis: string): string[] {
  return [
    'LIMITS you must respect when using this block:',
    '1. "Unrostered" means on nobody\'s roster at our last sync. It does NOT mean "on waivers" or "free to add right now" — whether a player must clear waivers depends on the league\'s waiver rules and on when he was dropped, and we hold NO claim or drop timing at all.',
    '2. This covers only players the source ranks, so it lists the notable names rather than the full pool. Never say a player is unavailable just because he is missing here.',
    `3. These are ${basis} values — long-term asset worth, not a this-week start ranking. In a redraft league say so before recommending a rookie who is ranked here for years we have not played yet.`,
    'You may recommend from this list and compare these players against the user\'s roster. Do NOT state that anyone is claimable, and do NOT invent FAAB bids or waiver priority.',
  ]
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
): Promise<{ available: Array<{ name: string; position: string; overallRank: number }>; total: number } | null> {
  /*
   * The repo-wide default, and one of the keys already cached — so this is
   * normally a DB read. A miss self-populates through one fetch rather than
   * serving nulls. Note it is a SUPERFLEX (2QB) baseline, which is why the
   * block says the values are not tuned to this league.
   */
  const players = await getFantasyCalcValuesDbFirst({
    isDynasty: true,
    numQbs: 2,
    numTeams: 12,
    ppr: 1,
  }).catch(() => [])

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
    .findUnique({ where: { id: leagueId }, select: { name: true, sport: true } })
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
  if (available.length < MIN_USEFUL) {
    const deep = await deepPoolFromFantasyCalc(rostered)
    if (deep && deep.available.length > available.length) {
      const shown = deep.available.slice(0, MAX_SHOWN).map((p) => `${p.name} (${p.position}, rank #${p.overallRank})`)
      const more =
        deep.available.length > shown.length
          ? ` (+${deep.available.length - shown.length} more ranked players available)`
          : ''
      lines.push(
        `UNROSTERED PLAYERS in "${leagueName}", best FantasyCalc dynasty rank first:`,
        `${shown.join('; ')}${more}`,
        `That is ${deep.available.length} of the ${deep.total} ranked players FantasyCalc covers.`,
        `Only ${available.length} of the ${valued.length} players AllFantasy publishes its own value for are unrostered here, so this list uses FantasyCalc's deeper set instead. Those are two different scales — do NOT compare a rank here against an AllFantasy value from another answer.`,
      )
      lines.push(...limitLines('FantasyCalc dynasty'))
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

  lines.push(...limitLines(concepts))

  return lines.join('\n')
}
