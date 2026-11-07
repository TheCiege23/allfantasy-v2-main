import 'server-only'

import { prisma } from '@/lib/prisma'
import { lookupProjections } from '@/lib/core-app/playerProjections'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import { resolveCurrentWeekForLeague } from '@/lib/core-app/currentWeek'
import { resolveByeWeekMap } from '@/lib/core-app/byeWeekMap'
import { readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { buildWeekKickoffMap, normalizeNflTeam } from '@/lib/redraft/lineupLock'

import { mergeSnapshotPlayers, type SnapshotPlayerMap } from './lineupLockSnapshotMerge'
import type { SnapshotSlot } from './lineupIntegrityScore'
import { lineupLockSnapshotsReady, readLineupLockSnapshots, upsertPlayers } from './lineupLockStore'

/**
 * Hourly: the Lineup Integrity snapshot for IMPORTED SLEEPER leagues — each team's players with the
 * projection, injury status and bye known before kickoff, each player frozen at his own game's kickoff.
 * The native writer (./lineupLockSnapshots.ts) reads the AllFantasy lineup screen; a Sleeper manager's
 * lineup screen is Sleeper's, which nothing here can see. So the projection is AllFantasy's, scored
 * under THIS league's own scoring settings (`computeLeagueProjectedPoints`) — the same number the app
 * shows for that league — and the commissioner report says so.
 *
 * DB-first: nothing here calls Sleeper. Roster players come from `Roster.playerData.players` (kept
 * current by the Sleeper sync), clubs from `SportsPlayer` by Sleeper id, projections from
 * `fantasy_projections`, injury status from `SportsInjury`, kickoffs and byes from `SportsGame`.
 *
 * ⚠ KEYED BY THE SLEEPER `roster_id`, the id the imported tanking flags already use
 * (`LeagueTeam.externalId` = `playerData.source_team_id`), so a score lands on the same team as its flag.
 * ⚠ NFL ONLY; a league whose starting slots cannot be read is skipped, never guessed.
 */

type Row = { id: string; playerData: unknown }

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((x) => x && x !== '0') : [])

export type SleeperSnapshotRunResult = { leagues: number; teams: number; written: number; skipped: Record<string, number>; failures: string[] }

export async function runSleeperLineupSnapshots(opts: { now?: Date; limit?: number; deadline?: number } = {}): Promise<SleeperSnapshotRunResult> {
  const now = opts.now ?? new Date()
  const deadline = opts.deadline ?? Date.now() + 25_000
  const out: SleeperSnapshotRunResult = { leagues: 0, teams: 0, written: 0, skipped: {}, failures: [] }
  const skip = (r: string) => (out.skipped[r] = (out.skipped[r] ?? 0) + 1)
  if (!(await lineupLockSnapshotsReady())) {
    skip('table_absent')
    return out
  }

  const leagues = await prisma.leagueIntegritySettings.findMany({
    where: { tankingMonitorEnabled: true, league: { platform: { equals: 'sleeper', mode: 'insensitive' }, platformLeagueId: { not: '' } } },
    select: { leagueId: true },
    orderBy: { leagueId: 'asc' },
    take: Math.max(1, Math.min(opts.limit ?? 40, 200)),
  })

  for (const { leagueId } of leagues) {
    if (Date.now() >= deadline) break
    out.leagues += 1
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true, platformLeagueId: true } })
      if (!league?.platformLeagueId || String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') {
        skip('not_nfl')
        continue
      }
      const seats = lineupSeatsFromSettings(league.settings)
      if (!seats || seats.length === 0) {
        skip('no_slots')
        continue
      }
      const slots: SnapshotSlot[] = seats.map((s) => ({ slot: s.slot, eligible: s.eligible }))
      const current = await resolveCurrentWeekForLeague(league.platformLeagueId)
      if (!current || current.seasonYear !== league.season) {
        skip('no_week')
        continue
      }
      const { week } = current
      const season = league.season

      const rosters = (await prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true } })) as Row[]
      const teams = rosters
        .map((r) => ({ teamId: String(asRecord(r.playerData).source_team_id ?? ''), players: ids(asRecord(r.playerData).players) }))
        .filter((t) => t.teamId && t.players.length > 0)
      const allIds = [...new Set(teams.flatMap((t) => t.players))]
      if (allIds.length === 0) {
        skip('no_rosters')
        continue
      }

      const [sports, projections, byes, kickoffs, prior] = await Promise.all([
        prisma.sportsPlayer.findMany({ where: { sport: 'NFL', sleeperId: { in: allIds } }, select: { sleeperId: true, name: true, team: true, position: true } }),
        lookupProjections(allIds, { season: String(season), week }, null, 'NFL'),
        resolveByeWeekMap(season, 'NFL'),
        buildWeekKickoffMap(prisma, { sport: 'NFL', season, week }).catch(() => null),
        readLineupLockSnapshots({ leagueId, season, weeks: [week] }),
      ])
      const player = new Map<string, { name: string; team: string | null; position: string | null }>()
      for (const p of sports) if (p.sleeperId && !player.has(p.sleeperId)) player.set(p.sleeperId, { name: p.name, team: p.team, position: p.position })
      const injuries = await readInjuryStatusById(
        'NFL',
        new Map([...player].map(([id, p]) => [id, [p.name]])),
        new Map([...player].map(([id, p]) => [id, p.team])),
        new Map([...player].map(([id, p]) => [id, p.position])),
      ).catch(() => new Map<string, string>())
      const scoring = extractScoringSettings(league.settings)
      const priorByTeam = new Map(prior.map((r) => [r.rosterId, r.players]))

      for (const team of teams) {
        if (Date.now() >= deadline) break
        out.teams += 1
        const currentRead: SnapshotPlayerMap = {}
        const locked = new Set<string>()
        for (const id of team.players) {
          const p = player.get(id)
          const proj = projections.get(id)
          const leaguePoints = proj?.componentStats ? computeLeagueProjectedPoints(proj.componentStats, scoring)?.points : undefined
          const club = p?.team ? p.team.toUpperCase() : null
          currentRead[id] = {
            name: p?.name ?? proj?.name ?? null,
            position: p?.position ?? proj?.position ?? null,
            proj: typeof leaguePoints === 'number' ? Math.round(leaguePoints * 10) / 10 : typeof proj?.projectedPoints === 'number' ? proj.projectedPoints : null,
            status: injuries.get(id) ?? null,
            bye: club && typeof byes[club] === 'number' ? byes[club] : null,
            team: club,
            frozenAt: null,
          }
          const kickoff = club ? kickoffs?.byTeam.get(normalizeNflTeam(club)) : undefined
          if (kickoff && kickoff.getTime() <= now.getTime()) locked.add(id)
        }
        const next = mergeSnapshotPlayers({ prior: priorByTeam.get(team.teamId) ?? null, current: currentRead, lockedIds: locked, nowIso: now.toISOString() })
        if (!next.changed) {
          skip('unchanged')
          continue
        }
        await upsertPlayers({ leagueId, rosterId: team.teamId, season, week, players: next.players, slots })
        out.written += 1
      }
    } catch (e) {
      out.failures.push(`${leagueId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}
