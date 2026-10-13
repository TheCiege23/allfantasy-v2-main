/**
 * /api/leagues/[leagueId]/commish-playoffs — the commish "Edit Playoff Bracket" tool.
 *
 * GET  → the bracket (rounds, matchups, seeds), every team, and whether it can still be reseeded.
 * POST → `{ action: 'reseed', seeds: [rosterId, …] }` (seed 1 first), `{ action: 'reset_seeds' }`
 *        (back to the standings), or `{ action: 'set_winner', matchupId, winnerRosterId }`.
 *
 * Commish or co-commish. The rules — reseeding only until round one is decided, winners only in a
 * round still being played — are in lib/league/commishPlayoffBracket.ts. Every edit is audited and
 * announced to the league.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import {
  CommishPlayoffError,
  executeCommishPlayoffEdit,
  loadCommishPlayoffBracket,
  reseedRefusal,
  type CommishPlayoffEdit,
} from '@/lib/league/commishPlayoffBracket'
import type { NflRedraftPlayoffRuntimeState } from '@/lib/playoff-runtime'
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
    return NextResponse.json({ error: 'Only the commish or a co-commish can edit the playoff bracket.' }, { status: 403 })
  }
  return { leagueId, userId }
}

/** The UI's view of the runtime state. Exported for tests. */
export function bracketPayload(state: NflRedraftPlayoffRuntimeState, seasonStatus: string) {
  const record = (t: { wins: number; losses: number; ties: number }) => `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`
  const teamById = new Map(state.teams.map((t) => [t.rosterId, t]))
  const side = (rosterId: string | null, seed: number | null) =>
    rosterId ? { rosterId, name: teamById.get(rosterId)?.displayName ?? `Team ${rosterId.slice(0, 6)}`, seed } : null
  return {
    seasonStatus,
    generated: state.bracket.generated,
    playoffTeamCount: state.settings.playoffTeamCount,
    seedingSource: state.seedingSource ?? 'standings',
    reseedBlocked: reseedRefusal(state, seasonStatus),
    seeds: state.seeds.map((s) => ({ seed: s.seed, rosterId: s.rosterId, name: s.displayName, record: record(s) })),
    teams: state.teams
      .map((t) => ({ rosterId: t.rosterId, name: t.displayName, record: record(t) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rounds: state.bracket.rounds.map((r) => ({
      roundNumber: r.roundNumber,
      roundName: r.roundName,
      status: r.status,
      matchups: r.matchups.map((m) => ({
        matchupId: m.matchupId,
        home: side(m.homeRosterId, m.homeSeed),
        away: side(m.awayRosterId, m.awaySeed),
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        winnerRosterId: m.bye ? null : m.winnerRosterId,
        bye: m.bye,
        commishPick: Boolean(m.metadata.commissionerOverride),
      })),
    })),
  }
}

/** Body → a typed edit, or null when the shape is wrong. Exported for tests. */
export function parseCommishPlayoffEdit(body: unknown): CommishPlayoffEdit | null {
  const b = (body ?? {}) as Record<string, unknown>
  if (b.action === 'reseed' && Array.isArray(b.seeds)) {
    return { action: 'reseed', seeds: b.seeds.map((s) => String(s ?? '').trim()) }
  }
  if (b.action === 'reset_seeds') return { action: 'reset_seeds' }
  if (b.action === 'set_winner' && typeof b.matchupId === 'string' && typeof b.winnerRosterId === 'string') {
    return { action: 'set_winner', matchupId: b.matchupId.trim(), winnerRosterId: b.winnerRosterId.trim() }
  }
  return null
}

function errorResponse(e: unknown) {
  if (e instanceof CommishPlayoffError) return NextResponse.json({ error: e.message }, { status: e.status })
  throw e
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  try {
    const { state, seasonStatus } = await loadCommishPlayoffBracket(auth.leagueId)
    return NextResponse.json(bracketPayload(state, seasonStatus))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await authorize(ctx)
  if (auth instanceof NextResponse) return auth
  const { leagueId, userId } = auth

  const edit = parseCommishPlayoffEdit(await req.json().catch(() => null))
  if (!edit) return NextResponse.json({ error: 'Unknown bracket edit.' }, { status: 400 })

  let result
  try {
    result = await executeCommishPlayoffEdit(leagueId, edit, userId)
  } catch (e) {
    return errorResponse(e)
  }

  await logAction({
    leagueId,
    userId,
    actionType: `commish_playoffs_${edit.action}`,
    entityType: 'playoff_bracket',
    entityId: leagueId,
    afterState: { edit, seeds: result.state.seeds.map((s) => ({ seed: s.seed, rosterId: s.rosterId })) } as never,
  }).catch(() => undefined)

  void import('@/lib/league-events/publisher')
    .then(({ publishLeagueFanoutEvent }) =>
      publishLeagueFanoutEvent({
        leagueId,
        eventType: 'commissioner_override',
        title: 'Commish playoff bracket update',
        message: edit.action === 'set_winner' ? 'The commish picked a playoff matchup winner.' : 'The commish reseeded the playoff bracket.',
        category: 'league_announcements',
        visibility: 'all_members',
        actorUserId: userId,
        meta: { action: edit.action },
        dedupeKey: `commish_playoffs:${leagueId}:${Date.now()}`,
      }),
    )
    .catch(() => {})

  return NextResponse.json({ ok: true, ...bracketPayload(result.state, result.seasonStatus) })
}
