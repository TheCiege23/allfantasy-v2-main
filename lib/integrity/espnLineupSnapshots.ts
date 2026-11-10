import 'server-only'

import { prisma } from '@/lib/prisma'
import { lookupProjections } from '@/lib/core-app/playerProjections'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'
import { importedLineupTemplateSlots } from '@/lib/league/importedLineupTemplate'
import { crosswalkToSleeperIds } from '@/lib/core-app/rosterIdCrosswalk'
import { resolveByeWeekMap } from '@/lib/core-app/byeWeekMap'
import { readInjuryStatusById } from '@/lib/core-app/injuryStatusById'
import { normalizeNflTeam } from '@/lib/redraft/lineupLock'
import { espnDefenseTeamAbbreviation } from '@/lib/league-import/espn/espnTeamDefenseIds'

import { captureStarters, snapshotSlotsFromTemplate, weekEnd, weekStarters, type SnapshotPlayerMap } from './espnStartersCapture'
import type { LineupCard } from './nativeLineupCards'
import { lineupLockSnapshotsReady, readLineupLockSnapshots, upsertPlayers } from './lineupLockStore'

/**
 * Hourly: the Lineup Integrity snapshot for IMPORTED ESPN leagues — each team's players with the
 * projection, injury status and bye known before kickoff, AND whether ESPN had the player in a starting
 * slot, read only from a roster fetched after his kickoff (the rules: ./espnStartersCapture.ts).
 *
 * DB-first: nothing here calls ESPN. Rosters and their fetch time come from the synced `Roster` rows,
 * ids are bridged to Sleeper's for projections through `PlayerIdentityMap.espnId`, kickoffs come from
 * the REGULAR-SEASON `SportsGame` rows only (several schedule sources carry preseason games with no
 * season type and reused week numbers), byes from `resolveByeWeekMap`.
 *
 * Keyed by the ESPN teamId (`playerData.source_team_id` = `LeagueTeam.externalId`), so a score lands
 * on the same team an imported flag names.
 *
 * ⚠ IT RECORDS ONLY WHAT THE SYNC FETCHED. If the ESPN roster sync is not running
 * (`FANTASY_OS_EXEC_SYNC_LIVE`), no roster is ever fetched after a kickoff and nothing is captured —
 * the week stays incomplete and is never scored, rather than scored from a stale lineup.
 * ⚠ NFL ONLY; a league whose slots cannot be read is skipped, never guessed.
 * ⚠ IT CANNOT RECOVER WEEKS PLAYED BEFORE IT RAN. That needs ESPN's per-week lineup, which has never
 * been captured (contracts/espn/GAPS.md `S-01`).
 */

export type EspnSnapshotRunResult = { leagues: number; teams: number; written: number; unmapped: number; skipped: Record<string, number>; failures: string[] }

type NflWeekContext = { season: number; week: number; kickoffByClub: Map<string, Date>; weekStartsAt: Date; weekEndsAt: Date }

const DAY_MS = 86_400_000

/**
 * The NFL week of the most recent REGULAR-SEASON kickoff, with its per-club kickoffs and its window.
 * Null outside the regular season. Read from `SportsGame`; no provider call.
 */
export async function readNflWeekContext(season: number, now: Date): Promise<NflWeekContext | null> {
  const latest = await prisma.sportsGame.findFirst({
    where: { sport: 'NFL', season, seasonType: 'regular', week: { gte: 1 }, startTime: { lte: now } },
    orderBy: { startTime: 'desc' },
    select: { week: true },
  })
  if (!latest?.week) return null
  return readNflWeekWindow(season, latest.week)
}

/** One regular-season NFL week's per-club kickoffs and its window (see `readNflWeekContext`). */
export async function readNflWeekWindow(season: number, week: number): Promise<NflWeekContext | null> {
  const games = await prisma.sportsGame.findMany({
    where: { sport: 'NFL', season, seasonType: 'regular', week: { in: [week - 1, week] }, startTime: { not: null } },
    select: { week: true, homeTeam: true, awayTeam: true, startTime: true },
  })
  const kickoffByClub = new Map<string, Date>()
  let first: Date | null = null
  let last: Date | null = null
  let prevLast: Date | null = null
  for (const g of games) {
    const at = g.startTime!
    if (g.week === week - 1) {
      if (!prevLast || at > prevLast) prevLast = at
      continue
    }
    if (!first || at < first) first = at
    if (!last || at > last) last = at
    for (const team of [g.homeTeam, g.awayTeam]) {
      const key = normalizeNflTeam(team)
      if (!key) continue
      const seen = kickoffByClub.get(key)
      if (!seen || at < seen) kickoffByClub.set(key, at)
    }
  }
  if (!first || !last) return null
  return {
    season,
    week,
    kickoffByClub,
    // Week 1 has no previous week on file: a roster read in the week before the opener still counts.
    weekStartsAt: prevLast ? weekEnd(prevLast) : new Date(first.getTime() - 7 * DAY_MS),
    weekEndsAt: weekEnd(last),
  }
}

/**
 * The week's lineup cards for the ESPN teams whose capture is COMPLETE (`weekStarters`): the week has
 * ended and every player who had a game was read after his kickoff. A team still missing a capture gets
 * no card, so the scorer records it as unscored — never as a lineup that started only the players
 * captured so far, which would read as a team that started almost nobody.
 */
export async function readEspnWeekCards(args: { leagueId: string; season: number; week: number; now?: Date }): Promise<{
  cards: Map<string, LineupCard>
  incomplete: Array<{ rosterId: string; uncaptured: number }>
  ended: boolean
}> {
  const now = args.now ?? new Date()
  const cards = new Map<string, LineupCard>()
  const incomplete: Array<{ rosterId: string; uncaptured: number }> = []
  const ctx = await readNflWeekWindow(args.season, args.week)
  if (!ctx) return { cards, incomplete, ended: false }
  const rows = await readLineupLockSnapshots({ leagueId: args.leagueId, season: args.season, weeks: [args.week] })
  for (const r of rows) {
    const players = r.players as SnapshotPlayerMap
    const kickoffById = new Map<string, Date>()
    for (const [id, p] of Object.entries(players)) {
      const at = p.team ? ctx.kickoffByClub.get(p.team) : undefined
      if (at) kickoffById.set(id, at)
    }
    const w = weekStarters(players, kickoffById, now, ctx.weekEndsAt)
    if (w.complete) cards.set(r.rosterId, { rosterId: r.rosterId, starters: w.starterIds.map((playerId) => ({ playerId })), bench: [] })
    else incomplete.push({ rosterId: r.rosterId, uncaptured: w.uncaptured.length })
  }
  return { cards, incomplete, ended: now.getTime() > ctx.weekEndsAt.getTime() }
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const ids = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((x) => x && x !== '0') : [])

export async function runEspnLineupSnapshots(opts: { now?: Date; limit?: number; deadline?: number } = {}): Promise<EspnSnapshotRunResult> {
  const now = opts.now ?? new Date()
  const deadline = opts.deadline ?? Date.now() + 25_000
  const out: EspnSnapshotRunResult = { leagues: 0, teams: 0, written: 0, unmapped: 0, skipped: {}, failures: [] }
  const skip = (r: string) => (out.skipped[r] = (out.skipped[r] ?? 0) + 1)
  if (!(await lineupLockSnapshotsReady())) {
    skip('table_absent')
    return out
  }

  const leagues = await prisma.leagueIntegritySettings.findMany({
    where: { tankingMonitorEnabled: true, league: { platform: { equals: 'espn', mode: 'insensitive' } } },
    select: { leagueId: true },
    orderBy: { leagueId: 'asc' },
    take: Math.max(1, Math.min(opts.limit ?? 40, 200)),
  })
  const weekBySeason = new Map<number, NflWeekContext | null>()

  for (const { leagueId } of leagues) {
    if (Date.now() >= deadline) break
    out.leagues += 1
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true, taxiSlots: true, irSlots: true, lastSyncedAt: true } })
      if (!league || String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') {
        skip('not_nfl')
        continue
      }
      const slots = snapshotSlotsFromTemplate(importedLineupTemplateSlots({ sport: 'NFL', settings: league.settings, taxiSlots: league.taxiSlots, irSlots: league.irSlots }))
      if (!slots) {
        skip('no_slots')
        continue
      }
      if (!weekBySeason.has(league.season)) weekBySeason.set(league.season, await readNflWeekContext(league.season, now))
      const ctx = weekBySeason.get(league.season)
      if (!ctx) {
        skip('no_week')
        continue
      }

      const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { playerData: true, updatedAt: true } })
      const teams = rosters.flatMap((r) => {
        const pd = asRecord(r.playerData)
        if (String(pd.source_provider ?? '').toLowerCase() !== 'espn') return []
        const teamId = String(pd.source_team_id ?? '')
        const players = ids(pd.players)
        if (!teamId || players.length === 0) return []
        // The earlier of the two clocks: a roster row touched by anything but a sync must not pass for a fetch.
        const fetchedAt = league.lastSyncedAt && league.lastSyncedAt < r.updatedAt ? league.lastSyncedAt : r.updatedAt
        return [{ teamId, players, starters: new Set(ids(pd.starters)), meta: asRecord(pd.player_metadata), fetchedAt }]
      })
      const allIds = [...new Set(teams.flatMap((t) => t.players))]
      if (allIds.length === 0) {
        skip('no_rosters')
        continue
      }

      // ESPN ids → Sleeper ids for projections; a defence is its club code.
      const bridged = await crosswalkToSleeperIds('espn', 'NFL', allIds.filter((id) => !espnDefenseTeamAbbreviation(id)))
      const sleeperOf = (id: string): string | null => {
        const dst = espnDefenseTeamAbbreviation(id)
        return dst ? normalizeNflTeam(dst) : (bridged.get(id) ?? null)
      }
      const sleeperIds = [...new Set(allIds.map(sleeperOf).filter((x): x is string => !!x))]
      out.unmapped += allIds.filter((id) => !sleeperOf(id)).length

      const [projections, byes, prior] = await Promise.all([
        lookupProjections(sleeperIds, { season: String(ctx.season), week: ctx.week }, null, 'NFL'),
        resolveByeWeekMap(ctx.season, 'NFL'),
        readLineupLockSnapshots({ leagueId, season: ctx.season, weeks: [ctx.week] }),
      ])
      const metaOf = (t: (typeof teams)[number], id: string) => {
        const m = asRecord(t.meta[id])
        const dst = espnDefenseTeamAbbreviation(id)
        return {
          name: typeof m.name === 'string' ? m.name : dst ? `${dst} D/ST` : null,
          // `snapshotImportedPlayerMetadata` drops a position that is also a slot name, which D/ST is.
          position: dst ? 'DST' : typeof m.position === 'string' ? m.position.toUpperCase() : null,
          club: dst ? normalizeNflTeam(dst) : typeof m.team === 'string' && m.team ? normalizeNflTeam(m.team) : null,
        }
      }
      const names = new Map<string, string[]>()
      const clubs = new Map<string, string | null>()
      const positions = new Map<string, string | null>()
      for (const t of teams) {
        for (const id of t.players) {
          const m = metaOf(t, id)
          if (m.name) names.set(id, [m.name])
          clubs.set(id, m.club)
          positions.set(id, m.position)
        }
      }
      const injuries = await readInjuryStatusById('NFL', names, clubs, positions).catch(() => new Map<string, string>())
      const scoring = extractScoringSettings(league.settings)
      const priorByTeam = new Map(prior.map((r) => [r.rosterId, r.players as SnapshotPlayerMap]))

      for (const team of teams) {
        if (Date.now() >= deadline) break
        out.teams += 1
        const current: SnapshotPlayerMap = {}
        const kickoffById = new Map<string, Date>()
        for (const id of team.players) {
          const m = metaOf(team, id)
          const sid = sleeperOf(id)
          const proj = sid ? projections.get(sid) : undefined
          const leaguePoints = proj?.componentStats ? computeLeagueProjectedPoints(proj.componentStats, scoring)?.points : undefined
          current[id] = {
            name: m.name ?? proj?.name ?? null,
            position: m.position ?? proj?.position ?? null,
            proj: typeof leaguePoints === 'number' ? Math.round(leaguePoints * 10) / 10 : typeof proj?.projectedPoints === 'number' ? proj.projectedPoints : null,
            status: injuries.get(id) ?? null,
            bye: m.club && typeof byes[m.club] === 'number' ? byes[m.club] : null,
            team: m.club,
            frozenAt: null,
            started: team.starters.has(id),
          }
          const kickoff = m.club ? ctx.kickoffByClub.get(m.club) : undefined
          if (kickoff) kickoffById.set(id, kickoff)
        }
        const next = captureStarters({ prior: priorByTeam.get(team.teamId) ?? null, current, kickoffById, fetchedAt: team.fetchedAt, weekStartsAt: ctx.weekStartsAt, weekEndsAt: ctx.weekEndsAt })
        if (next.ignored) {
          skip('roster_outside_week')
          continue
        }
        if (!next.changed) {
          skip('unchanged')
          continue
        }
        await upsertPlayers({ leagueId, rosterId: team.teamId, season: ctx.season, week: ctx.week, players: next.players, slots })
        out.written += 1
      }
    } catch (e) {
      out.failures.push(`${leagueId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}
