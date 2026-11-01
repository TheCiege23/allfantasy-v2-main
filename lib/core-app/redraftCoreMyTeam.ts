/**
 * Redraft /core batch B2 (My team, Your week, Defense Hub): the pure mappings those screens use. The
 * styling that reads them lives in components/core-app/af-core-redraft-myteam.css and applies ONLY under
 * the shell's redraft stamp (`.af-core.af-shell[data-format=redraft]`, lib/core-app/coreShellRedraftIdentity.ts),
 * so every value here is safe to emit on every league: outside the stamp nothing reads it.
 *
 * ⚠ EVERY FUNCTION RETURNS `null` WHEN THE DATA DOES NOT SAY. The screens drop an element on `null`;
 * they never fill one in. An off-day badge needs a slate that was actually read, a "3rd by record" needs
 * a record for every team in the week, a day chip needs the day the loader actually priced.
 *
 * ⚠ THE POSITION TONES DUPLICATE `redraftPositionTone` IN lib/league-media/redraftScreens.ts (open PR
 * #3101, the /league native screens), which is not on this branch's base. The tables are copied value for
 * value so a C / G / DEF chip means the same job on both surfaces; whichever lands second should import
 * the other's table rather than keep two (__tests__/core-app/redraftCoreMyTeam.test.ts pins the values).
 */
import { redraftSportTheme, type RedraftSportTheme } from '@/lib/league-media/redraftIdentity'

/* ── Position chips ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The chip colour a slot or position takes. A colour, not a position name, because the same letters
 * mean different jobs by sport: `C` is a centre (NBA, NHL) or a catcher (MLB), `G` a guard (NBA) or a
 * goalie (NHL), `SF` a small forward (NBA) or a superflex slot (NFL), `DEF` a team defence (NFL) or a
 * defender (soccer). The football-only `posGroup` in MyTeam.tsx reads soccer's `DEF` as a team defence
 * and every NBA / NHL / MLB label as "other" — which is why the redraft chip carries its own attribute.
 */
export type RedraftPosTone = 'red' | 'green' | 'blue' | 'amber' | 'violet' | 'slate' | 'flex' | 'bench' | 'ir'

const COMMON: Record<string, RedraftPosTone> = { BN: 'bench', BENCH: 'bench', TX: 'bench', TAXI: 'bench', IR: 'ir', IL: 'ir', RES: 'ir' }

const BY_SPORT: Record<RedraftSportTheme, Record<string, RedraftPosTone>> = {
  nfl: { QB: 'red', RB: 'green', WR: 'blue', TE: 'amber', K: 'violet', PK: 'violet', DEF: 'slate', DST: 'slate', 'D/ST': 'slate', FLEX: 'flex', FLX: 'flex', 'W/R/T': 'flex', WRT: 'flex', SF: 'flex', SUPER_FLEX: 'flex', OP: 'flex' },
  ncaaf: { QB: 'red', RB: 'green', WR: 'blue', TE: 'amber', K: 'violet', PK: 'violet', FLEX: 'flex', FLX: 'flex', 'W/R/T': 'flex', SF: 'flex', SUPER_FLEX: 'flex' },
  // Guards blue, forwards green, centres amber.
  nba: { PG: 'blue', SG: 'blue', G: 'blue', SF: 'green', PF: 'green', F: 'green', C: 'amber', UTIL: 'flex', UT: 'flex' },
  ncaab: { PG: 'blue', SG: 'blue', G: 'blue', SF: 'green', PF: 'green', F: 'green', C: 'amber', UTIL: 'flex', UT: 'flex' },
  // Centres blue, wingers green, defence amber, goalies red.
  nhl: { C: 'blue', LW: 'green', RW: 'green', W: 'green', F: 'green', D: 'amber', G: 'red', UTIL: 'flex', SKT: 'flex' },
  // Catcher violet, infield green, outfield blue, starters red, relievers amber.
  mlb: { C: 'violet', '1B': 'green', '2B': 'green', '3B': 'green', SS: 'green', IF: 'green', CI: 'green', MI: 'green', OF: 'blue', LF: 'blue', CF: 'blue', RF: 'blue', SP: 'red', RP: 'amber', P: 'red', DH: 'flex', UTIL: 'flex' },
  // Keeper amber, defenders blue, midfielders green, forwards red.
  soccer: { GK: 'amber', GKP: 'amber', DEF: 'blue', D: 'blue', MID: 'green', M: 'green', FWD: 'red', F: 'red', ST: 'red' },
}

/** The chip tone for a slot or position label in a league's sport; null when that sport does not use the label. */
export function redraftCorePosTone(sport: string | null | undefined, label: string | null | undefined): RedraftPosTone | null {
  const theme = redraftSportTheme(sport)
  const p = String(label ?? '').trim().toUpperCase()
  if (!theme || !p) return null
  return COMMON[p] ?? BY_SPORT[theme][p] ?? null
}

/* ── The lineup's period: daily vs weekly ───────────────────────────────────────────────────────── */

export type LineupPeriod = { kind: 'day' | 'week'; day: string | null; week: number | null }

/**
 * The chip naming the lineup's period — "Today · Thu, Oct 30" for a daily-lineup league, "Week 5 slate"
 * for a weekly NBA / NHL / MLB one. From the period the daily-sport outlook actually priced
 * (lib/projections/dailySportOutlook.ts `period`), never from the clock here: a chip that guessed the day
 * would be wrong precisely when the server and the browser sit either side of midnight Eastern.
 *
 * ⚠ ONE DAY, NOT A PICKER. /core's My team loader prices one period, and no other day's slate reaches
 * the page, so a strip of seven tappable days would offer six that show nothing. Null when no period was
 * priced (every football league, and a daily sport whose outlook failed).
 */
export function lineupPeriodLabel(period: LineupPeriod | null | undefined, locale = 'en-US'): string | null {
  if (!period) return null
  if (period.kind === 'day') {
    if (!period.day || !/^\d{4}-\d{2}-\d{2}$/.test(period.day)) return null
    // Noon UTC, formatted in UTC: the day key is an Eastern calendar day and must not shift a zone.
    const at = new Date(`${period.day}T12:00:00Z`)
    if (Number.isNaN(at.getTime())) return null
    return at.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return period.week != null && Number.isInteger(period.week) && period.week > 0 ? String(period.week) : null
}

/**
 * The badge for a starter whose team has no game in the period: `day` → "Off day" (daily-lineup league,
 * no game today), `week` → "No games" (a weekly league whose team is idle all week). Null when the
 * outlook did not price the period for him — an unread slate is not an off day.
 */
export function noGameBadge(kind: 'day' | 'week' | null | undefined): 'offday' | 'idle' | null {
  if (kind === 'day') return 'offday'
  if (kind === 'week') return 'idle'
  return null
}

/* ── Your week: the season race ─────────────────────────────────────────────────────────────────── */

export type SeasonRaceRank = { rank: number; of: number; tied: boolean }

/**
 * Your place in the league BY RECORD this season, from the week board's own scored records.
 *
 * ⚠ NOT THE STANDINGS. A real table breaks ties on points for, which this board does not carry — so a
 * tie is said as one ("T-3rd") rather than broken by guesswork, and the label says "by record".
 *
 * ⚠ ONLY WHEN EVERY TEAM IN THE WEEK HAS A RECORD. `records` omits a roster with no scored game (the
 * board's own rule: absent is "has not played", not 0-0). Ranking among the teams that happen to have
 * one would print "1st of 4" in a 12-team league, so any team in this week's slate without a record
 * drops the whole rank. `teamIds` is every roster the week pairs (yours, your opponent, the sidelines).
 */
export function seasonRaceRank(
  records: Record<string, { wins: number; losses: number; ties?: number }>,
  yourRosterId: string | null | undefined,
  teamIds: ReadonlyArray<string | null | undefined>,
): SeasonRaceRank | null {
  if (!yourRosterId || !records[yourRosterId]) return null
  const ids = [...new Set([yourRosterId, ...teamIds.filter((id): id is string => typeof id === 'string' && id !== '')])]
  if (ids.length < 2) return null
  if (ids.some(id => !records[id])) return null
  const pct = (id: string) => {
    const r = records[id]
    const ties = r.ties ?? 0
    const games = r.wins + r.losses + ties
    return games > 0 ? (r.wins + ties / 2) / games : null
  }
  const mine = pct(yourRosterId)
  if (mine == null) return null
  const all = ids.map(pct)
  if (all.some(p => p == null)) return null
  const better = all.filter(p => (p as number) > mine).length
  const same = all.filter(p => p === mine).length
  return { rank: better + 1, of: ids.length, tied: same > 1 }
}

/** "3rd", "T-3rd" — the ordinal the race strip prints. */
export function seasonRaceOrdinal(r: SeasonRaceRank): string {
  const n = r.rank
  const mod100 = n % 100
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${r.tied ? 'T-' : ''}${n}${suffix}`
}
