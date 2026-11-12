import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { byeStatus } from './byeStatus'
import { lockState } from './lineupLock'
import { readiness, type MoveTone } from './playerMoves'
import { pregameInactive, type PregameInactive } from './pregameInactive'

/**
 * The finder's game-day home: your starters across every league who are
 * flagged, each with the lock they count down to — a triage list, so a
 * reader does not have to search one name at a time at kickoff minus twenty.
 *
 * Pure and client-safe. The loader (gameDayTriageLoader.ts) reads the user's
 * starters, the injury feed and the week's kickoffs with a handful of bounded
 * queries on the finder's own joins — never the lineup-actions engine, which
 * is far too expensive to run from a page.
 *
 * ⚠ WHAT COUNTS AS FLAGGED. A designation that reads at-risk or ruled-out in
 * the injury feed (readiness → warn / bad), or a starter whose club has no
 * game on the week's schedule at all while the schedule is on file. A healthy
 * starter is not listed; "no report" is not a flag. Nothing is invented: a
 * club absent from the map reads "no game on the schedule this week", which is
 * what we know, not "bye", which we do not.
 */

export type TriageStarter = {
  sleeperId: string
  sport: string
  externalId: string
  /** The feed that minted `externalId`; the finder ref carries it (playerRef.ts). */
  source?: string | null
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  leagueId: string
  leagueName: string
  platform: string
  /** What a deep link to this league's lineup screen needs (platformLinks.lineupLink). Optional: older callers omit them and the link falls back to the league page. */
  platformLeagueId?: string | null
  season?: number | null
  /** Your team's platform id in this league — the ESPN teamId / Yahoo team number. */
  teamId?: string | null
}

/** A league he starts in, carrying what the row's "Open lineup" button needs. */
export type TriageLeague = {
  leagueId: string
  leagueName: string
  platform: string
  platformLeagueId?: string | null
  season?: number | null
  teamId?: string | null
}

export type TriageInjury = { status: string | null; description: string | null; reportedAt: string | null }

export type TriageRow = {
  player: { sport: string; externalId: string; source?: string | null; sleeperId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }
  /** The readiness chip; null only for a no-game row with no report. */
  status: { label: string; tone: MoveTone } | null
  description: string | null
  reportedAt: string | null
  /** Leagues where he is in your starting lineup. */
  leagues: TriageLeague[]
  /** His kickoff this week, ISO; null when his club is not on the schedule. */
  kickoff: string | null
  /** The schedule is on file and his club has no game in it. */
  noGame: boolean
  /** Ruled Out inside the last two hours before his kickoff — the inactive list or a late scratch (pregameInactive.ts). The chip then reads "Inactive". */
  inactive: PregameInactive | null
  /** `noGame` with the shape of a real bye slate (byeStatus.ts); false for a plain schedule gap. */
  bye: boolean
}

export type GameDayTriage = {
  rows: TriageRow[]
  week: { season: number; week: number } | null
  /** How many leagues' starting lineups were read. */
  leaguesRead: number
  startersRead: number
  /**
   * Leagues whose lineups were NOT read because the loader's bound was reached.
   * Zero in any realistic account (the bound is far above the largest one on
   * production); non-zero is said on screen, never swallowed.
   */
  leaguesNotRead?: number
  /** Leagues left out because they are best ball — the platform sets those lineups itself. */
  bestBallLeagues?: number
  /**
   * Leagues on a platform whose player ids we cannot translate yet (Yahoo, MFL, Fantrax,
   * Fleaflicker). Left out rather than read raw: an untranslated id matches a DIFFERENT
   * player's Sleeper id.
   */
  unsupportedLeagues?: number
  /**
   * Starters in another sport's leagues (Fantrax, native…) whose id reached no catalog player
   * (sportRosterTranslate.ts). Dropped rather than read raw — and counted, because a starter we could
   * not identify is one we could not check, and the list must not read as a clean bill for him.
   */
  unidentifiedStarters?: number
  /** When the OLDEST lineup read was last synced (Roster.updatedAt), ISO — the list is only as current as that. */
  rostersAsOf?: string | null
  /**
   * Leagues whose starting lineup has an unfilled slot ('0' in `starters`), with how many.
   * Optional so older callers and fixtures need not carry it; absent reads as none found.
   */
  emptySlots?: Array<TriageLeague & { count: number }>
  /**
   * When each league's lineup READ was last synced, one entry per league read. Lets a screen name the
   * leagues behind an old `rostersAsOf` instead of letting one stale league date the whole list.
   */
  rosterAges?: Array<{ leagueId: string; leagueName: string; asOf: string }>
  /**
   * EVERY league handed to the loader whose lineup was not read, each with the reason — so
   * `leaguesRead + skipped.length` is the whole account. See `classifySkippedLeagues`.
   * Optional so older callers and fixtures need not carry it.
   */
  skipped?: SkippedLeague[]
}

/**
 * Why a league's lineup was not read. One reason per league, the FIRST that applied in the
 * loader's order — so the reasons partition the skipped set and their counts add up.
 */
export type SkipReason =
  | 'not_read' // past the loader's bound
  | 'no_team' // no team claimed by this user, so there is no lineup that is theirs
  | 'best_ball' // the platform sets the lineup
  | 'unsupported' // a platform whose player ids we cannot translate yet
  | 'pre_season' // pre-draft / drafting: no lineup to set yet
  | 'season_over' // complete / archived
  | 'eliminated' // a guillotine (or similar) team already out
  | 'no_roster' // a claimed team, but no synced roster of theirs to read

export type SkippedLeague = { leagueId: string; leagueName: string | null; platform: string | null; reason: SkipReason }

/** The order the screen lists them in: the ones pointing at the user's own setup first. */
export const SKIP_REASON_ORDER: readonly SkipReason[] = [
  'no_team',
  'no_roster',
  'unsupported',
  'not_read',
  'best_ball',
  'pre_season',
  'season_over',
  'eliminated',
]

/** League stages with no lineup to fix, split by which side of the season they fall on. */
const PRE_SEASON_STAGES = new Set(['pre_draft', 'predraft', 'setup', 'drafting', 'draft'])
const SEASON_OVER_STAGES = new Set(['complete', 'completed', 'season_over', 'archived'])

/** `pre_season` / `season_over` for a stage with no lineup to fix; null for an in-season league. */
export function offSeasonReason(stage: string): 'pre_season' | 'season_over' | null {
  const s = stage.toLowerCase()
  if (PRE_SEASON_STAGES.has(s)) return 'pre_season'
  if (SEASON_OVER_STAGES.has(s)) return 'season_over'
  return null
}

/**
 * Every league asked for and not read, with why.
 *
 * 🛑 THE POINT IS THAT NOTHING IS SILENT. The loader used to count only three of its eight skips
 * (best ball, unsupported, over the bound). A league with no claimed team, no synced roster, an
 * off-season stage or an eliminated team dropped out with no trace, so "N starters checked across
 * 48 leagues" could not be squared with the user's own league count — reported from the War Room
 * as "shows less leagues than I am actually in" (2026-11-11).
 *
 * Precedence follows the loader: a league is classified by the first gate that stopped it. The
 * roster loop's own reason (`loopReasons`) only applies when no earlier gate did, and a league
 * that was READ is never listed, whatever a loop reason says about another of its rosters.
 */
export function classifySkippedLeagues(args: {
  /** De-duplicated ids, in the order asked. */
  ids: readonly string[]
  /** Ids past the loader's bound. */
  overflow: ReadonlySet<string>
  /** Ids with a team claimed by the viewer. */
  claimed: ReadonlySet<string>
  bestBall: ReadonlySet<string>
  unsupported: ReadonlySet<string>
  /** Reasons the roster loop recorded (off-season, eliminated). */
  loopReasons: ReadonlyMap<string, SkipReason>
  /** Ids whose lineup was read. */
  read: ReadonlySet<string>
  leagueInfo: ReadonlyMap<string, { name: string | null; platform: string | null }>
}): SkippedLeague[] {
  const out: SkippedLeague[] = []
  for (const id of args.ids) {
    if (args.read.has(id)) continue
    const reason: SkipReason = args.overflow.has(id)
      ? 'not_read'
      : !args.claimed.has(id)
        ? 'no_team'
        : args.bestBall.has(id)
          ? 'best_ball'
          : args.unsupported.has(id)
            ? 'unsupported'
            : (args.loopReasons.get(id) ?? 'no_roster')
    const info = args.leagueInfo.get(id)
    out.push({ leagueId: id, leagueName: info?.name ?? null, platform: info?.platform ?? null, reason })
  }
  return out
}

const SEVERITY: Record<MoveTone, number> = { bad: 0, warn: 1, good: 2 }

/**
 * The short text after the status on a chip — "Questionable · Hamstring" — or null.
 *
 * ⚠ A FEED DESCRIPTION OFTEN JUST RESTATES THE DESIGNATION. The chip read
 * "IR · IR. INJURED RESERVE" for Jaxson Dart on 2026-09-27. A description whose
 * letters begin with the label's letters adds nothing and is dropped; so is one
 * too long for a chip (the card shows the whole sentence).
 */
export function chipDetail(label: string | null | undefined, description: string | null | undefined, max = 20): string | null {
  const d = (description ?? '').trim()
  if (!d || d.length > max) return null
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const l = letters(label ?? '')
  const dl = letters(d)
  if (l && dl.startsWith(l)) return null
  // "IR · Injured Reserve" says the same thing twice in a different spelling.
  if (l === 'ir' && dl.startsWith('injuredreserve')) return null
  return d
}

export function triageRows(args: {
  starters: TriageStarter[]
  /** Lower-cased player name → the freshest injury row. */
  injuries: Map<string, TriageInjury>
  kickoffs: Record<string, string>
  nowIso: string
  /** The schedule's week, so an absence can be judged a bye or a gap. */
  week?: number | null
  /** Club names the folder could not resolve this week; while non-zero no bye is claimed (byeStatus.ts). */
  unresolved?: number
}): TriageRow[] {
  const { starters, injuries, kickoffs, nowIso } = args
  const week = args.week ?? null
  const unresolved = args.unresolved ?? 0
  const scheduleOnFile = Object.keys(kickoffs).length > 0
  const byPlayer = new Map<string, TriageRow>()

  for (const s of starters) {
    const reported = injuries.get(s.name.trim().toLowerCase()) ?? null
    // A designation explicitly for another week is not a current lineup warning.
    // Match the designation phrase, not "Expected Return Week 7": a player on
    // IR with that return date is still unavailable this week. Old Week 1
    // Questionable reports must not survive into a Week 3 game-day triage.
    const reportWeek = reported?.description?.match(/\b(?:Out|Questionable|Doubtful|Probable|Inactive|Active)\s+for\s+Week\s+(\d{1,2})\b/i)
    /*
     * ⚠ AND A GAME-DAY WORD ABOUT TRAINING CAMP IS A JULY REPORT. Production 2026-09-28, week 3:
     * Jeremy Chinn "Back - Questionable for start of Training Camp" was flagged in War Room and
     * Player Finder, "reported Mon" — the feed re-stamps the row's date, so the 45-day age gate
     * cannot see it. Only the game-day designations are dropped: IR / PUP / NFI carry over from
     * camp into the season and stay true.
     */
    const campReport =
      week != null &&
      /^(?:questionable|doubtful|probable)$/i.test(String(reported?.status ?? '').trim()) &&
      /\btraining\s+camp\b/i.test(reported?.description ?? '')
    const inj = campReport || (week != null && reportWeek && Number(reportWeek[1]) !== week) ? null : reported
    const readyBase = readiness(inj?.status ?? null, Boolean(inj))
    const club = normalizeTeamAbbrev(s.team)
    const kickoff = club ? (kickoffs[club] ?? null) : null
    // An Out that landed inside the pregame window is the inactive list; the chip says so.
    const inactive = inj ? pregameInactive(inj.status, inj.reportedAt, kickoff) : null
    const ready = inactive && readyBase ? { tone: 'bad' as MoveTone, label: 'Inactive' } : readyBase
    const flagged = ready ? ready.tone !== 'good' : false
    const noGame = scheduleOnFile && !kickoff
    const bye = noGame && byeStatus(club, kickoffs, week, unresolved) === 'bye'
    if (!flagged && !noGame) continue

    const league: TriageLeague = {
      leagueId: s.leagueId,
      leagueName: s.leagueName,
      platform: s.platform,
      platformLeagueId: s.platformLeagueId ?? null,
      season: s.season ?? null,
      teamId: s.teamId ?? null,
    }
    const existing = byPlayer.get(s.sleeperId)
    if (existing) {
      if (!existing.leagues.some((l) => l.leagueId === s.leagueId)) existing.leagues.push(league)
      continue
    }
    byPlayer.set(s.sleeperId, {
      player: { sport: s.sport, externalId: s.externalId, source: s.source ?? null, sleeperId: s.sleeperId, name: s.name, position: s.position, team: s.team, imageUrl: s.imageUrl },
      status: ready,
      description: inj?.description ?? null,
      reportedAt: inj?.reportedAt ?? null,
      leagues: [league],
      kickoff,
      noGame,
      bye,
      inactive,
    })
  }

  return [...byPlayer.values()].sort(compareTriageRows(nowIso))
}

/**
 * Soonest lock first: a game still ahead sorts by minutes to kickoff; a
 * player with no game this week can be fixed any time before his leagues
 * lock, so he follows; a player whose game has already started cannot be
 * changed and goes last. Severity breaks ties, then the name.
 *
 * Exported so the loader can merge one sport's rows with another's under the
 * same order, rather than concatenating two lists each sorted on its own.
 */
export function compareTriageRows(nowIso: string): (a: TriageRow, b: TriageRow) => number {
  const bucket = (r: TriageRow): number => {
    if (!r.kickoff) return 1
    return lockState(r.kickoff, nowIso).state === 'locked' ? 2 : 0
  }
  const minutes = (r: TriageRow): number => (r.kickoff ? lockState(r.kickoff, nowIso).minutes : Number.MAX_SAFE_INTEGER)
  return (a, b) => {
    const ba = bucket(a)
    const bb = bucket(b)
    if (ba !== bb) return ba - bb
    if (ba === 0 && minutes(a) !== minutes(b)) return minutes(a) - minutes(b)
    const sa = a.status ? SEVERITY[a.status.tone] : 3
    const sb = b.status ? SEVERITY[b.status.tone] : 3
    if (sa !== sb) return sa - sb
    return a.player.name.localeCompare(b.player.name)
  }
}

/** A league whose lineup read is older than this is named on its own rather than dating the list. */
export const ROSTER_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000

export type StaleRosterLeague = { leagueId: string; leagueName: string; asOf: string; days: number }

/**
 * ⚠ ONE STALE LEAGUE MUST NOT DATE THE WHOLE LIST. `rostersAsOf` is the OLDEST lineup read, by design (a
 * newest-first stamp would say "just now" over a league last seen at 9am). But one league that stopped
 * syncing made fifty read "as of 101d ago" on Game Plan, and "53d ago" on Player Finder (2026-11-09).
 * So a league past ROSTER_STALE_AFTER_MS is NAMED, oldest first, with its age, and the stamp describes
 * the rest. When every league is stale, or no ages are known, the stamp stays `rostersAsOf`.
 *
 * One rule, two screens: War Room's Game Plan and Player Finder's Game day both call this.
 */
export function splitRosterAges(
  data: Pick<GameDayTriage, 'rostersAsOf' | 'rosterAges'>,
  nowIso: string,
): { stale: StaleRosterLeague[]; freshCount: number; stampAsOf: string | null } {
  const nowMs = new Date(nowIso).getTime()
  const ages = data.rosterAges ?? []
  const isStale = (asOf: string) => nowMs - new Date(asOf).getTime() > ROSTER_STALE_AFTER_MS
  const stale = ages
    .filter((a) => isStale(a.asOf))
    .sort((a, b) => a.asOf.localeCompare(b.asOf))
    .map((a) => ({ ...a, days: Math.floor((nowMs - new Date(a.asOf).getTime()) / 86_400_000) }))
  const fresh = ages.filter((a) => !isStale(a.asOf))
  const freshOldest = fresh.length > 0 ? fresh.map((a) => a.asOf).sort()[0]! : null
  return {
    stale,
    freshCount: fresh.length,
    stampAsOf: stale.length > 0 && freshOldest ? freshOldest : (data.rostersAsOf ?? null),
  }
}
