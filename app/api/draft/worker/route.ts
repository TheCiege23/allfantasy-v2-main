import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseSessionKey } from '@/lib/draft/session-key'
import { slotIndexForOverallPick } from '@/lib/draft/snake'
import { executeDraftPick } from '@/lib/draft/execute-pick'
import { draftAiText } from '@/lib/draft/ai-claude'
import { loadSleeperAdpBoard, MAX_BOARD_SIZE, pickFromBoard } from '@/lib/draft/sleeperDraftBoard'

export const dynamic = 'force-dynamic'

async function nextAutopickPlayer(
  forUserId: string,
  sessionId: string,
  roomId: string | null,
  leagueId: string | null,
) {
  const where = roomId ? { roomId } : { leagueId: leagueId! }
  const taken = await prisma.draftRoomPickRecord.findMany({ where, select: { playerId: true } })
  const takenIds = new Set(taken.map((t) => t.playerId).filter(Boolean) as string[])

  const q = await prisma.draftRoomUserQueue.findUnique({
    where: { userId_sessionKey: { userId: forUserId, sessionKey: sessionId } },
  })
  const queued: unknown = q?.playerIds
  const ids = Array.isArray(queued) ? queued.map((id) => String(id ?? '')) : []

  /*
   * 🛑 QUEUED IDS AND THE FALLBACK BOTH RESOLVE AGAINST THE SLEEPER-ID BOARD (2026-10-11).
   *
   * This used to look a queued id up with `sportsPlayer.findFirst({ sport: 'NFL', externalId: pid })`
   * — no `source`, so a queued `2135` drafted Josh Allen (backfill) or Josh Hines-Allen (Rolling
   * Insights) depending on row order — and to fall back to the first 100 `SportsPlayer` rows by
   * NAME A→Z, so every auto pick took whoever sorted first. The board is the one place an id is
   * known to mean the player it was queued as; best available is by consensus ADP.
   */
  const board = (await loadSleeperAdpBoard({ sport: 'NFL', take: MAX_BOARD_SIZE }).catch(() => null)) ?? []
  const p = pickFromBoard(board, takenIds, ids)
  if (!p) return null
  return {
    playerId: p.id,
    playerName: p.name,
    position: p.position || 'UNK',
    team: p.team || null,
  }
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  let parsed: { mode: 'mock' | 'live'; id: string }
  try {
    parsed = parseSessionKey(sessionId)
  } catch {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  const state = await prisma.draftRoomStateRow.findUnique({ where: { id: sessionId } })
  if (!state || state.status === 'complete') {
    return NextResponse.json({ ok: true, message: 'Nothing to do' })
  }

  const whereCount = parsed.mode === 'mock' ? { roomId: parsed.id } : { leagueId: parsed.id }
  const existing = await prisma.draftRoomPickRecord.count({ where: whereCount })
  const overallPick = existing + 1
  const pickOrder = state.pickOrder as Array<{ id: string; label?: string }> | null
  if (!pickOrder?.length) {
    return NextResponse.json({ ok: false, error: 'No pick order' }, { status: 500 })
  }

  const slot = slotIndexForOverallPick(overallPick, state.numTeams)
  const onClock = pickOrder[slot]?.id
  if (!onClock) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const isCpu = onClock.startsWith('cpu-')
  const ap = await prisma.draftAutopickSetting.findUnique({
    where: { userId_sessionKey: { userId: onClock, sessionKey: sessionId } },
  })

  if (!isCpu && !ap?.enabled) {
    return NextResponse.json({ ok: true, message: 'No autopick' })
  }

  let player: { playerId: string | null; playerName: string; position: string; team: string | null } | null =
    await nextAutopickPlayer(
      onClock,
      sessionId,
      parsed.mode === 'mock' ? parsed.id : null,
      parsed.mode === 'live' ? parsed.id : null,
    )

  if (!player && !isCpu) {
    try {
      const text = await draftAiText(
        'You are Chimmy. Reply with JSON only: {"playerId":"","playerName":"","position":"","team":""} for best NFL pick.',
        'Suggest one player for a fantasy draft.',
        { userId: isCpu ? userId : onClock },
      )
      const j = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()) as Record<string, unknown>
      if (typeof j.playerName === 'string') {
        player = {
          /*
           * Never the model's `playerId`: an id a language model wrote names nobody we can verify,
           * and in this room a bare number is a Sleeper id — someone real, probably someone else.
           * The pick keeps the suggested name and no id.
           */
          playerId: null,
          playerName: j.playerName,
          position: typeof j.position === 'string' ? j.position : '',
          team: typeof j.team === 'string' ? j.team : null,
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!player) {
    return NextResponse.json({ ok: false, error: 'Could not resolve player' }, { status: 500 })
  }

  const actor = isCpu ? userId : onClock
  const result = await executeDraftPick({
    sessionId,
    userId: actor,
    playerId: player.playerId,
    playerName: player.playerName,
    position: player.position,
    team: player.team,
    autopicked: true,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  return NextResponse.json({ ok: true, overallPick: result.overallPick })
}
