/**
 * What advancement WOULD do, before anybody does it.
 *
 * 🛑 `identifyQualifiers` WRITES THE MOMENT IT IS CALLED. It recomputes every
 * league, stamps ranks, sets `advancementStatus` on every participant and
 * creates advancement groups. There is no dry run and no undo — the call that
 * works out who advances is the same call that ends 176 seasons.
 *
 * 🛑 AND AN UNMATCHED MANAGER IS SILENTLY ELIMINATED BY IT. When no imported
 * team row matches a participant, `calculateLeagueStandings` falls back to the
 * zeros stored on the participant, which sorts them last — so a manager whose
 * record merely could not be READ is indistinguishable from one who lost every
 * week. Nothing about that failure is visible afterwards: they are just out.
 *
 * This module is the look-before-you-leap. It computes the same ranking the
 * engine will, from the same board, and writes nothing.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import {
  getTournamentStandingsBoard,
  type BoardRow,
  type StandingsBoard,
} from '@/lib/tournament/standingsBoard'

/** How stale a league's records may be before the preview says so. */
const STALE_AFTER_HOURS = 24

export type PreviewManager = {
  displayName: string
  leagueName: string
  conferenceRank: number
  wins: number
  losses: number
  pointsFor: number
}

export type ConferencePreview = {
  conferenceId: string
  conferenceName: string
  fieldSize: number
  qualifyingCount: number
  advancing: number
  bubble: number
  eliminated: number
  /** The last few above the line and the first few below it — the close calls. */
  lastIn: PreviewManager[]
  firstOut: PreviewManager[]
}

export type Blocker = {
  code: 'unmatched' | 'already_advanced' | 'no_cut' | 'cut_exceeds_field' | 'empty_round'
  message: string
  /** A blocker can be acknowledged and overridden; a warning never blocks. */
  severity: 'blocker' | 'warning'
}

export type AdvancementPreview = {
  tournamentId: string
  roundNumber: number
  roundId: string | null
  conferences: ConferencePreview[]
  totalAdvancing: number
  totalEliminated: number
  blockers: Blocker[]
  /** Passed back on execute so the numbers acted on are the numbers seen. */
  signature: string
  oldestUpdatedAt: string | null
}

function toManager(row: BoardRow, leagueName: string): PreviewManager {
  return {
    displayName: row.displayName,
    leagueName,
    conferenceRank: row.conferenceRank,
    wins: row.wins,
    losses: row.losses,
    pointsFor: row.pointsFor,
  }
}

/**
 * A cheap fingerprint of the decision.
 *
 * ⚠ THE BOARD MOVES BETWEEN LOOKING AND CLICKING. A sync landing between the
 * preview and the confirm changes who is 64th, and a commissioner who read one
 * list and authorised another has authorised something they never saw. The
 * signature is recomputed at execute time and must match.
 *
 * It deliberately covers the ORDER of the cut, not just the counts — swapping
 * the 64th and 65th managers leaves every count identical.
 */
export function signatureOf(board: StandingsBoard): string {
  const parts: string[] = []
  for (const c of board.conferences) {
    const ranked = c.leagues
      .flatMap((l) => l.rows)
      .filter((r) => !r.unmatched)
      .sort((a, b) => a.conferenceRank - b.conferenceRank)
      .map((r) => `${r.participantId}:${r.standing}`)
    parts.push(`${c.id}=${ranked.join(',')}`)
  }
  /* Not a cryptographic hash — this detects change, it does not resist anyone. */
  let h = 0
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return `${board.conferences.length}-${s.length}-${(h >>> 0).toString(36)}`
}

export async function previewAdvancement(
  tournamentId: string,
  commissionerUserId: string,
): Promise<AdvancementPreview | null> {
  const board = await getTournamentStandingsBoard(tournamentId, commissionerUserId)
  if (!board) return null

  const round = await prisma.tournamentRound.findFirst({
    where: { tournamentId, roundNumber: board.roundNumber || 1 },
    select: { id: true },
  })

  const blockers: Blocker[] = []
  const conferences: ConferencePreview[] = []
  let totalAdvancing = 0
  let totalEliminated = 0

  for (const c of board.conferences) {
    const rows = c.leagues.flatMap((l) => l.rows.map((r) => ({ row: r, leagueName: l.name })))
    const scored = rows.filter((x) => !x.row.unmatched)
    const advancing = scored.filter((x) => x.row.standing === 'in')
    const bubble = scored.filter((x) => x.row.standing === 'bubble')
    const eliminated = scored.filter((x) => x.row.standing === 'out')

    totalAdvancing += advancing.length
    totalEliminated += eliminated.length

    const byRank = [...scored].sort((a, b) => a.row.conferenceRank - b.row.conferenceRank)
    const cut = c.qualifyingCount

    conferences.push({
      conferenceId: c.id,
      conferenceName: c.name,
      fieldSize: rows.length,
      qualifyingCount: cut,
      advancing: advancing.length,
      bubble: bubble.length,
      eliminated: eliminated.length,
      lastIn: byRank.slice(Math.max(0, cut - 3), cut).map((x) => toManager(x.row, x.leagueName)),
      firstOut: byRank.slice(cut, cut + 3).map((x) => toManager(x.row, x.leagueName)),
    })

    if (cut <= 0) {
      blockers.push({
        code: 'no_cut',
        severity: 'blocker',
        message: `${c.name} advances nobody — check the settings before running this.`,
      })
    } else if (cut >= scored.length && scored.length > 0) {
      blockers.push({
        code: 'cut_exceeds_field',
        severity: 'blocker',
        message: `${c.name} advances ${cut} from a field of ${scored.length} — nobody would be eliminated.`,
      })
    }
    if (scored.length === 0) {
      blockers.push({
        code: 'empty_round',
        severity: 'blocker',
        message: `${c.name} has no scored managers, so there is nothing to rank.`,
      })
    }
  }

  /*
   * 🛑 THE ONE THAT MATTERS. An unmatched manager is not scored, so the engine
   * reads their stored zeros and eliminates them — and afterwards there is no
   * trace that a link was missing rather than a season being lost.
   */
  if (board.unmatchedTotal > 0) {
    blockers.push({
      code: 'unmatched',
      severity: 'blocker',
      message: `${board.unmatchedTotal} ${
        board.unmatchedTotal === 1 ? 'manager has' : 'managers have'
      } no matching team, so they have no record. Running now eliminates them for a missing link rather than a lost season — link them first.`,
    })
  }

  const alreadyAdvanced = await prisma.tournamentAdvancementGroup.count({
    where: { tournamentId, ...(round?.id ? { fromRoundId: round.id } : {}) },
  })
  if (alreadyAdvanced > 0) {
    blockers.push({
      code: 'already_advanced',
      severity: 'blocker',
      message: 'This round has already been advanced. Running it again re-stamps every status.',
    })
  }

  if (board.oldestUpdatedAt) {
    const ageHours = (Date.now() - new Date(board.oldestUpdatedAt).getTime()) / 3_600_000
    if (ageHours > STALE_AFTER_HOURS) {
      /* ⚠ A warning, not a blocker — a commissioner may legitimately advance on
         a settled week whose leagues stopped syncing. But they should know. */
      blockers.push({
        code: 'unmatched',
        severity: 'warning',
        message: `The stalest league last synced ${Math.round(ageHours)} hours ago. Re-sync before cutting anybody on these numbers.`,
      })
    }
  }

  return {
    tournamentId,
    roundNumber: board.roundNumber || 1,
    roundId: round?.id ?? null,
    conferences,
    totalAdvancing,
    totalEliminated,
    blockers,
    signature: signatureOf(board),
    oldestUpdatedAt: board.oldestUpdatedAt ? new Date(board.oldestUpdatedAt).toISOString() : null,
  }
}
