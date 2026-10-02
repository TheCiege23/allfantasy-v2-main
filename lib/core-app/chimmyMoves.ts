import type { GameDayTriage, TriageRow } from './gameDayTriage'
import { lockState } from './lineupLock'
import type { MoveTone } from './playerMoves'
import type { LineupPlayer } from './myTeam'
import { isAtRisk } from './injuryStatus'

/**
 * Chimmy's one-tap moves for one league (league-first, phase 2).
 *
 * Pure and client-safe. Built from the game-day triage the page already knows how to load
 * (`loadGameDayTriage`, DB-only, bounded) — never the lineup-actions engine and never a model call,
 * so the card costs a page nothing it would notice.
 *
 * ⚠ EVERY MOVE HAS A TAP THAT GOES SOMEWHERE REAL. `href` is the exact lineup row on My Team
 * (`#lineup-player-<sleeperId>`, which that screen scrolls to and highlights), and `ask` is a
 * question for Chimmy that lands in the composer UNSENT — see `CommsOpenDetail.prefill`.
 *
 * ⚠ A LOCKED STARTER IS NOT A MOVE. His game has kicked off and no platform will let him be
 * benched, so offering "Bench him" would be a button that cannot work.
 */
export type ChimmyMove = {
  key: string
  tone: MoveTone
  title: string
  detail: string
  href: string
  actionLabel: string
  ask: string
}

export type ChimmyMoves = {
  leagueId?: string
  moves: ChimmyMove[]
  /** Starters we could actually read in this league. Zero means "we cannot say", never "all clear". */
  startersRead: number
  /** The question for the empty state's button. */
  checkAsk: string
}

const MAX_MOVES = 3

function describe(row: TriageRow): { title: string; reason: string } {
  const name = row.player.name
  if (row.inactive) return { title: `Bench ${name}`, reason: 'inactive' }
  if (row.bye) return { title: `Bench ${name}`, reason: 'on bye' }
  if (row.noGame && !row.status) return { title: `Bench ${name}`, reason: 'has no game this week' }
  const label = row.status?.label ?? 'flagged'
  if (row.status?.tone === 'bad') return { title: `Bench ${name}`, reason: label.toLowerCase() }
  return { title: `Check ${name}`, reason: label.toLowerCase() }
}

export function composeChimmyMoves(args: {
  triage: GameDayTriage
  leagueId: string
  leagueName: string
  nowIso: string
}): ChimmyMoves {
  const { triage, leagueId, leagueName, nowIso } = args
  const league = encodeURIComponent(leagueId)
  const moves: ChimmyMove[] = []

  for (const row of triage.rows) {
    if (moves.length >= MAX_MOVES) break
    if (!row.leagues.some((l) => l.leagueId === leagueId)) continue
    const lock = row.kickoff ? lockState(row.kickoff, nowIso) : null
    if (lock?.state === 'locked') continue

    const { title, reason } = describe(row)
    const tone: MoveTone = row.status?.tone === 'warn' && !row.noGame && !row.inactive ? 'warn' : 'bad'
    const where = [row.player.position, row.player.team].filter(Boolean).join(' · ')
    const detail = [reason.charAt(0).toUpperCase() + reason.slice(1), where, lock?.label].filter(Boolean).join(' — ')

    moves.push({
      key: row.player.sleeperId,
      tone,
      title,
      detail,
      href: `/core/my-team?league=${league}#lineup-player-${encodeURIComponent(row.player.sleeperId)}`,
      actionLabel: tone === 'bad' ? 'Fix lineup' : 'Review',
      ask:
        tone === 'bad'
          ? `${row.player.name} is ${reason}. Who should I start instead in ${leagueName}?`
          : `${row.player.name} is ${reason}. Should I start him in ${leagueName}, and who is my best backup?`,
    })
  }

  return {
    leagueId,
    moves,
    startersRead: triage.startersRead,
    checkAsk: `Run a start/sit check on my ${leagueName} lineup for this week.`,
  }
}

/** My team already resolved its current roster, injury aliases and kickoff times.
 * Reuse that snapshot instead of adding a second triage read to page load. */
export function composeMyTeamMoves(args: {
  leagueId: string
  leagueName: string
  starters: LineupPlayer[]
  nowIso: string
  /**
   * Starting slots with nobody in them, by lineup index. A certain zero, so each one leads the card.
   *
   * ⚠ THE CARD USED TO BE BLIND TO THESE. It was handed `slot.player` only, so an empty slot never
   * became a move — and with nothing else flagged the card said "No remaining flagged starters"
   * over a hole in the lineup. Optional so a caller with no slot list keeps its old behaviour.
   */
  emptySlots?: ReadonlyArray<{ index: number; slotLabel: string }>
}): ChimmyMoves {
  const league = encodeURIComponent(args.leagueId)
  const emptyMoves: ChimmyMove[] = (args.emptySlots ?? []).map(({ index, slotLabel }) => ({
    key: `empty-slot-${index}`,
    tone: 'bad',
    title: `Fill your empty ${slotLabel} slot`,
    detail: 'Empty starting slot — it scores zero',
    href: `/core/my-team?league=${league}#lineup-slot-${index}`,
    actionLabel: 'Fix lineup',
    ask: `My ${slotLabel} slot in ${args.leagueName} is empty. Who should I start there?`,
  }))
  const triaged = composeMyTeamPlayerMoves(args)
  return { ...triaged, moves: [...emptyMoves, ...triaged.moves].slice(0, MAX_MOVES) }
}

function composeMyTeamPlayerMoves(args: {
  leagueId: string
  leagueName: string
  starters: LineupPlayer[]
  nowIso: string
}): ChimmyMoves {
  const rows: TriageRow[] = args.starters
    .filter((player) => player.ruledOut || player.onBye || isAtRisk(player.injuryStatus))
    .map<TriageRow>((player) => ({
      player: { ...player, sport: player.sport ?? '', externalId: player.sleeperId },
      status: player.injuryStatus ? { label: player.injuryStatus, tone: player.ruledOut ? 'bad' : 'warn' } : null,
      description: null, reportedAt: null, inactive: null,
      leagues: [{ leagueId: args.leagueId, leagueName: args.leagueName, platform: 'manual' }],
      kickoff: player.kickoff?.toISOString() ?? null,
      noGame: player.onBye, bye: player.onBye,
    }))
  return composeChimmyMoves({ ...args, triage: { rows, week: null, leaguesRead: 1, startersRead: args.starters.length } })
}
