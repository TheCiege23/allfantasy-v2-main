import 'server-only'

import { prisma } from '@/lib/prisma'
import { eliminationFormat } from './railMatchupMode'

/**
 * Season Outlook's rows for leagues it cannot simulate — so every league you play is ON the page.
 *
 * 🛑 WHY THIS EXISTS. Leagues the playoff model could not run were listed in a footer, "35 leagues are
 * not on this page", and a league listed under that heading reads as a league the page has nothing to
 * say about. For two kinds of league it does have something to say (owner's report, 2026-11-11):
 *
 *   - ELIMINATION FORMATS (guillotine, survivor, tournament) have no playoff odds by construction, but
 *     the question a manager has is simpler and answerable: am I still alive?
 *   - LEAGUES THAT HAVE NOT STARTED have nothing to simulate yet, and saying WHY in the league's own
 *     terms (pre-draft, drafting, still being set up) is the useful sentence, not "no matchups synced".
 *
 * Everything here is read, never inferred: who is out comes from `getLeagueEliminations` — the same
 * read Scout and Standings use, so the three cannot disagree — and a tournament's from its participant
 * row. When neither says, the status is `unknown` and the copy says so.
 */

export type OutlookSurvival = {
  status: 'alive' | 'eliminated' | 'not-started' | 'unknown'
  /** Teams still alive, when the league's field can be counted. */
  remaining: number | null
  field: number | null
}

export type OutlookStatusKind = 'elimination' | 'not-started' | 'unavailable'
export type OutlookEliminationFormat = 'guillotine' | 'survivor' | 'tournament'

/** A league with no odds on this board, and why. Always shown — never silently dropped. */
export type OutlookWithheld = {
  leagueName: string
  /** The plain-language line the page prints for this league. */
  reason: string
  leagueId?: string
  kind?: OutlookStatusKind
  format?: OutlookEliminationFormat | null
  survival?: OutlookSurvival | null
  /** The league's own lifecycle status (`League.status`), when the row needs it. */
  stage?: string | null
  /** `weeklyScopeKey` — shared by every copy of one provider league. */
  scope?: string
}

/** League statuses that mean "the season has not begun". */
const PRESEASON_STAGES = new Set(['setup', 'pre_draft', 'predraft', 'draft_scheduled', 'drafting', 'forming', 'offseason'])

export function isPreseasonStage(stage: string | null | undefined): boolean {
  return PRESEASON_STAGES.has(String(stage ?? '').trim().toLowerCase())
}

/**
 * Guillotine / survivor / tournament, or null for a league that eliminates nobody. One rule with the
 * rail for guillotine (`eliminationFormat`); survivor and tournament are read from the type itself.
 */
export function outlookEliminationFormat(league: {
  leagueType?: string | null
  guillotineMode?: boolean | null
  settings?: unknown
  platformLeagueId?: string | null
}): OutlookEliminationFormat | null {
  /*
   * A survivor league's Exile Island is created as its own league with an `exile-<survivorId>-…`
   * platform id and a plain `redraft` type — the id is the structural marker (survivor creation
   * writes it), not the "Exile Island:" name, which a user can edit.
   */
  if (String(league.platformLeagueId ?? '').startsWith('exile-')) return 'survivor'
  const rail = eliminationFormat(league)
  if (rail === 'survivor_guillotine') return 'survivor'
  if (rail === 'guillotine') return 'guillotine'
  const type = String(league.leagueType ?? '').trim().toLowerCase()
  if (type.includes('survivor')) return 'survivor'
  if (type.includes('tournament')) return 'tournament'
  return null
}

/** Why a league has no schedule to simulate, in its own lifecycle terms. */
export function notStartedReason(stage: string | null | undefined): string {
  switch (String(stage ?? '').trim().toLowerCase()) {
    case 'drafting':
      return 'Draft in progress — odds start once the schedule is set.'
    case 'pre_draft':
    case 'predraft':
    case 'draft_scheduled':
      return 'Pre-draft — odds start once the draft is done and the schedule is set.'
    case 'offseason':
      return 'Offseason — odds start when the new season’s schedule is set.'
    default:
      return 'Still being set up — odds start once the season’s schedule exists.'
  }
}

const FORMAT_LABEL: Record<OutlookEliminationFormat, string> = {
  guillotine: 'Guillotine',
  survivor: 'Survivor',
  tournament: 'Tournament',
}

/** The line printed for an elimination league. Pure; exported for the test. */
export function survivalReason(format: OutlookEliminationFormat, s: OutlookSurvival): string {
  const label = FORMAT_LABEL[format]
  const left = s.remaining != null && s.field != null ? `${s.remaining} of ${s.field} teams left` : null
  switch (s.status) {
    case 'alive':
      return `${label} — you are still alive${left ? `, ${left}` : ''}.`
    case 'eliminated':
      return `${label} — you have been eliminated${left ? ` (${left})` : ''}.`
    case 'not-started':
      return `${label} — not started yet${s.field != null ? `; all ${s.field} teams are still in` : ''}.`
    default:
      return `${label} — we cannot tell which team is yours, so your status is unknown.`
  }
}

/**
 * Fill `survival` and `reason` on every elimination row, in place. Fails soft per league: a read that
 * throws leaves that row `unknown` rather than costing the board.
 */
export async function attachSurvival(userId: string, rows: OutlookWithheld[]): Promise<void> {
  const targets = rows.filter((r) => r.kind === 'elimination' && r.leagueId && r.format)
  if (targets.length === 0) return

  const tournamentIds = targets.filter((r) => r.format === 'tournament').map((r) => r.leagueId!)
  const tournamentStatus = new Map<string, { status: string; remaining: number; field: number }>()
  if (tournamentIds.length > 0) {
    try {
      const shells = await prisma.tournamentLeague.findMany({
        where: { leagueId: { in: tournamentIds } },
        select: { leagueId: true, tournamentId: true },
      })
      const byTournament = new Map<string, string[]>()
      for (const s of shells) {
        if (!s.leagueId) continue
        byTournament.set(s.tournamentId, [...(byTournament.get(s.tournamentId) ?? []), s.leagueId])
      }
      if (byTournament.size > 0) {
        const participants = await prisma.tournamentParticipant.findMany({
          where: { tournamentId: { in: [...byTournament.keys()] } },
          select: { tournamentId: true, userId: true, status: true },
        })
        for (const [tournamentId, leagueIds] of byTournament) {
          const field = participants.filter((p) => p.tournamentId === tournamentId)
          const mine = field.find((p) => p.userId === userId)
          if (!mine) continue
          const remaining = field.filter((p) => !isOutStatus(p.status)).length
          for (const id of leagueIds) tournamentStatus.set(id, { status: mine.status, remaining, field: field.length })
        }
      }
    } catch {
      /* Fail soft: these rows fall through to the league-status rules below. */
    }
  }

  /* Dynamic: scout reads standings, and the outlook must not pull that graph in at module load. */
  const { getLeagueEliminations } = await import('./scout')

  type Read = { teams: Array<{ id: string; externalId: string; claimedByUserId: string | null }>; out: { eliminated: string[] } | null }
  const reads = new Map<OutlookWithheld, Read | null>()
  await Promise.all(
    targets.map(async (row) => {
      if (row.format === 'tournament' && tournamentStatus.has(row.leagueId!)) return
      try {
        const [teams, out] = await Promise.all([
          prisma.leagueTeam.findMany({
            where: { leagueId: row.leagueId! },
            select: { id: true, externalId: true, claimedByUserId: true },
          }),
          row.format === 'tournament' ? Promise.resolve(null) : getLeagueEliminations(row.leagueId!, userId).catch(() => null),
        ])
        reads.set(row, { teams, out })
      } catch {
        reads.set(row, null)
      }
    }),
  )

  /*
   * ⚠ COPIES OF ONE PROVIDER LEAGUE SHARE WHO IS OUT. Scout answers only for a copy whose OWN type is
   * an elimination format, and copies disagree (see the loader). Roster ids are the provider's, the
   * same in every copy, so one copy's answer is every copy's — the viewer's team is still read per copy.
   */
  const outByScope = new Map<string, { eliminated: string[] }>()
  for (const row of targets) {
    const out = reads.get(row)?.out
    if (row.scope && out && !outByScope.has(row.scope)) outByScope.set(row.scope, out)
  }

  for (const row of targets) {
    const format = row.format!
    let survival: OutlookSurvival = { status: 'unknown', remaining: null, field: null }
    const t = tournamentStatus.get(row.leagueId!)
    const read = reads.get(row)
    if (format === 'tournament' && t) {
      survival = {
        status: isOutStatus(t.status) ? 'eliminated' : isPreseasonStage(row.stage) ? 'not-started' : 'alive',
        remaining: t.remaining,
        field: t.field,
      }
    } else if (read) {
      const out = read.out ?? (row.scope ? outByScope.get(row.scope) ?? null : null)
      const field = read.teams.length || null
      const eliminated = new Set(out?.eliminated ?? [])
      const remaining = field != null ? read.teams.filter((t) => !eliminated.has(t.externalId || t.id)).length : null
      const mine = read.teams.find((t) => t.claimedByUserId === userId) ?? null
      if (field == null || (isPreseasonStage(row.stage) && eliminated.size === 0)) {
        /* No teams on file at all is a league nobody has joined yet — nothing has started. */
        survival = { status: 'not-started', remaining, field }
      } else if (mine && out) {
        survival = { status: eliminated.has(mine.externalId || mine.id) ? 'eliminated' : 'alive', remaining, field }
      } else {
        survival = { status: 'unknown', remaining: out ? remaining : null, field }
      }
    }
    /* A read that failed is left `unknown` — said as unknown, never guessed. */
    row.survival = survival
    row.reason = survivalReason(format, survival)
  }
}

function isOutStatus(status: string | null | undefined): boolean {
  return ['eliminated', 'withdrawn', 'removed'].includes(String(status ?? '').toLowerCase())
}
