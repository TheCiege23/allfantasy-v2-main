/**
 * Commissioner Hub — who is actually playing.
 *
 * One answer for the abandoned-teams check, the Active managers tile, the member
 * list and the engagement chart, so they cannot disagree with each other or with
 * the Commissioner Workspace check-up.
 *
 * 🛑 ON AN IMPORTED LEAGUE, `Roster.updatedAt` SAYS NOTHING ABOUT A MANAGER.
 * Measured on production 2026-09-16: the Sleeper sync rewrites every roster row on
 * each pass (all 12 rows of one league stamped within 130ms of each other), so by
 * that clock every manager is always "active" — while the Workspace check-up, which
 * reads real moves, had "2 managers inactive for 14 days" open on the same league.
 * The only rows that ever looked idle were LEFTOVER roster rows with no team behind
 * them (a previous owner's row the sync no longer touches), which the hub then
 * reported as "1 team with nobody running it — Unnamed team".
 *
 * So an imported league is judged by moves: trades, waiver claims and roster moves
 * per manager in the last 14 days, from `readManagerActivity` — the same read and
 * the same window (`MANAGER_INACTIVE_AFTER_DAYS`) the Workspace detector uses.
 * A league created in AllFantasy keeps the roster timestamp, because there it is
 * written by the managers' own actions.
 *
 * Client-safe: no Prisma. The loader reads the rows and passes them in.
 */

import type { SectionState } from '@/lib/core-app/leagueHome'

export type MemberStatus = 'active' | 'at_risk' | 'inactive' | 'unknown'

export type MemberActivityRow = {
  name: string
  status: MemberStatus
  /** "3 moves in 14 days", "last move 2d ago" — what the status was judged from. */
  detail: string
}

export type LeagueMemberActivity = SectionState<{
  rows: MemberActivityRow[]
  total: number
  active: number
  inactive: number
  /** How status was measured, stated on screen. */
  basis: string
}>

export type ImportedActivityInput = {
  kind: 'imported'
  /** `readManagerActivity(leagueId, windowDays)` — current-window and prior-window move counts per manager. */
  managers: Array<{ managerName: string; currentCount: number; priorCount: number }>
  /**
   * Every OWNED team's display name. `readManagerActivity` lists only managers with
   * at least one move in the last two windows, so the quietest managers — the ones
   * this check exists to find — are absent from it. Measured on production: a
   * 12-team league read "4 of 8 active". Teams missing from `managers` are added
   * with zero moves.
   */
  teams?: string[]
  /** `readActivityWindow(leagueId)` — the newest imported move and the all-time count. */
  lastActivityAt: Date | null
  eventCount: number
}

export type NativeActivityInput = {
  kind: 'native'
  /** `getLeagueManagerHealth(leagueId).rows`, or null when that read failed. */
  rows: Array<{
    teamName: string | null
    managerName: string | null
    status: MemberStatus
    lastActionAt: string | null
  }> | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const ORDER: Record<MemberStatus, number> = { inactive: 0, at_risk: 1, unknown: 2, active: 3 }

function finish(rows: MemberActivityRow[], basis: string): LeagueMemberActivity {
  const sorted = [...rows].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))
  return {
    available: true,
    data: {
      rows: sorted,
      total: sorted.length,
      active: sorted.filter((r) => r.status === 'active').length,
      inactive: sorted.filter((r) => r.status === 'inactive').length,
      basis,
    },
  }
}

export function resolveMemberActivity(
  input: ImportedActivityInput | NativeActivityInput,
  now: Date,
  windowDays: number,
): LeagueMemberActivity {
  if (input.kind === 'imported') {
    if (!input.lastActivityAt || input.eventCount === 0) {
      return {
        available: false,
        reason: 'No moves have been imported for this league yet, so nobody can be called active or inactive.',
      }
    }
    const ageDays = Math.floor((now.getTime() - input.lastActivityAt.getTime()) / DAY_MS)
    if (ageDays > windowDays) {
      /*
       * The Workspace detector's freshness gate, mirrored: with no move in the whole
       * window, every manager reads idle — a statement about the feed, not the people.
       */
      return {
        available: false,
        reason: `The newest imported move is ${plural(ageDays, 'day')} old, so every manager would look idle. Re-sync the league to check who is really active.`,
      }
    }
    if (input.managers.length === 0) {
      return {
        available: false,
        reason: 'This league’s moves couldn’t be matched to its managers, so activity isn’t judged here.',
      }
    }
    const listed = new Set(input.managers.map((m) => m.managerName))
    const silent = (input.teams ?? [])
      .filter((name) => !listed.has(name))
      .map((managerName) => ({ managerName, currentCount: 0, priorCount: 0 }))
    return finish(
      [...input.managers, ...silent].map((m) => ({
        name: m.managerName,
        status: m.currentCount > 0 ? 'active' : 'inactive',
        detail:
          m.currentCount > 0
            ? `${plural(m.currentCount, 'move')} in ${windowDays} days`
            : m.priorCount > 0
              ? `no moves in ${windowDays} days (${m.priorCount} the ${windowDays} before)`
              : `no moves in ${windowDays} days`,
      })),
      `trades, waiver claims and roster moves in the last ${windowDays} days`,
    )
  }

  if (!input.rows) {
    return { available: false, reason: 'Manager activity couldn’t be read just now.' }
  }
  /*
   * A roster row with no team behind it is not a team. Counting it would name an
   * "Unnamed team" as abandoned.
   */
  const matched = input.rows.filter((r) => r.teamName || r.managerName)
  if (matched.length === 0) {
    return { available: false, reason: 'No rosters have been set up for this league yet.' }
  }
  return finish(
    matched.map((r) => {
      const days = r.lastActionAt ? Math.floor((now.getTime() - Date.parse(r.lastActionAt)) / DAY_MS) : null
      return {
        name: (r.teamName || r.managerName) as string,
        status: r.status,
        detail:
          days == null ? 'no activity on file' : days <= 0 ? 'active today' : days === 1 ? 'last move yesterday' : `last move ${days}d ago`,
      }
    }),
    'the last lineup or roster change',
  )
}

// ── One judgement for every surface ─────────────────────────────────────────

/**
 * What `readMemberActivityInputs` (./memberActivityReads.ts) read for one league. Each read may
 * have failed (null); the judgement then says activity couldn't be read, never "nobody".
 */
export type MemberActivityReads =
  | { native: true; rows: NativeActivityInput['rows'] }
  | {
      native: false
      managers: ImportedActivityInput['managers'] | null
      window: { lastActivityAt: Date | null; eventCount: number } | null
    }

/**
 * Who is active, from the reads above — the answer the Commissioner Hub and the league
 * Overview's commissioner card BOTH show, so the card and the hub it links to cannot disagree.
 */
export function memberActivityFromReads(
  reads: MemberActivityReads,
  teams: TeamIdentityRow[],
  now: Date,
  windowDays: number,
): LeagueMemberActivity {
  if (reads.native) return resolveMemberActivity({ kind: 'native', rows: reads.rows }, now, windowDays)
  if (!reads.managers || !reads.window) {
    return { available: false, reason: 'League activity couldn’t be read just now.' }
  }
  return resolveMemberActivity(
    {
      kind: 'imported',
      managers: reads.managers,
      teams: ownedTeamNames(teams),
      lastActivityAt: reads.window.lastActivityAt,
      eventCount: reads.window.eventCount,
    },
    now,
    windowDays,
  )
}

/** Past this, an imported league's rows are the sync's picture, not the managers'. */
export const ACTIVITY_STALE_AFTER_MS = 2 * DAY_MS

/**
 * Why activity is not judged on an imported league whose sync has stopped, or null when it may be.
 *
 * ⚠ TWO DAYS WITHOUT A SYNC AND EVERY MANAGER LOOKS IDLE. Measured on a test league 14 days
 * unsynced: "12 teams with nobody running them". A league never synced (`lastSyncedAt` null) is
 * not called stale here; the hub reports that state on its own.
 */
export function staleActivityReason(input: { native: boolean; lastSyncedAt: Date | null; now: Date }): string | null {
  if (input.native || !input.lastSyncedAt) return null
  const ageMs = input.now.getTime() - input.lastSyncedAt.getTime()
  if (ageMs <= ACTIVITY_STALE_AFTER_MS) return null
  const days = Math.floor(ageMs / DAY_MS)
  return `AllFantasy last read this league ${days} days ago, so every manager would look idle. Re-sync it to see who is really active.`
}

// ── Team identity helpers ────────────────────────────────────────────────────

export type TeamIdentityRow = {
  teamName?: string | null
  ownerName?: string | null
  platformUserId?: string | null
  claimedByUserId?: string | null
  isOrphan?: boolean | null
}

/** The name a team is shown by. Importers write the literal "Unknown" for a missing name; that is no name. */
export function teamDisplayName(t: TeamIdentityRow): string {
  const clean = (v: string | null | undefined) => {
    const s = v?.trim()
    return s && s.toLowerCase() !== 'unknown' ? s : null
  }
  return clean(t.teamName) ?? clean(t.ownerName) ?? 'Unnamed team'
}

/**
 * Teams that genuinely have nobody.
 *
 * ⚠ `LeagueTeam.isOrphan` ALONE IS NOT THAT. The column carries several meanings
 * across importers, and on production a team flagged orphan was claimed by the
 * league's own owner and linked to a platform user. A team counts only when it is
 * flagged AND unclaimed AND has no platform user behind it.
 */
export function isUnownedTeam(t: TeamIdentityRow): boolean {
  return t.isOrphan === true && !t.claimedByUserId && !t.platformUserId
}

/** One entry per unowned team — two teams both named "Unknown" are two teams. */
export function unownedTeamNames(teams: TeamIdentityRow[]): string[] {
  return teams.filter(isUnownedTeam).map(teamDisplayName)
}

/**
 * Names of the teams someone owns — the `teams` input above.
 *
 * ⚠ SPELLED EXACTLY AS `readManagerActivity` SPELLS THEM (`teamName`, else
 * `ownerName`, trimmed), because a team is matched to its move count by name; any
 * other spelling lists the same manager twice. Deduped for the same reason.
 */
export function ownedTeamNames(teams: TeamIdentityRow[]): string[] {
  const names = teams
    .filter((t) => !isUnownedTeam(t))
    .map((t) => t.teamName?.trim() || t.ownerName?.trim() || '')
    .filter(Boolean)
  return [...new Set(names)]
}

/**
 * Who has gone quiet, by name — the people a commissioner can message.
 *
 * ⚠ ON A LEAGUE ALLFANTASY RUNS, AN UNCLAIMED TEAM IS AN EMPTY SEAT, NOT A QUIET
 * MANAGER. Its roster clock never moves because nobody holds it, so the activity rows
 * list "Open Team 10" as inactive (measured on a pre-draft native league: 12 of 12
 * "quiet", 11 of them seats). Seats are the invite prompt's job. On an import a seat is
 * a team with no owner at all (`isUnownedTeam`); a team nobody has claimed on
 * AllFantasy still has a real platform manager. The viewer's own team is left out too:
 * nobody needs telling to message themselves.
 */
export function quietManagerNames(
  rows: Array<{ name: string; status: MemberStatus }>,
  teams: TeamIdentityRow[],
  native: boolean,
  viewerId: string | null = null,
): string[] {
  const seats = new Set(
    teams
      .filter(
        (t) => (native ? !t.claimedByUserId : isUnownedTeam(t)) || (viewerId != null && t.claimedByUserId === viewerId),
      )
      .flatMap((t) => [t.teamName?.trim(), t.ownerName?.trim()])
      .filter((n): n is string => Boolean(n)),
  )
  return rows.filter((r) => r.status === 'inactive' && !seats.has(r.name)).map((r) => r.name)
}
