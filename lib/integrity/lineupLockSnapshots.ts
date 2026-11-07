import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { automaticLineup } from '@/lib/core-app/teamWorkspace'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { resolveFullLineupLockContext } from '@/lib/roster-lineup-engine/lineupLockService'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'

import { mergeSnapshotPlayers, type SnapshotPlayerMap } from './lineupLockSnapshotMerge'
import type { SnapshotSlot } from './lineupIntegrityScore'
import { lineupLockSnapshotsReady, readLineupLockSnapshots, upsertPlayers } from './lineupLockStore'

/**
 * Hourly: record what every manager in a monitored league can see — each player's projection, injury
 * status and bye — and FREEZE each player at their own game's kickoff. The week-close Lineup Integrity
 * score (lib/integrity/lineupIntegrityScore.ts) reads these rows instead of today's numbers.
 *
 * ⚠ ONLY LEAGUES WITH THE TANKING MONITOR ON. The score exists for that monitor; snapshotting every
 * league every hour would read 200 players per team for a number nobody looks at.
 *
 * ⚠ THE SAME READ THE MANAGER'S LINEUP SCREEN USES. `getNormalizedPlayerData({ surface: 'roster' })`
 * is what My Team renders, so the projection frozen here is the one they were shown — the same read
 * Chimmy's away-mode lineups and the eliminated-team minimums already use.
 *
 * ⚠ SHIPS BEFORE ITS MIGRATION: until it is applied `lineupLockSnapshotsReady()` answers false and the
 * run does nothing. Reads and writes live in ./lineupLockStore.ts, which readers import instead of this.
 */

export type LineupSnapshotRunResult = {
  leagues: number
  teams: number
  written: number
  skipped: Record<string, number>
  failures: { leagueId: string; rosterId?: string; error: string }[]
}

const DEFAULT_LEAGUE_LIMIT = 40

export async function runLineupLockSnapshots(opts?: { limit?: number; deadline?: number; now?: Date }): Promise<LineupSnapshotRunResult> {
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: LineupSnapshotRunResult = { leagues: 0, teams: 0, written: 0, skipped: {}, failures: [] }
  const skip = (reason: string) => (result.skipped[reason] = (result.skipped[reason] ?? 0) + 1)
  if (!(await lineupLockSnapshotsReady())) {
    skip('table_absent')
    return result
  }

  const monitored = await prisma.leagueIntegritySettings.findMany({
    where: { tankingMonitorEnabled: true },
    select: { leagueId: true },
    orderBy: { leagueId: 'asc' },
    take: Math.max(1, Math.min(opts?.limit ?? DEFAULT_LEAGUE_LIMIT, 200)),
  })

  for (const { leagueId } of monitored) {
    if (Date.now() >= deadline) break
    result.leagues += 1
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId } })
      if (!league) continue
      const status = String(league.status ?? league.lifecycleState ?? '').toLowerCase()
      const week = leagueWeekFromSettings(league.settings)
      const season = league.season
      const reason =
        resolveWriteAuthority(league.platform) !== 'NATIVE'
          ? 'not_native'
          : league.bestBallMode || automaticLineup(league.leagueType, league.settings)
            ? 'automatic_lineups'
            : !['active', 'in_season'].includes(status)
              ? 'not_in_season'
              : week == null || !season
                ? 'no_week'
                : null
      if (reason) {
        skip(reason)
        continue
      }
      const sport = String(league.sport ?? 'NFL')
      const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined), leagueId).catch(() => null)
      const slots: SnapshotSlot[] = resolveLineupStarterSlots(league as never, template).map((s) => ({ slot: s.label, eligible: s.allowedPositions }))
      if (slots.length === 0) {
        skip('no_slots')
        continue
      }

      const rosters = await prisma.roster.findMany({
        where: { leagueId, redraftRosterId: { not: null } },
        select: { id: true, platformUserId: true, playerData: true, redraftRosterId: true },
      })
      const prior = new Map(
        (await readLineupLockSnapshots({ leagueId, season: season!, weeks: [week!], rosterIds: rosters.map((r) => r.redraftRosterId!) })).map((r) => [r.rosterId, r]),
      )

      for (const roster of rosters) {
        if (Date.now() >= deadline) break
        result.teams += 1
        const flagRosterId = roster.redraftRosterId!
        try {
          if (!roster.platformUserId) {
            skip('no_owner')
            continue
          }
          const [rows, lock] = await Promise.all([
            getNormalizedPlayerData({ surface: 'roster', leagueId, userId: roster.platformUserId, limit: 200 }),
            resolveFullLineupLockContext({
              leagueId,
              rosterId: roster.id,
              sport,
              leagueVariant: league.leagueVariant as string | null,
              settings: league.settings,
              leagueWeek: week!,
              editingWeek: week!,
              season: season!,
              now: opts?.now ?? new Date(),
              playerData: roster.playerData,
              lockAllMoves: league.lockAllMoves,
              lifecycleState: league.lifecycleState,
            }).catch(() => null),
          ])
          const current: SnapshotPlayerMap = {}
          for (const p of rows.map(serializeUnifiedPlayerForApi)) {
            current[p.id] = {
              name: p.name ?? null,
              position: p.position ?? null,
              proj: typeof p.projectedPoints === 'number' ? p.projectedPoints : null,
              status: p.injuryStatus ?? null,
              bye: p.product?.byeWeek ?? null,
              team: p.team ?? null,
              frozenAt: null,
            }
          }
          const next = mergeSnapshotPlayers({
            prior: prior.get(flagRosterId)?.players ?? null,
            current,
            lockedIds: new Set(lock?.lockedPlayerIds ?? []),
            nowIso: (opts?.now ?? new Date()).toISOString(),
          })
          if (!next.changed) {
            skip('unchanged')
            continue
          }
          await upsertPlayers({ leagueId, rosterId: flagRosterId, season: season!, week: week!, players: next.players, slots })
          result.written += 1
        } catch (e) {
          result.failures.push({ leagueId, rosterId: flagRosterId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}
