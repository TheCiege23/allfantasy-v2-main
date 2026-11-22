import 'server-only'

import { prisma } from '@/lib/prisma'
import { parseSessionKey } from '@/lib/draft/session-key'
import { slotIndexForOverallPick } from '@/lib/draft/snake'
import { loadSleeperAdpBoard, MAX_BOARD_SIZE } from '@/lib/draft/sleeperDraftBoard'
import { computeTeamNeeds } from '@/lib/draft-room/teamNeeds'
import { buildMockDraftBoard, MOCK_BOARD_QUEUE_MAX, type MockDraftBoard } from '@/lib/mock-draft/mockChimmyBoard'

/**
 * Chimmy in the LEAGUE mock room (`/draft/mock/[id]`, a league's Draft tab → Mock drafts) — stage 4 of
 * drafts (2026-11-16).
 *
 * Unlike /mock-draft, this room runs on the SERVER: `DraftRoomStateRow` (keyed `mock:<roomId>`) holds the
 * clock and order, `DraftRoomPickRecord` every pick, `DraftRoomUserQueue` each person's queue. So the
 * board is read here, never taken from the browser. It is turned into the same `MockDraftBoard` the
 * /mock-draft room sends, so the prompt lines, the AF Pro pick outlook and the queue Confirm card are the
 * stage 3 code unchanged (`lib/chimmy/mockDraftGrounding.ts`).
 *
 * The one thing the browser does send is its own queue order (`clientQueueIds`). The room's queue saves on
 * a 500 ms debounce, and only while the Queue tab is open, so the row can trail what the user is looking at;
 * a card built against the row would then be refused as stale on Confirm. It is the user's own list, every
 * id is resolved against the board, and it only steers advice to the person who sent it.
 *
 * Reads Postgres only (the ADP board is DB-backed). Never throws: any failure is "no board", and Chimmy
 * answers without one.
 */

/** Starter slots the needs read is measured against. Mock rooms are NFL redraft. */
const NFL_STARTERS = { QB: 1, RB: 2, WR: 2, TE: 1 }

type OrderSlot = { id: string; label?: string; isCpu?: boolean }

function readOrder(raw: unknown): OrderSlot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => s != null && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string')
    .map((s) => ({ id: s.id as string, label: typeof s.label === 'string' ? s.label : undefined, isCpu: s.isCpu === true }))
}

/** A superflex slot in whatever shape the room's roster settings carry it. */
function isSuperflex(rosterSettings: unknown): boolean {
  if (!rosterSettings || typeof rosterSettings !== 'object') return false
  return Object.entries(rosterSettings as Record<string, unknown>).some(
    ([k, v]) => /^(super_?flex|sflex|sf|op)$/i.test(k) && (v === true || (typeof v === 'number' && v > 0)),
  )
}

/**
 * A slot label is whatever name the person joined with, and it goes into the prompt: no line breaks or
 * control characters (they would start a new "instruction" line), and short.
 */
export function cleanLabel(label: string | undefined): string {
  return (label ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
}

export function mockRoomStatus(state: { status: string; timerPaused: boolean }): string {
  if (state.status === 'complete') return 'complete'
  if (state.status === 'active') return state.timerPaused ? 'paused' : 'drafting'
  return 'waiting'
}

/** Reads a JSON array of queue ids from the form; null when absent or not one. */
export function parseClientQueueIds(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.length > 20_000) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return null
    return v.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64).slice(0, MOCK_BOARD_QUEUE_MAX * 2)
  } catch {
    return null
  }
}

export async function loadLeagueMockBoard(args: {
  sessionId: unknown
  userId: string | null
  clientQueueIds?: string[] | null
  now?: number
}): Promise<MockDraftBoard | null> {
  try {
    if (!args.userId) return null
    const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : ''
    if (!sessionId || sessionId.length > 120) return null
    let parsed: { mode: 'mock' | 'live'; id: string }
    try {
      parsed = parseSessionKey(sessionId)
    } catch {
      return null
    }
    if (parsed.mode !== 'mock') return null

    const [state, room] = await Promise.all([
      prisma.draftRoomStateRow.findUnique({ where: { id: sessionId } }),
      prisma.mockDraftRoom.findUnique({ where: { id: parsed.id }, select: { sport: true, scoringType: true, rosterSettings: true } }),
    ])
    if (!state || !room) return null
    const order = readOrder(state.pickOrder)
    // Only someone drafting in this room gets its board.
    if (!order.some((s) => s.id === args.userId)) return null

    const sport = (room.sport || 'NFL').toUpperCase()
    const [picks, queueRow, adpBoard] = await Promise.all([
      prisma.draftRoomPickRecord.findMany({
        where: { roomId: parsed.id },
        select: { overallPick: true, playerId: true, playerName: true, position: true, currentOwnerId: true },
        orderBy: { overallPick: 'asc' },
      }),
      args.clientQueueIds
        ? Promise.resolve(null)
        : prisma.draftRoomUserQueue.findUnique({
            where: { userId_sessionKey: { userId: args.userId, sessionKey: sessionId } },
            select: { playerIds: true },
          }),
      loadSleeperAdpBoard({ sport, take: MAX_BOARD_SIZE }).catch(() => null),
    ])

    const teamCount = Math.max(2, state.numTeams || order.length || 12)
    const rounds = Math.max(1, state.numRounds || 15)
    const queueIds =
      args.clientQueueIds ??
      (Array.isArray(queueRow?.playerIds) ? (queueRow.playerIds as unknown[]).filter((id): id is string => typeof id === 'string') : [])

    const teams = order.slice(0, teamCount).map((slot, index) => {
      const own = picks.filter((p) => p.currentOwnerId === slot.id && p.position)
      const positions = own.map((p) => ({ position: p.position as string }))
      return {
        slot: index + 1,
        managerName: slot.id === args.userId ? 'You' : cleanLabel(slot.label) || `Team ${index + 1}`,
        isUser: slot.id === args.userId,
        isCpu: slot.isCpu === true || slot.id.startsWith('cpu-'),
        picks: positions,
        rosterNeeds: computeTeamNeeds({ picks: positions, starterSlots: NFL_STARTERS })
          .filter((n) => n.tone === 'thin')
          .map((n) => n.position),
      }
    })

    const status = mockRoomStatus(state)
    const onClockSlot = slotIndexForOverallPick(state.currentPick, teamCount) + 1
    const userSlot = teams.find((t) => t.isUser)?.slot ?? null
    const secondsLeft =
      status === 'drafting' && onClockSlot === userSlot && state.timerEndsAt
        ? Math.max(0, Math.ceil((state.timerEndsAt.getTime() - (args.now ?? Date.now())) / 1000))
        : null

    const board = buildMockDraftBoard(
      {
        settings: {
          sport,
          scoring: room.scoringType || 'PPR',
          draftType: 'snake',
          teamCount,
          rounds,
          superflex: isSuperflex(room.rosterSettings),
          speed: state.timerSeconds || 0,
        },
        teams,
        availablePlayers: (adpBoard ?? []).map((p) => ({ id: p.id, name: p.name, position: p.position, team: p.team, adp: p.adp })),
        picks: picks
          .filter((p) => p.playerId)
          .map((p) => ({
            overall: p.overallPick,
            playerId: p.playerId as string,
            playerName: p.playerName ?? '',
            position: p.position ?? '',
            isUser: p.currentOwnerId === args.userId,
          })),
        currentPick: state.currentPick,
        status,
        userSecondsLeft: secondsLeft,
        slotAtOverall: (overall) => slotIndexForOverallPick(overall, teamCount) + 1,
        auction: null,
      },
      queueIds,
    )
    if (!board) return null
    const humans = teams.filter((t) => !t.isUser && !t.isCpu).map((t) => t.managerName)
    return { ...board, room: 'league', otherHumans: humans }
  } catch (error) {
    console.warn('[chimmy] league mock board unavailable', error instanceof Error ? error.message : error)
    return null
  }
}
