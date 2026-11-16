/**
 * The mock draft board Chimmy reads — stage 3 of drafts (2026-11-16).
 *
 * The /mock-draft room runs ENTIRELY in the browser: picks, the clock and the queue live in React
 * state and a localStorage checkpoint, and no server table holds them while a draft is in progress.
 * So the server cannot read the board the way it reads a league draft's `DraftSession`. Instead the
 * room sends this snapshot with every question (`mockDraftBoard` on the Chimmy form), and the server
 * turns it into prompt lines (`lib/chimmy/mockDraftGrounding.ts`).
 *
 * ⚠ THE SNAPSHOT IS THE USER'S OWN DATA ABOUT THEIR OWN PRACTICE DRAFT. It is untrusted the way any
 * form field is — the server re-validates and caps it — but it can only steer advice to the person
 * who sent it, and nothing on the server is written from it.
 *
 * A queue change Chimmy proposes comes back as a `MockQueueProposal` and is applied HERE, in the
 * browser, only when the user taps Confirm — the queue it changes exists nowhere else.
 *
 * Client-safe: no server imports.
 */

export const MOCK_BOARD_VERSION = 1
/** Best-ADP undrafted players sent. Enough to name anyone a manager would queue; small enough to post. */
export const MOCK_BOARD_AVAILABLE_MAX = 300
export const MOCK_BOARD_QUEUE_MAX = 60

export type MockBoardPlayer = { id: string; name: string; position: string; team: string | null; adp: number | null }

export type MockBoardTeam = {
  slot: number
  name: string
  isUser: boolean
  /** Positions this team has drafted, in pick order. */
  positions: string[]
  /** The room's own roster-needs read for this team. */
  needs: string[]
}

export type MockBoardAuction = {
  nomination: { name: string; position: string; team: string | null } | null
  currentBid: number
  highBidderName: string | null
  minNextBid: number
  bidSecondsLeft: number | null
  teams: Array<{ name: string; budget: number; openSlots: number; isViewer: boolean }>
}

export type MockDraftBoard = {
  v: typeof MOCK_BOARD_VERSION
  sport: string
  scoring: string
  draftType: 'snake' | 'linear' | 'auction'
  teamCount: number
  rounds: number
  superflex: boolean
  status: string
  currentPick: number
  userSlot: number
  /** Seconds left on the user's OWN pick; null when it is not their turn or the room has no clock. */
  secondsLeft: number | null
  /** The room's per-pick clock; 0 = no clock ("Auto"). */
  perPickSeconds: number
  /** The slot on the clock for `currentPick`, `currentPick + 1`, … — the room's own order. */
  upcomingSlots: number[]
  teams: MockBoardTeam[]
  myPicks: Array<{ overall: number; name: string; position: string }>
  queue: MockBoardPlayer[]
  /** Undrafted players, best market ADP first. */
  available: MockBoardPlayer[]
  auction: MockBoardAuction | null
}

/* ── Building it from the room's state ─────────────────────────────────────────────────────────── */

type RoomPlayer = { id: string; name: string; position: string; team: string; adp: number | null }
type RoomPick = { overall: number; playerId: string; playerName: string; position: string; isUser: boolean }
type RoomTeam = { slot: number; managerName: string; isUser: boolean; picks: ReadonlyArray<{ position: string }>; rosterNeeds: string[] }

export type MockBoardRoomInput = {
  settings: { sport: string; scoring: string; draftType: 'snake' | 'linear' | 'auction'; teamCount: number; rounds: number; superflex: boolean; speed: number }
  teams: readonly RoomTeam[]
  availablePlayers: readonly RoomPlayer[]
  picks: readonly RoomPick[]
  currentPick: number
  status: string
  /** Seconds left on the user's pick, when they are on the clock and the room has one. */
  userSecondsLeft: number | null
  /** The room's order: the slot on the clock at an overall pick. */
  slotAtOverall: (overall: number) => number
  auction: MockBoardAuction | null
}

const adpOrder = (a: RoomPlayer, b: RoomPlayer) => (a.adp ?? Number.POSITIVE_INFINITY) - (b.adp ?? Number.POSITIVE_INFINITY)

export function buildMockDraftBoard(room: MockBoardRoomInput, queueIds: readonly string[]): MockDraftBoard | null {
  const user = room.teams.find((t) => t.isUser)
  if (!user) return null
  const drafted = new Set(room.picks.map((p) => p.playerId))
  const byId = new Map(room.availablePlayers.map((p) => [p.id, p]))
  const toBoard = (p: RoomPlayer): MockBoardPlayer => ({ id: p.id, name: p.name, position: p.position, team: p.team || null, adp: p.adp })

  const total = room.settings.teamCount * room.settings.rounds
  const upcomingSlots: number[] = []
  if (room.settings.draftType !== 'auction') {
    for (let o = room.currentPick; o <= total && upcomingSlots.length <= room.settings.teamCount * 2; o += 1) {
      upcomingSlots.push(room.slotAtOverall(o))
    }
  }

  return {
    v: MOCK_BOARD_VERSION,
    sport: room.settings.sport,
    scoring: room.settings.scoring,
    draftType: room.settings.draftType,
    teamCount: room.settings.teamCount,
    rounds: room.settings.rounds,
    superflex: room.settings.superflex,
    status: room.status,
    currentPick: room.currentPick,
    userSlot: user.slot,
    secondsLeft: room.userSecondsLeft,
    perPickSeconds: room.settings.speed,
    upcomingSlots,
    teams: room.teams.map((t) => ({
      slot: t.slot,
      name: t.managerName,
      isUser: t.isUser,
      positions: t.picks.map((p) => p.position),
      needs: t.rosterNeeds,
    })),
    myPicks: room.picks.filter((p) => p.isUser).map((p) => ({ overall: p.overall, name: p.playerName, position: p.position })),
    queue: queueIds
      .filter((id) => !drafted.has(id))
      .map((id) => byId.get(id))
      .filter((p): p is RoomPlayer => p != null)
      .slice(0, MOCK_BOARD_QUEUE_MAX)
      .map(toBoard),
    available: room.availablePlayers
      .filter((p) => !drafted.has(p.id))
      .slice()
      .sort(adpOrder)
      .slice(0, MOCK_BOARD_AVAILABLE_MAX)
      .map(toBoard),
    auction: room.auction,
  }
}

/* ── A queue change Chimmy proposed ───────────────────────────────────────────────────────────── */

export type MockQueueProposal = {
  id: string
  add: Array<{ id: string; name: string; position: string; team: string | null }>
  addAt: 'top' | 'bottom'
  remove: Array<{ id: string; name: string; position: string; team: string | null }>
  /** The queue (ids, in order) the card was built against. Confirm refuses if it has changed. */
  baseQueueIds: string[]
  /** The first few names of the queue as it will be after Confirm. */
  resultingTop: string[]
}

/** The edit: drop removes, then put adds at the top or the bottom (an add already queued is MOVED). */
export function applyQueueIdOps(current: readonly string[], ops: { addIds: readonly string[]; addAt: 'top' | 'bottom'; removeIds: readonly string[] }): string[] {
  const drop = new Set([...ops.removeIds, ...ops.addIds])
  const rest = current.filter((id) => !drop.has(id))
  return ops.addAt === 'top' ? [...ops.addIds, ...rest] : [...rest, ...ops.addIds]
}

export type MockQueueApplyResult = { ok: true; queue: string[]; skipped: string[] } | { ok: false; reason: 'stale' | 'invalid' }

/**
 * Confirm, in the browser. Refuses if the queue changed since the card was made — a card never applies
 * to a queue the user was not shown — and skips any add drafted since (it is named back, never hidden).
 * `isAvailable` is "in this mock's pool and not drafted"; the queue that comes back holds only those.
 */
export function applyMockQueueProposal(
  currentQueue: readonly string[],
  proposal: unknown,
  isAvailable: (playerId: string) => boolean,
): MockQueueApplyResult {
  const p = readMockQueueProposal(proposal)
  if (!p) return { ok: false, reason: 'invalid' }
  // The same view the board was built from: drafted and unknown players out, the first QUEUE_MAX shown.
  const live = currentQueue.filter(isAvailable)
  const shown = live.slice(0, MOCK_BOARD_QUEUE_MAX)
  if (p.baseQueueIds.length !== shown.length || p.baseQueueIds.some((id, i) => shown[i] !== id)) {
    return { ok: false, reason: 'stale' }
  }
  const skipped = p.add.filter((a) => !isAvailable(a.id)).map((a) => a.name)
  const addIds = p.add.filter((a) => isAvailable(a.id)).map((a) => a.id)
  return { ok: true, queue: applyQueueIdOps(live, { addIds, addAt: p.addAt, removeIds: p.remove.map((r) => r.id) }), skipped }
}

const isStr = (v: unknown): v is string => typeof v === 'string'

function readCardPlayer(v: unknown): MockQueueProposal['add'][number] | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (!isStr(r.id) || !isStr(r.name)) return null
  return { id: r.id, name: r.name, position: isStr(r.position) ? r.position : '', team: isStr(r.team) ? r.team : null }
}

/** Reads a proposal from the response (or the saved checkpoint); null when it is not one. */
export function readMockQueueProposal(v: unknown): MockQueueProposal | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (!isStr(r.id) || (r.addAt !== 'top' && r.addAt !== 'bottom')) return null
  if (!Array.isArray(r.add) || !Array.isArray(r.remove) || !Array.isArray(r.baseQueueIds) || !r.baseQueueIds.every(isStr)) return null
  const add = r.add.map(readCardPlayer)
  const remove = r.remove.map(readCardPlayer)
  if (add.some((x) => x == null) || remove.some((x) => x == null)) return null
  return {
    id: r.id,
    add: add as MockQueueProposal['add'],
    addAt: r.addAt,
    remove: remove as MockQueueProposal['remove'],
    baseQueueIds: r.baseQueueIds as string[],
    resultingTop: Array.isArray(r.resultingTop) ? r.resultingTop.filter(isStr).slice(0, 8) : [],
  }
}
