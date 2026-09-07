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
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  leagueId: string
  leagueName: string
  platform: string
}

export type TriageInjury = { status: string | null; description: string | null; reportedAt: string | null }

export type TriageRow = {
  player: { sport: string; externalId: string; sleeperId: string; name: string; position: string | null; team: string | null; imageUrl: string | null }
  /** The readiness chip; null only for a no-game row with no report. */
  status: { label: string; tone: MoveTone } | null
  description: string | null
  reportedAt: string | null
  /** Leagues where he is in your starting lineup. */
  leagues: Array<{ leagueId: string; leagueName: string; platform: string }>
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
}

const SEVERITY: Record<MoveTone, number> = { bad: 0, warn: 1, good: 2 }

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
    const inj = injuries.get(s.name.trim().toLowerCase()) ?? null
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

    const existing = byPlayer.get(s.sleeperId)
    if (existing) {
      if (!existing.leagues.some((l) => l.leagueId === s.leagueId)) existing.leagues.push({ leagueId: s.leagueId, leagueName: s.leagueName, platform: s.platform })
      continue
    }
    byPlayer.set(s.sleeperId, {
      player: { sport: s.sport, externalId: s.externalId, sleeperId: s.sleeperId, name: s.name, position: s.position, team: s.team, imageUrl: s.imageUrl },
      status: ready,
      description: inj?.description ?? null,
      reportedAt: inj?.reportedAt ?? null,
      leagues: [{ leagueId: s.leagueId, leagueName: s.leagueName, platform: s.platform }],
      kickoff,
      noGame,
      bye,
      inactive,
    })
  }

  /*
   * Soonest lock first: a game still ahead sorts by minutes to kickoff; a
   * player with no game this week can be fixed any time before his leagues
   * lock, so he follows; a player whose game has already started cannot be
   * changed and goes last. Severity breaks ties, then the name.
   */
  const bucket = (r: TriageRow): number => {
    if (!r.kickoff) return 1
    return lockState(r.kickoff, nowIso).state === 'locked' ? 2 : 0
  }
  const minutes = (r: TriageRow): number => (r.kickoff ? lockState(r.kickoff, nowIso).minutes : Number.MAX_SAFE_INTEGER)
  return [...byPlayer.values()].sort((a, b) => {
    const ba = bucket(a)
    const bb = bucket(b)
    if (ba !== bb) return ba - bb
    if (ba === 0 && minutes(a) !== minutes(b)) return minutes(a) - minutes(b)
    const sa = a.status ? SEVERITY[a.status.tone] : 3
    const sb = b.status ? SEVERITY[b.status.tone] : 3
    if (sa !== sb) return sa - sb
    return a.player.name.localeCompare(b.player.name)
  })
}
