import { prisma } from '@/lib/prisma'
import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { resolveSportForTrend } from './SportTrendContextResolver'
import { recordTrendSignalsAndUpdate, recordTrendSignal } from './PlayerTrendUpdater'
import type { TrendSignalType } from './types'

/** One player named by a caller. A bare string carries nothing to tell namesakes apart. */
export type TrendPlayerLookup = string | { name: string; position?: string | null; team?: string | null }

interface RecordByNameInput {
  players: TrendPlayerLookup[]
  sport: string | null | undefined
  signalType: TrendSignalType
  leagueId?: string
  value?: number
}

function teamKey(team: string | null | undefined, sport: string): string | null {
  const t = String(team ?? '').trim()
  if (!t) return null
  return sport.toUpperCase() === 'NFL' ? normalizeTeamAbbrev(t) : t.toUpperCase()
}

/**
 * Bind each named player to ONE `Player.id`, or to nothing.
 *
 * 🛑 A NAME USED TO BE EVERY ROW WITH THAT NAME (2026-10-11). `recordTrendSignalsByPlayerNames`
 * matched `name equals … insensitive` and recorded a signal for EVERY hit, so one AI waiver pick of
 * "Justin Jefferson" pushed both the Vikings receiver and the Browns linebacker up the trend feed,
 * and `PickSubmissionService` used `findFirst` by name — whichever row Postgres returned. A trend
 * signal is a public claim ("rising"), so a shared name binds only when position and/or team single
 * one row out (`resolveVerifiedMatch`), a lone row on the other side of the ball is refused, and
 * everything else is skipped. A skipped signal is a gap; a signal on the wrong man is a lie.
 *
 * Returns lookups in input order, each with its id or null.
 */
export async function resolveTrendPlayerIds(
  lookups: TrendPlayerLookup[],
  sportInput: string | null | undefined,
): Promise<Array<string | null>> {
  const wanted = lookups.map((l) => (typeof l === 'string' ? { name: l } : l))
  const names = [...new Set(wanted.map((l) => String(l.name || '').trim()).filter(Boolean))]
  if (names.length === 0) return wanted.map(() => null)

  const sport = resolveSportForTrend(sportInput)
  const rows = await prisma.player.findMany({
    where: {
      sport,
      OR: names.map((name) => ({
        name: { equals: name, mode: 'insensitive' },
      })),
    },
    select: { id: true, name: true, position: true, team: true },
  })
  const index = buildNameIndex(rows.map((r) => ({ ...r, team: teamKey(r.team, sport) })))
  return wanted.map((l) => {
    const name = String(l.name || '').trim()
    if (!name) return null
    const m = resolveVerifiedMatch(
      index,
      { name, position: l.position ?? null, team: teamKey(l.team, sport) },
      { refuseContradictedSingle: true },
    )
    return m.match?.id ?? null
  })
}

/**
 * Resolve players by name for a sport and record trend signals in one batch update.
 * Best effort only: unknown AND unverifiable names are skipped — see `resolveTrendPlayerIds`.
 */
export async function recordTrendSignalsByPlayerNames(
  input: RecordByNameInput
): Promise<number> {
  if (input.players.length === 0) return 0
  const sport = resolveSportForTrend(input.sport)
  const ids = [...new Set((await resolveTrendPlayerIds(input.players, sport)).filter((id): id is string => !!id))]
  if (ids.length === 0) return 0

  await recordTrendSignalsAndUpdate(
    ids.map((playerId) => ({
      playerId,
      sport,
      signalType: input.signalType,
      leagueId: input.leagueId,
      value: input.value,
    }))
  )
  return ids.length
}

interface RecordByIdInput {
  playerId: string | null | undefined
  sport: string | null | undefined
  signalType: TrendSignalType
  leagueId?: string
  value?: number
  updateAfter?: boolean
}

/**
 * Record a signal for a known player ID, with optional trend recompute.
 */
export async function recordTrendSignalByPlayerId(input: RecordByIdInput): Promise<void> {
  if (!input.playerId) return
  const sport = resolveSportForTrend(input.sport)

  if (input.updateAfter) {
    await recordTrendSignalsAndUpdate([
      {
        playerId: input.playerId,
        sport,
        signalType: input.signalType,
        leagueId: input.leagueId,
        value: input.value,
      },
    ])
    return
  }

  await recordTrendSignal(input.playerId, sport, input.signalType, {
    leagueId: input.leagueId,
    value: input.value,
  })
}
