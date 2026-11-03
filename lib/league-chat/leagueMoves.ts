/**
 * League transactions as cards in league chat — waiver claims, free-agent moves and trades, the way
 * Sleeper's league chat shows them (owner's request, 2026-10-31).
 *
 * ⚠ READ-TIME, NOT STORED IN CHAT. The moves already live in `DecisionOsImportedActivity`, written by
 * the `decision-os-activity-ingest` cron and read through `getLeagueActivity`. The conversation fetches
 * them (`/api/app/leagues/[leagueId]/chat/moves`) and slots them between messages by time. Nothing is
 * written to `LeagueChatMessage`, so a card has no id the react / reply / pin / report routes know,
 * and it is drawn through `renderSystem`, which offers none of them.
 *
 * ⚠ A MOVE SHOWS UP AFTER THE DAILY INGEST, NOT AS IT HAPPENS. The cron fires at 07:00 UTC and
 * rotates through leagues, so a card can trail the move by a day. That is the price of not calling
 * the provider from a chat request (CLAUDE.md, DB-first).
 *
 * Pure: shared by the route, the conversation and the tests.
 */

export type LeagueMoveKind = 'trade' | 'waiver' | 'roster_move'

export type LeagueMovePlayer = {
  id: string
  /** Always printable: an unnamed id stays "player 4034" rather than vanishing. */
  name: string
  position: string | null
  team: string | null
  imageUrl: string | null
  /** On an add: the fantasy team that received him, when known. */
  to: string | null
}

export type LeagueMove = {
  id: string
  kind: LeagueMoveKind
  occurredAt: string
  /** The team the move is attributed to, then its manager; either may be unknown. */
  teamName: string | null
  managerName: string | null
  avatarUrl: string | null
  /** Every team involved — both sides of a trade. */
  involvedTeams: string[]
  adds: LeagueMovePlayer[]
  drops: LeagueMovePlayer[]
  /** The winning FAAB bid. NULL IS UNKNOWN, not free: render nothing, never "$0". */
  bid: number | null
  picks: string[]
}

/**
 * How far back the cards go. A roster id is a slot in ONE season, and the receiving team on a trade
 * card is read off the current slots, so older moves could name the wrong team after a rollover.
 */
export const LEAGUE_MOVES_WINDOW_DAYS = 30
export const LEAGUE_MOVE_MESSAGE_TYPE = 'league_move'

const KINDS: readonly LeagueMoveKind[] = ['trade', 'waiver', 'roster_move']
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function readPlayer(v: unknown): LeagueMovePlayer | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = str(o.id)
  const name = str(o.name)
  if (!id || !name) return null
  return { id, name, position: str(o.position), team: str(o.team), imageUrl: str(o.imageUrl), to: str(o.to) }
}

/** Only well-formed moves survive the wire; anything else is dropped rather than drawn half-right. */
export function readLeagueMoves(value: unknown): LeagueMove[] {
  if (!Array.isArray(value)) return []
  const out: LeagueMove[] = []
  for (const v of value) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const id = str(o.id)
    const occurredAt = str(o.occurredAt)
    const kind = KINDS.find((k) => k === o.kind)
    if (!id || !occurredAt || !kind || !Number.isFinite(Date.parse(occurredAt))) continue
    const players = (list: unknown) => (Array.isArray(list) ? list.map(readPlayer).filter((p): p is LeagueMovePlayer => p != null) : [])
    const adds = players(o.adds)
    const drops = players(o.drops)
    // A move with nobody in it says nothing a card could show.
    if (adds.length === 0 && drops.length === 0) continue
    const bid = typeof o.bid === 'number' && Number.isFinite(o.bid) && o.bid >= 0 ? o.bid : null
    out.push({
      id,
      kind,
      occurredAt,
      teamName: str(o.teamName),
      managerName: str(o.managerName),
      avatarUrl: str(o.avatarUrl),
      involvedTeams: Array.isArray(o.involvedTeams) ? o.involvedTeams.filter((t): t is string => typeof t === 'string' && t.length > 0) : [],
      adds,
      drops,
      bid,
      picks: Array.isArray(o.picks) ? o.picks.filter((p): p is string => typeof p === 'string' && p.length > 0) : [],
    })
  }
  return out
}

/** Who made the move, in the words the card leads with. */
export function moveActor(move: LeagueMove): string {
  if (move.kind === 'trade' && move.involvedTeams.length >= 2) return move.involvedTeams.join(' and ')
  return move.teamName ?? move.managerName ?? 'A manager'
}

export function moveVerb(move: LeagueMove): string {
  if (move.kind === 'trade') return 'made a trade'
  if (move.kind === 'waiver') return 'made a waiver claim'
  return 'made a free agent move'
}

/** One plain sentence for the card's accessible name and for anything that reads text, not cards. */
export function describeMove(move: LeagueMove): string {
  const names = (ps: LeagueMovePlayer[]) => ps.map((p) => p.name).join(', ')
  const parts = [`${moveActor(move)} ${moveVerb(move)}.`]
  if (move.adds.length) parts.push(`Added ${names(move.adds)}${move.bid != null ? ` for $${move.bid}` : ''}.`)
  if (move.drops.length) parts.push(`Dropped ${names(move.drops)}.`)
  if (move.picks.length) parts.push(`Picks: ${move.picks.join(', ')}.`)
  return parts.join(' ')
}

/**
 * Which moves a channel shows: all of them in the league's main view and #general, trades in #trades,
 * claims and free-agent moves in #waivers, and none in #trash-talk or any channel added later.
 */
export function movesForChannel(channel: string | null | undefined): (move: LeagueMove) => boolean {
  if (channel == null || channel === 'general') return () => true
  if (channel === 'trades') return (move) => move.kind === 'trade'
  if (channel === 'waivers') return (move) => move.kind !== 'trade'
  return () => false
}

/** The minimum a chat row needs, so this module does not depend on the list component. */
export type MoveMergeable = { id: string; createdAt: string; pending?: boolean }

/**
 * The moves that belong in the loaded conversation, slotted in by time.
 *
 * A move older than the oldest loaded message is left out: a busy chat loads only its newest
 * messages, and stacking a month of moves above them would bury the conversation under cards for a
 * stretch whose messages are not on screen. With no messages yet, the window is the whole 30 days.
 * Pending (unsent) messages stay last, where the list keeps them.
 */
export function mergeMovesIntoMessages<M extends MoveMergeable>(
  messages: M[],
  moves: LeagueMove[],
  toMessage: (move: LeagueMove) => M,
  now: Date = new Date(),
): M[] {
  if (moves.length === 0) return messages
  const windowStart = now.getTime() - LEAGUE_MOVES_WINDOW_DAYS * 86_400_000
  const sent = messages.filter((m) => !m.pending)
  const pending = messages.filter((m) => m.pending)
  const oldest = sent.reduce((min, m) => Math.min(min, Date.parse(m.createdAt) || Infinity), Infinity)
  const from = Math.max(windowStart, Number.isFinite(oldest) ? oldest : windowStart)
  const cards = moves
    .filter((mv) => {
      const t = Date.parse(mv.occurredAt)
      return t >= from && t <= now.getTime()
    })
    .map(toMessage)
  if (cards.length === 0) return messages
  const merged = [...sent, ...cards].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  return [...merged, ...pending]
}
