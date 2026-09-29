import { normalizePosition } from './positionNormalization'
import { canFillSlot, isStartableIn } from './slotEligibility'

/**
 * Slot eligibility for EVERY sport, keyed on the sport first.
 *
 * ⚠ `slotEligibility.ts` IS FOOTBALL'S TABLE, AND IT IS RIGHT FOR FOOTBALL. It answers no other
 * sport: `PG`, `UTIL`, `LW`, `SP` are not keys in it, so every basketball, hockey and baseball
 * player "cannot fill any slot" and a board built on it names nobody — silently, because an empty
 * list reads like a quiet wire. Football (NFL and NCAAF) is DELEGATED to it unchanged here, so no
 * football answer moves.
 *
 * ⚠ SPORT FIRST, BECAUSE THE SAME SLOT NAME MEANS DIFFERENT PEOPLE. `C` is a centre in basketball
 * and hockey and a catcher in baseball; `G` is a guard in basketball and a goalie in hockey; `D`
 * and `F` differ likewise. One table across sports would seat a catcher at centre.
 *
 * ⚠ UNKNOWN IS NOT ELIGIBLE. An unrecognised slot accepts nobody and an unrecognised position fits
 * nothing — the same refusal the football table makes, for the same reason: inventing eligibility
 * is how the first replacement finder offered a running back for a quarterback slot.
 */

type Table = { accepts: Record<string, readonly string[]>; aliases: Record<string, string> }

const BASKETBALL_ALL = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'] as const
const BASKETBALL: Table = {
  accepts: {
    PG: ['PG', 'G'],
    SG: ['SG', 'G'],
    SF: ['SF', 'F'],
    PF: ['PF', 'F'],
    C: ['C'],
    G: ['PG', 'SG', 'G'],
    F: ['SF', 'PF', 'F'],
    'G/F': ['PG', 'SG', 'G', 'SF', 'PF', 'F'],
    'F/C': ['SF', 'PF', 'F', 'C'],
    UTIL: BASKETBALL_ALL,
    UT: BASKETBALL_ALL,
    FLEX: BASKETBALL_ALL,
  },
  aliases: {
    'POINT GUARD': 'PG',
    'SHOOTING GUARD': 'SG',
    'SMALL FORWARD': 'SF',
    'POWER FORWARD': 'PF',
    GUARD: 'G',
    FORWARD: 'F',
    // `normalizePosition` turns "forward" into soccer's FW; in basketball it is F.
    FW: 'F',
    CENTER: 'C',
    CENTRE: 'C',
  },
}

const HOCKEY_SKATERS = ['C', 'LW', 'RW', 'W', 'F', 'D'] as const
const HOCKEY: Table = {
  accepts: {
    C: ['C'],
    LW: ['LW'],
    RW: ['RW'],
    W: ['LW', 'RW', 'W'],
    F: ['C', 'LW', 'RW', 'W', 'F'],
    D: ['D'],
    G: ['G'],
    UTIL: HOCKEY_SKATERS,
    UT: HOCKEY_SKATERS,
    SKT: HOCKEY_SKATERS,
  },
  aliases: {
    CENTER: 'C',
    CENTRE: 'C',
    'LEFT WING': 'LW',
    'RIGHT WING': 'RW',
    WING: 'W',
    WINGER: 'W',
    FORWARD: 'F',
    FW: 'F',
    DEFENSE: 'D',
    DEFENCE: 'D',
    DEFENSEMAN: 'D',
    DEFENCEMAN: 'D',
    DEFENDER: 'D',
    DF: 'D',
    GOALIE: 'G',
    GOALTENDER: 'G',
    GOALKEEPER: 'G',
    GK: 'G',
  },
}

const BASEBALL_HITTERS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'LF', 'CF', 'RF', 'DH'] as const
const BASEBALL: Table = {
  accepts: {
    C: ['C'],
    '1B': ['1B'],
    '2B': ['2B'],
    '3B': ['3B'],
    SS: ['SS'],
    OF: ['OF', 'LF', 'CF', 'RF'],
    LF: ['LF', 'OF'],
    CF: ['CF', 'OF'],
    RF: ['RF', 'OF'],
    CI: ['1B', '3B'],
    MI: ['2B', 'SS'],
    IF: ['1B', '2B', '3B', 'SS'],
    INF: ['1B', '2B', '3B', 'SS'],
    DH: BASEBALL_HITTERS,
    UTIL: BASEBALL_HITTERS,
    UT: BASEBALL_HITTERS,
    SP: ['SP', 'P'],
    RP: ['RP', 'P'],
    P: ['SP', 'RP', 'P'],
  },
  aliases: {
    CATCHER: 'C',
    'FIRST BASE': '1B',
    'FIRST BASEMAN': '1B',
    'SECOND BASE': '2B',
    'SECOND BASEMAN': '2B',
    'THIRD BASE': '3B',
    'THIRD BASEMAN': '3B',
    SHORTSTOP: 'SS',
    OUTFIELD: 'OF',
    OUTFIELDER: 'OF',
    'LEFT FIELD': 'LF',
    'CENTER FIELD': 'CF',
    'RIGHT FIELD': 'RF',
    'DESIGNATED HITTER': 'DH',
    PITCHER: 'P',
    'STARTING PITCHER': 'SP',
    'RELIEF PITCHER': 'RP',
    'RELIEVER': 'RP',
  },
}

const TABLES: Record<string, Table> = {
  NBA: BASKETBALL,
  NCAAB: BASKETBALL,
  NHL: HOCKEY,
  MLB: BASEBALL,
}

function isFootball(sport: string): boolean {
  return sport === 'NFL' || sport === 'NCAAF'
}

function sportOf(raw: string | null | undefined): string {
  return String(raw ?? 'NFL').trim().toUpperCase() || 'NFL'
}

/**
 * A player's positions in this sport's vocabulary. Providers write dual eligibility as one string
 * ("G-F", "F/C", "SS,2B"), so it is split, and each part is read through the sport's own aliases.
 */
export function positionsForSport(sport: string, raw: string | null): string[] {
  const table = TABLES[sportOf(sport)]
  if (!raw) return []
  const whole = raw.trim().toUpperCase()
  if (!table) return whole ? [normalizePosition(raw)] : []
  if (table.aliases[whole]) return [table.aliases[whole]]
  return [
    ...new Set(
      whole
        .split(/[-/,|]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => table.aliases[p] ?? normalizePosition(p))
        .map((p) => table.aliases[p] ?? p),
    ),
  ]
}

/** Can a player at this position fill this slot, in this sport? */
export function canFillSlotForSport(sport: string | null | undefined, slot: string, position: string | null): boolean {
  const s = sportOf(sport)
  if (isFootball(s)) return canFillSlot(slot, position)
  const table = TABLES[s]
  if (!table) return false
  const accepts = table.accepts[slot.trim().toUpperCase()]
  if (!accepts) return false
  return positionsForSport(s, position).some((p) => accepts.includes(p))
}

/**
 * Could this player start in this league at all? With the league's slots, he must fit one; without
 * them, he must hold a position some slot in his sport accepts.
 */
export function isStartableInSport(
  sport: string | null | undefined,
  slots: readonly string[] | null,
  position: string | null,
): boolean {
  const s = sportOf(sport)
  if (isFootball(s)) return isStartableIn(slots ? [...slots] : null, position)
  const table = TABLES[s]
  if (!table) return false
  if (slots && slots.length > 0) return slots.some((slot) => canFillSlotForSport(s, slot, position))
  const known = new Set(Object.values(table.accepts).flat())
  return positionsForSport(s, position).some((p) => known.has(p))
}
