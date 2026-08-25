import type { PrismaClient } from '@prisma/client'

import { isIdpPosition } from './scoringNotes'

/**
 * Snap share, from the game logs rather than from a provider feed.
 *
 * ⚠ THIS EXISTED FOR MONTHS AS A HARDCODED "NOT AVAILABLE". The player page shipped a section
 * reading "snap share is not ingested by any current provider" and the tile above it was deleted
 * as permanently empty. The columns were on disk the whole time — `off_snp` on 77% of game rows
 * and `tm_off_snp` on 89%, `def_snp` on 58% and `tm_def_snp` on 70%. Nobody had looked.
 *
 * It lives here, taking many ids, because two surfaces need it: the player page answers for one
 * player and the defence hub answers for a roster at a time. Copied rather than shared, the two
 * would drift and then disagree about the same player on the same afternoon.
 */

export interface SnapShareData {
  /** Player snaps ÷ team snaps, to three places. */
  share: number
  snaps: number
  teamSnaps: number
  /** How many games carried BOTH columns. This is the denominator the reader needs. */
  games: number
  basis: 'offense' | 'defense'
}

export type SnapShareOutcome =
  | { available: true; data: SnapShareData }
  | { available: false; reason: string }

export interface LoadSnapSharesArgs {
  prisma: PrismaClient
  sport?: string | null
  players: ReadonlyArray<{
    sleeperId: string | null | undefined
    position: string | null | undefined
  }>
  /** Most recent games to weigh per player. Matches what the player page has always used. */
  gamesPerPlayer?: number
}

export const DEFAULT_SNAP_GAMES = 40

/** The exact wording the player page has shipped; kept so the surface does not change. */
export const NO_SLEEPER_ID_REASON =
  'we hold no Sleeper id for this player, and the game logs are keyed by one'

export function missingColumnsReason(playerKey: string, teamKey: string): string {
  return `no game on file carries both ${playerKey} and ${teamKey} for this player`
}

/**
 * Resolve snap share for every player given, keyed by Sleeper id.
 *
 * ⚠ THE `take` THAT LOOKS RIGHT AND IS NOT. The single-player version reads the 40 most recent
 * logs. The obvious way to generalise it — one query with `playerId: { in: ids }` and
 * `take: 40 * ids.length` — silently truncates by the GLOBAL ordering instead of per player, so
 * anyone who has not played recently drops out entirely and reads as having no snap data at all.
 * The rows are sliced per player in memory for that reason. Pass a roster-sized id list.
 */
export async function loadSnapShares(
  args: LoadSnapSharesArgs,
): Promise<Map<string, SnapShareOutcome>> {
  const perPlayer = args.gamesPerPlayer ?? DEFAULT_SNAP_GAMES
  const out = new Map<string, SnapShareOutcome>()

  const wanted = new Map<string, boolean>()
  for (const p of args.players) {
    const id = p.sleeperId?.trim()
    if (!id) continue
    // First position wins; `SportsPlayer` carries duplicate rows per Sleeper id.
    if (!wanted.has(id)) wanted.set(id, isIdpPosition(p.position))
  }

  if (wanted.size === 0) return out

  const logs = await args.prisma.playerGameStat
    .findMany({
      where: { sportType: args.sport ?? 'NFL', playerId: { in: [...wanted.keys()] } },
      select: { playerId: true, normalizedStatMap: true },
      orderBy: [{ season: 'desc' }, { weekOrRound: 'desc' }],
    })
    .catch(() => [] as Array<{ playerId: string; normalizedStatMap: unknown }>)

  const byPlayer = new Map<string, unknown[]>()
  for (const log of logs) {
    const arr = byPlayer.get(log.playerId) ?? []
    if (arr.length >= perPlayer) continue
    arr.push(log.normalizedStatMap)
    byPlayer.set(log.playerId, arr)
  }

  for (const [id, defensive] of wanted) {
    /*
     * A linebacker's `off_snp` is special-teams noise, and a receiver's `def_snp` is a goal-line
     * package. Each side of the ball is read off its own columns or the number means nothing.
     */
    const playerKey = defensive ? 'def_snp' : 'off_snp'
    const teamKey = defensive ? 'tm_def_snp' : 'tm_off_snp'

    let snaps = 0
    let teamSnaps = 0
    let games = 0
    for (const raw of byPlayer.get(id) ?? []) {
      const m = (raw ?? {}) as Record<string, unknown>
      const p = m[playerKey]
      const t = m[teamKey]
      if (typeof p !== 'number' || typeof t !== 'number' || !(t > 0)) continue
      snaps += p
      teamSnaps += t
      games += 1
    }

    if (games === 0 || teamSnaps <= 0) {
      out.set(id, { available: false, reason: missingColumnsReason(playerKey, teamKey) })
      continue
    }

    /*
     * Totals summed, then divided ONCE. Averaging per-game shares lets a two-snap cameo count
     * for as much as a sixty-snap start, which reads as a part-time role for a full-time player.
     */
    out.set(id, {
      available: true,
      data: {
        share: Math.round((snaps / teamSnaps) * 1000) / 1000,
        snaps,
        teamSnaps,
        games,
        basis: defensive ? 'defense' : 'offense',
      },
    })
  }

  return out
}

/** One player, for the surfaces that hold one. Same computation, same wording. */
export async function loadSnapShare(
  prisma: PrismaClient,
  player: { sleeperId: string | null | undefined; position: string | null | undefined; sport?: string | null },
): Promise<SnapShareOutcome> {
  const id = player.sleeperId?.trim()
  if (!id) return { available: false, reason: NO_SLEEPER_ID_REASON }

  const map = await loadSnapShares({ prisma, sport: player.sport, players: [player] })
  return (
    map.get(id) ?? {
      available: false,
      reason: missingColumnsReason(
        isIdpPosition(player.position) ? 'def_snp' : 'off_snp',
        isIdpPosition(player.position) ? 'tm_def_snp' : 'tm_off_snp',
      ),
    }
  )
}
