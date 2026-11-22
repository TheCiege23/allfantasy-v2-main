import 'server-only'
import type { LineupVerification } from './lineupVerification'

import { sleeperGet } from '@/lib/trade-intel/sleeperTradeSync'

type LiveRoster = {
  roster_id: number
  owner_id: string | null
  co_owners?: string[] | null
  players: string[] | null
  starters: string[]
  reserve?: string[] | null
  taxi?: string[] | null
  metadata?: Record<string, unknown> | null
}

/*
 * ── SPEED (2026-11-22) ──────────────────────────────────────────────────────────────────────
 * Measured on the owner's 90-league account: the home summary's live Sleeper check took 6.6s of
 * an 8.0s card, because each league paid TWO round trips in sequence (league → its week → that
 * week's matchups) and the home runs it for every Sleeper league. Two changes, neither of which
 * changes what is returned:
 *
 * 1. THE WEEK IS GUESSED FROM THE LAST ANSWER, AND THE GUESS IS ALWAYS CHECKED. The league's week
 *    (`settings.leg`) from its previous in-season response is remembered per league, so the
 *    matchups read starts beside the league and roster reads. The league response still decides:
 *    if its week differs from the guess, the guessed response is thrown away and the right week is
 *    read, exactly as before. A wrong guess costs one wasted request, never a wrong lineup.
 *
 * 2. IDENTICAL REQUESTS IN FLIGHT AT THE SAME MOMENT SHARE ONE RESPONSE. The same account often
 *    opens /core on the phone and the desktop together, and both renders ask for the same leagues.
 *    The share ends when the request settles: nothing is kept afterwards, so no answer is ever
 *    older than the request that produced it.
 */
const inFlight = new Map<string, Promise<unknown>>()
function sharedGet<T>(path: string): Promise<T | null> {
  const existing = inFlight.get(path)
  if (existing) return existing as Promise<T | null>
  const request = sleeperGet<T>(path)
  inFlight.set(path, request)
  const release = () => {
    if (inFlight.get(path) === request) inFlight.delete(path)
  }
  request.then(release, release)
  return request
}

/** The last in-season week each league reported. A guess only; see SPEED above. Bounded by size. */
const lastKnownWeek = new Map<string, number>()
const LAST_KNOWN_WEEK_LIMIT = 20_000
function rememberWeek(leagueId: string, week: number | null) {
  if (week == null) {
    lastKnownWeek.delete(leagueId)
    return
  }
  if (lastKnownWeek.size >= LAST_KNOWN_WEEK_LIMIT && !lastKnownWeek.has(leagueId)) lastKnownWeek.clear()
  lastKnownWeek.set(leagueId, week)
}

/** For tests: forget every remembered week. */
export function forgetSleeperWeeksForTests() {
  lastKnownWeek.clear()
}

const matchupsPath = (leagueId: string, week: number) => `/league/${encodeURIComponent(leagueId)}/matchups/${week}`

const readRosters = (leagueId: string) =>
  sharedGet<LiveRoster[]>(`/league/${encodeURIComponent(leagueId)}/rosters`)

export async function currentSleeperRoster(
  leagueId: string,
  team: { platformUserId?: string | null; externalId?: string | null },
): Promise<(Record<string, unknown> & {
  verification: LineupVerification
  /**
   * EVERY roster's starters for `verification.week`, keyed by Sleeper `roster_id` as a string
   * (which is `WeeklyMatchup.rosterId` / `LeagueTeam.externalId`). Read from the same weekly
   * matchups response as your own lineup, so it costs no extra request. A roster is present only
   * when its row passes the same checks yours must; absent means unknown, never "no starters".
   * Null outside the season, when there is no weekly lineup to read.
   *
   * 🛑 THE OPPONENT'S SIDE OF THE MATCHUP CARD WAS PRICED FROM THE STORED `Roster` ROW — whatever
   * the last sync wrote — while yours was the live lineup. A starter the opponent benched since
   * then still counted for them.
   */
  weekStarters: Record<string, string[]> | null
}) | null> {
  type WeekMatchups = Array<{ roster_id: number; starters: string[] }>
  const guessedWeek = lastKnownWeek.get(leagueId) ?? null
  // Started now and checked below; `.catch` so an unused guess can never reject unobserved.
  const guessedMatchups =
    guessedWeek != null ? sharedGet<WeekMatchups>(matchupsPath(leagueId, guessedWeek)).catch(() => null) : null
  const [rows, league] = await Promise.all([
    readRosters(leagueId).catch(() => null),
    sharedGet<{ status: string; roster_positions?: string[]; settings?: { leg?: number; best_ball?: number; disable_adds?: number } }>(
      `/league/${encodeURIComponent(leagueId)}`,
    ).catch(() => null),
  ])
  if (league) {
    const leg = league.settings?.leg
    rememberWeek(leagueId, league.status === 'in_season' && Number.isInteger(leg) && leg! >= 1 && leg! <= 53 ? leg! : null)
  }
  if (!Array.isArray(rows) || !league) return null
  // An owner id is authoritative. Never fall through to a different owner's
  // roster just because an old roster number still matches after reassignment.
  const matches = team.platformUserId
    ? rows.filter((r) => r && typeof r==='object' && (r.owner_id === team.platformUserId || Array.isArray(r.co_owners)&&r.co_owners.includes(team.platformUserId!)))
    : rows.filter((r) => r && typeof r==='object' && String(r.roster_id) === team.externalId)
  const row = matches.length === 1 ? matches[0] : null
  if (!row || !validPlayerIds(row.starters,true) || (row.players != null && !validPlayerIds(row.players)) || (row.co_owners != null && !validPlayerIds(row.co_owners))) return null
  // Sleeper's roster starters can disagree with the live weekly lineup. The
  // matchup endpoint is authoritative for this week's starter slots (including
  // bye teams with a null matchup_id). Never fall back to the stale roster list.
  let currentStarters = row.starters
  let matchups: WeekMatchups | null = null
  if (league.status === 'in_season') {
    const week = league.settings?.leg
    if (!Number.isInteger(week) || week! < 1 || week! > 53) return null
    // The guess is used only when it names the week the league itself reports.
    matchups =
      guessedMatchups && guessedWeek === week
        ? await guessedMatchups
        : await sharedGet<WeekMatchups>(matchupsPath(leagueId, week!)).catch(() => null)
    if (!Array.isArray(matchups)) return null
    const weekly = weeklyStarters(matchups, row)
    if (!weekly) return null
    currentStarters = weekly
  }
  if (!startersAreActive(row, currentStarters)) return null
  const starters = normalizeStarters(currentStarters)

  // Every other roster through the same checks as yours; one that fails is left out, not guessed.
  let weekStarters: Record<string, string[]> | null = null
  if (matchups) {
    weekStarters = {}
    for (const other of rows) {
      if(!other||typeof other!=='object'||!Number.isInteger(other.roster_id))continue
      const weekly = weeklyStarters(matchups, other)
      if (weekly && startersAreActive(other, weekly)) weekStarters[String(other.roster_id)] = normalizeStarters(weekly)
    }
  }
  return { players: row.players ?? [], starters, reserve: row.reserve ?? [], taxi: row.taxi ?? [], weekStarters,
    leagueStatus: league.status, bestBall: league.settings?.best_ball === 1,
    waiversEnabled: league.settings?.disable_adds == null ? null : league.settings.disable_adds !== 1,
    eliminated: row.metadata?.eliminated === true || row.metadata?.eliminated === 'true' || row.metadata?.chopped === true,
    verification: {
    checkedAt: new Date().toISOString(), source: 'Sleeper',
    week: league.status === 'in_season' ? league.settings!.leg! : null,
    slots: (league.roster_positions ?? []).filter((s) => !['BN', 'IR', 'TAXI'].includes(s)),
  } }
}

/** This roster's starters from the weekly matchups response; null unless exactly one usable row. */
function weeklyStarters(
  matchups: Array<{ roster_id: number; starters: string[] }>,
  row: LiveRoster,
): string[] | null {
  const matching = matchups.filter((m) => m && typeof m==='object' && m.roster_id === row.roster_id)
  return matching.length === 1 && validPlayerIds(matching[0].starters,true) ? matching[0].starters : null
}

/** Conflicting assignments are unknown, never a reason to flag a starter. */
function startersAreActive(row: LiveRoster, starters: string[]): boolean {
  if ((row.reserve != null && !validPlayerIds(row.reserve)) || (row.taxi != null && !validPlayerIds(row.taxi))) return false
  const inactive = new Set([...(row.reserve ?? []), ...(row.taxi ?? [])])
  return !starters.some((id) => id && id !== '0' && inactive.has(id))
}

/**
 * Preserve empty positions: downstream filters must not move the next player into the wrong
 * starting slot when the provider returns null or an empty id.
 */
function normalizeStarters(starters: string[]): string[] {
  return starters.map((id) => (id == null || id === '' ? '0' : id))
}

/** Runtime provider arrays can be malformed despite the declared endpoint type. */
function validPlayerIds(value:unknown,holes=false):value is string[]{
  return Array.isArray(value)&&value.every(id=>typeof id==='string'&&(holes||id.length>0)||holes&&id==null)
}
