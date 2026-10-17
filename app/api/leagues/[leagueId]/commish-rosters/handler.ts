/**
 * /api/leagues/[leagueId]/commish-rosters — the commish "Edit Rosters" tool.
 *
 * GET  → every team with its players and (dynasty) future picks.
 * POST → one edit: `{ action: 'add', rosterId, players: [{ id, name, position, team }] }`,
 *        `{ action: 'drop', rosterId, playerIds }` or `{ action: 'move', moves: [{ fromRosterId,
 *        toRosterId, playerIds?, pickRefs? }] }` (a switch is two moves in one request).
 *
 * Commish or co-commish. The work — both roster stores in one transaction, the integrity checks —
 * is in lib/league/commishRosterEdits.ts. Every edit is audited and announced to the league, so a
 * commish roster change is never invisible to the managers it affects.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { loadNativeFuturePicks } from '@/lib/league-trade-engine/nativeFuturePicks'
import { inventoryPickId } from '@/lib/league-trade-engine/futurePickInventory'
import {
  CommishRosterEditError,
  executeCommishRosterEdit,
  type CommishRosterEdit,
} from '@/lib/league/commishRosterEdits'
import { logAction } from '@/server/services/auditService'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> | { leagueId: string } }

async function authorize(ctx: Ctx): Promise<{ leagueId: string; userId: string } | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = ((await ctx.params)?.leagueId ?? '').trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!isCommissionerRole(await getLeagueRole(leagueId, userId))) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can edit rosters.' }, { status: 403 })
  }
  return { leagueId, userId }
}

async function teamsPayload(leagueId: string) {
  const [rosters, labels, futurePicks] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true, redraftRosterId: true } }),
    buildRosterLabelMap(leagueId),
    loadNativeFuturePicks(leagueId).catch(() => null),
  ])
  const redraftIds = rosters.map((r) => r.redraftRosterId).filter((x): x is string => Boolean(x))
  const rows = redraftIds.length
    ? await prisma.redraftRosterPlayer.findMany({
        where: { rosterId: { in: redraftIds }, droppedAt: null },
        select: { playerId: true, playerName: true, position: true, team: true },
      })
    : []
  const meta = new Map(rows.map((r) => [r.playerId, r]))
  const teams = rosters
    .map((r) => ({
      rosterId: r.id,
      name: labels.get(r.id) ?? `Team ${r.id.slice(0, 6)}`,
      players: getRosterPlayerIds(r.playerData).map((id) => {
        const m = meta.get(id)
        return { id, name: m?.playerName && m.playerName !== id ? m.playerName : id, position: m?.position ?? null, team: m?.team ?? null }
      }),
      picks: (futurePicks?.picks ?? [])
        .filter((p) => p.ownerTeamId === r.id)
        .map((p) => ({
          ref: inventoryPickId(p),
          season: p.season,
          round: p.round,
          originalTeam: p.originalTeamId === r.id ? null : (labels.get(p.originalTeamId) ?? null),
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { teams, picksSupported: futurePicks != null }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(await teamsPayload(auth.leagueId))
}

/** Body → a typed edit, or null when the shape is wrong. Exported for tests. */
export function parseCommishRosterEdit(body: unknown): CommishRosterEdit | null {
  const b = (body ?? {}) as Record<string, unknown>
  const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [])
  if (b.action === 'add' && Array.isArray(b.players)) {
    return {
      action: 'add',
      rosterId: String(b.rosterId ?? ''),
      players: b.players.map((p) => {
        const r = (p ?? {}) as Record<string, unknown>
        return {
          id: String(r.id ?? '').trim(),
          name: typeof r.name === 'string' ? r.name.slice(0, 80) : undefined,
          position: typeof r.position === 'string' ? r.position.slice(0, 8) : undefined,
          team: typeof r.team === 'string' ? r.team.slice(0, 8) : null,
        }
      }),
    }
  }
  if (b.action === 'drop') return { action: 'drop', rosterId: String(b.rosterId ?? ''), playerIds: strs(b.playerIds) }
  if (b.action === 'move' && Array.isArray(b.moves)) {
    return {
      action: 'move',
      moves: b.moves.map((m) => {
        const r = (m ?? {}) as Record<string, unknown>
        return {
          fromRosterId: String(r.fromRosterId ?? ''),
          toRosterId: String(r.toRosterId ?? ''),
          playerIds: strs(r.playerIds),
          pickRefs: strs(r.pickRefs),
        }
      }),
    }
  }
  return null
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  const { leagueId, userId } = auth

  const edit = parseCommishRosterEdit(await req.json().catch(() => null))
  if (!edit) return NextResponse.json({ error: 'Unknown roster edit.' }, { status: 400 })

  let result
  try {
    result = await executeCommishRosterEdit(leagueId, edit)
  } catch (e) {
    if (e instanceof CommishRosterEditError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  await logAction({
    leagueId,
    userId,
    actionType: `commish_roster_${edit.action}`,
    entityType: 'roster',
    entityId: result.changedRosterIds.join(','),
    afterState: { edit, result } as never,
  }).catch(() => undefined)

  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId,
        eventType: 'commissioner_override',
        title: 'Commish roster update',
        message: 'The commish changed a roster.',
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: userId,
        meta: { action: edit.action, rosterIds: result.changedRosterIds },
        dedupeKey: `commish_roster:${leagueId}:${Date.now()}`,
      }),
    )
    .catch(() => {})

  return NextResponse.json({ ok: true, result, ...(await teamsPayload(leagueId)) })
}
