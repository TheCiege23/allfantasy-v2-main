/**
 * 28a — one bracket shell, every sport.
 *
 * ⚠ THREE VARIABLES CHANGE PER SPORT. NOTHING ELSE. Team count, round count, and
 * bye structure. That is the whole contract, and it is an engineering constraint
 * rather than a description: a new sport is a new entry in `SPORT_SHELLS`, not a
 * new bracket component. If a sport cannot be expressed as (teams, rounds, byes)
 * then the shell needs extending for every sport at once — never a bespoke
 * bracket for one.
 *
 * ⚠ ROUND VALUES AND SERIES FORMATS ARE REAL COMPETITION RULES, NOT DECORATION.
 * MLB's Wild Card really is a best-of-three and the Division Series really is a
 * best-of-five. A wrong `bestOf` here is a wrong scoring rule in a pool people
 * entered, so check the sport's actual format before editing.
 *
 * ⚠ BYES ARE OPEN UNTIL THE ROUND BELOW THEM RESOLVES. A seed with a bye has no
 * opponent yet, and the bracket must render that slot as unknown rather than
 * pre-filling it with the higher seed of a series nobody has played. See
 * `byeSeeds` and how the screen renders an unresolved slot.
 */

export type SportKey = 'mlb' | 'nba' | 'nhl' | 'nfl' | 'world-cup' | 'ncaa'

export type BracketRound = {
  id: string
  label: string
  /** Points for calling this round right. */
  points: number
  /** Best-of length, or null for a single game / single leg. */
  bestOf: number | null
}

export type SportShell = {
  key: SportKey
  label: string
  /** Variable 1 — how many teams enter the bracket. */
  teamCount: number
  /** Variable 2 — the rounds, in order from first played to final. */
  rounds: BracketRound[]
  /**
   * Variable 3 — which seeds sit out the first round. Empty means everyone
   * plays round one.
   */
  byeSeeds: number[]
  /** The two halves of the draw. Mirrored left and right around the final. */
  sides: [string, string]
  /**
   * Bonus for calling the exact length of the final series, and the lengths a
   * player can pick from. Null when the sport's final is a single game.
   */
  finalLength: { bonus: number; options: number[] } | null
  /** False for sports whose bracket is not built yet — the switcher says so. */
  available: boolean
  /**
   * How each side is recognised in `SportsTeam.conference`.
   *
   * ⚠ SERVER-ONLY. A RegExp cannot cross the server→client boundary — React
   * throws "Only plain objects can be passed to Client Components". Strip it
   * with `toClientShell` before handing a shell to a client component; that is
   * why `ClientSportShell` exists rather than the screen taking `SportShell`.
   */
  conferenceMatch: [RegExp, RegExp] | null
}

/**
 * The shell as a client component may receive it: everything except the
 * RegExp pair, which is a server-side matching detail no screen renders.
 */
export type ClientSportShell = Omit<SportShell, 'conferenceMatch'>

export function toClientShell(shell: SportShell): ClientSportShell {
  const { conferenceMatch: _serverOnly, ...rest } = shell
  return rest
}

export const SPORT_SHELLS: Record<SportKey, SportShell> = {
  mlb: {
    key: 'mlb',
    label: 'MLB',
    // 12: six per league — three division winners and three wild cards.
    teamCount: 12,
    rounds: [
      { id: 'wc', label: 'Wild Card', points: 5, bestOf: 3 },
      { id: 'ds', label: 'Division', points: 10, bestOf: 5 },
      { id: 'cs', label: 'Championship', points: 18, bestOf: 7 },
      { id: 'ws', label: 'World Series', points: 30, bestOf: 7 },
    ],
    // The top two seeds in each league sit out the Wild Card round.
    byeSeeds: [1, 2],
    sides: ['American League', 'National League'],
    finalLength: { bonus: 5, options: [4, 5, 6, 7] },
    available: true,
    conferenceMatch: [/^American League/i, /^National League/i],
  },
  nba: {
    key: 'nba',
    label: 'NBA',
    teamCount: 16,
    rounds: [
      { id: 'r1', label: 'First round', points: 5, bestOf: 7 },
      { id: 'sf', label: 'Conf. semis', points: 10, bestOf: 7 },
      { id: 'cf', label: 'Conf. finals', points: 18, bestOf: 7 },
      { id: 'f', label: 'Finals', points: 30, bestOf: 7 },
    ],
    byeSeeds: [],
    sides: ['Eastern Conference', 'Western Conference'],
    finalLength: { bonus: 5, options: [4, 5, 6, 7] },
    available: false,
    conferenceMatch: [/^Eastern/i, /^Western/i],
  },
  nhl: {
    key: 'nhl',
    label: 'NHL',
    teamCount: 16,
    rounds: [
      { id: 'r1', label: 'First round', points: 5, bestOf: 7 },
      { id: 'r2', label: 'Second round', points: 10, bestOf: 7 },
      { id: 'cf', label: 'Conf. finals', points: 18, bestOf: 7 },
      { id: 'sc', label: 'Stanley Cup', points: 30, bestOf: 7 },
    ],
    byeSeeds: [],
    sides: ['Eastern Conference', 'Western Conference'],
    finalLength: { bonus: 5, options: [4, 5, 6, 7] },
    available: false,
    conferenceMatch: [/^Eastern/i, /^Western/i],
  },
  nfl: {
    key: 'nfl',
    label: 'NFL',
    teamCount: 14,
    rounds: [
      { id: 'wc', label: 'Wild Card', points: 5, bestOf: null },
      { id: 'div', label: 'Divisional', points: 10, bestOf: null },
      { id: 'cc', label: 'Conf. championship', points: 18, bestOf: null },
      { id: 'sb', label: 'Super Bowl', points: 30, bestOf: null },
    ],
    // One bye per conference since 2020.
    byeSeeds: [1],
    sides: ['AFC', 'NFC'],
    // A single game has no length to call.
    finalLength: null,
    available: false,
    conferenceMatch: [/^AFC/i, /^NFC/i],
  },
  'world-cup': {
    key: 'world-cup',
    label: 'World Cup',
    teamCount: 32,
    rounds: [
      { id: 'r32', label: 'Round of 32', points: 5, bestOf: null },
      { id: 'r16', label: 'Round of 16', points: 10, bestOf: null },
      { id: 'qf', label: 'Quarter-final', points: 14, bestOf: null },
      { id: 'sf', label: 'Semi-final', points: 18, bestOf: null },
      { id: 'f', label: 'Final', points: 30, bestOf: null },
    ],
    byeSeeds: [],
    sides: ['Left half', 'Right half'],
    finalLength: null,
    available: false,
    conferenceMatch: null,
  },
  ncaa: {
    key: 'ncaa',
    label: 'NCAA',
    teamCount: 64,
    rounds: [
      { id: 'r64', label: 'Round of 64', points: 2, bestOf: null },
      { id: 'r32', label: 'Round of 32', points: 4, bestOf: null },
      { id: 's16', label: 'Sweet 16', points: 8, bestOf: null },
      { id: 'e8', label: 'Elite 8', points: 14, bestOf: null },
      { id: 'f4', label: 'Final Four', points: 20, bestOf: null },
      { id: 'ch', label: 'Championship', points: 30, bestOf: null },
    ],
    byeSeeds: [],
    sides: ['Left half', 'Right half'],
    finalLength: null,
    available: false,
    conferenceMatch: null,
  },
}

export const SPORT_ORDER: SportKey[] = ['mlb', 'nba', 'nhl', 'nfl', 'world-cup', 'ncaa']

export function resolveSport(raw: string | null | undefined): SportKey {
  const key = (raw ?? '').toLowerCase()
  return (SPORT_ORDER as string[]).includes(key) ? (key as SportKey) : 'mlb'
}

/** Seeds on one side of the draw, in seed order. */
export function seedsPerSide(shell: ClientSportShell): number {
  return shell.teamCount / 2
}

/**
 * Which seeds meet in the first round, per side, in bracket order.
 *
 * For MLB: seeds 1 and 2 bye; 3v6 and 4v5 play the Wild Card round. Returned
 * outward-in so the screen can render them from the outside of the bracket
 * towards the centre without re-deriving the order.
 */
export function firstRoundPairs(shell: ClientSportShell): Array<[number, number]> {
  const per = seedsPerSide(shell)
  const playing: number[] = []
  for (let seed = 1; seed <= per; seed += 1) {
    if (!shell.byeSeeds.includes(seed)) playing.push(seed)
  }
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < Math.floor(playing.length / 2); i += 1) {
    pairs.push([playing[i], playing[playing.length - 1 - i]])
  }
  return pairs
}

/* ── Scoring ─────────────────────────────────────────────────────────────── */

export type BracketPick = {
  roundId: string
  /** The team the entrant called to advance. */
  teamId: string
}

export type BracketResult = {
  roundId: string
  /** The team that actually advanced, or null while the round is unresolved. */
  teamId: string | null
}

export type ScoreBreakdown = {
  earned: number
  /** Points still reachable — rounds not yet resolved. */
  remaining: number
  correct: number
  decided: number
  lengthBonusEarned: number
}

/**
 * Score an entry.
 *
 * ⚠ AN UNRESOLVED ROUND IS NOT A MISS. It contributes to `remaining`, never to a
 * wrong answer — a bracket that scores unplayed rounds as zero tells an entrant
 * they are out of it in October when they are not.
 *
 * ⚠ THE LENGTH BONUS IS SCORED AGAINST THE ACTUAL SERIES LENGTH, AND ONLY WHEN
 * THE FINAL IS DECIDED. `actualFinalLength` is null until then, and a null must
 * never be read as "they called it wrong".
 */
export function scoreBracket(
  shell: ClientSportShell,
  picks: BracketPick[],
  results: BracketResult[],
  finalLengthPick: number | null,
  actualFinalLength: number | null,
): ScoreBreakdown {
  const pickBy = new Map(picks.map((p) => [p.roundId, p.teamId]))
  const resultBy = new Map(results.map((r) => [r.roundId, r.teamId]))

  let earned = 0
  let remaining = 0
  let correct = 0
  let decided = 0

  for (const round of shell.rounds) {
    const actual = resultBy.get(round.id) ?? null
    if (actual === null) {
      remaining += round.points
      continue
    }
    decided += 1
    if (pickBy.get(round.id) === actual) {
      earned += round.points
      correct += 1
    }
  }

  let lengthBonusEarned = 0
  if (shell.finalLength) {
    if (actualFinalLength === null) {
      remaining += shell.finalLength.bonus
    } else if (finalLengthPick !== null && finalLengthPick === actualFinalLength) {
      lengthBonusEarned = shell.finalLength.bonus
      earned += lengthBonusEarned
    }
  }

  return { earned, remaining, correct, decided, lengthBonusEarned }
}
