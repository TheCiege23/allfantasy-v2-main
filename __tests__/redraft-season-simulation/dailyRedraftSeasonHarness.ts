/**
 * Full-season simulation of a native NBA or NHL redraft league, through the production engines.
 *
 * The NFL equivalent (`lib/redraft-season-simulation/canonicalNflRedraftFullSeasonSimulation.ts`) drives
 * the pure canonical runtimes. A daily sport's season cannot be simulated that way: daily lineups and
 * daily scoring, league median, the odd-team extra matchup, the standings writer, the playoff round
 * scorer, the season finalizer and the renewal all live in the Prisma-backed engines. So this drives
 * THOSE, unchanged, against the in-memory Prisma in `inMemoryPrisma.ts` (the caller mocks `@/lib/prisma`
 * with it). The only inputs the harness invents are the ones a provider and the managers would supply:
 * the league as creation would write it, the draft picks, daily stat lines, daily lineup saves and
 * waiver claims.
 *
 * Every step leaves a snapshot behind for the test to assert on.
 */
import { getDraftOrderEntry, type DraftRuntimeSlot } from '@/lib/draft-runtime/canonicalDraftRuntime'
import { buildDailyRedraftSettingsSnapshot } from '@/lib/league-concepts/dailySportRedraftDefaults'
import { applyPlayoffShapeToSettings, redraftPlayoffShapeFor } from '@/lib/league-defaults/redraftPlayoffFit'
import { getDailyRedraftRosterLayout } from '@/lib/sportConfig/dailySportRedraftRoster'
import { withLineupMode } from '@/lib/redraft/lineupModeSwitch'
import { dayKey, daysInWindow, writeDailyLineupForSave } from '@/lib/redraft/dailyLineups'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { ensureRedraftSeason, ensureScheduleForNewSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import { recalculateMatchupsForSeasonWeek, buildLeagueStatScorer, isScoringStarterSlot } from '@/lib/redraft/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { EXTRA_MATCHUP_SETTINGS_KEY } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { advanceNflRedraftScheduleWeek } from '@/lib/schedule-runtime/resolveNflRedraftScheduleRuntime'
import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import { rollPostseason } from '@/lib/season-week/rollSeasonWeek'
import { resolveCanonicalLeagueRules } from '@/lib/league-runtime'
import { renewNativeRedraft } from '@/lib/redraft/offseason/renewNativeRedraft'
import { renewRedraftLeague } from '@/lib/redraft/offseason/renewRedraftLeague'
import { rowsOf, type InMemoryPrisma } from './inMemoryPrisma'

export type DailySimSport = 'NBA' | 'NHL'

export type DailySimConfig = {
  sport: DailySimSport
  teamCount: number
  /** League median (a second game each week against the week's median score). */
  medianGame?: boolean
  /** Odd-team leagues: the leftover team plays an extra matchup instead of a bye. */
  extraMatchup?: boolean
  seed?: number
  /** The renewal modal's draft order choice (its default is `standings`); omitted sends none. */
  renewDraftOrder?: 'random' | 'standings' | 'reverse_standings'
  /** Moves the clock the engines read (`new Date()`), e.g. `vi.setSystemTime`. */
  setNow: (now: Date) => void
}

type Row = Record<string, any>

export type StandingRow = {
  rosterId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
}

export type WeekSnapshot = {
  week: number
  matchups: Row[]
  standings: StandingRow[]
  /** Head-to-head, median and extra-matchup results the week's rows imply, per roster. */
  expectedRecords: Map<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>
  /** Per roster: the week's score re-derived from that day's starters only. */
  dailyStarterPoints: Map<string, number>
  waivers: Array<{ claimId: string; status: string; reason?: string }>
  seasonStatus: string
}

export type PlayoffWeekSnapshot = {
  week: number
  scoreOutcome: string
  rollSteps: string[]
  standings: StandingRow[]
  bracketStatus: string | null
}

export type DailySimResult = {
  config: Omit<DailySimConfig, 'setNow'>
  leagueId: string
  seasonId: string
  rosterIds: string[]
  regularSeasonWeeks: number
  playoffStartWeek: number
  totalWeeks: number
  playoffTeams: number
  tiebreakers: string[]
  draft: { picks: number; uniquePlayers: number; slotOrder: DraftRuntimeSlot[] }
  schedule: Row[]
  weeks: WeekSnapshot[]
  standingsAtPlayoffStart: StandingRow[]
  bracket: { seeds: Row[]; rounds: Row[]; matchups: Row[]; structure: Row | null }
  playoffWeeks: PlayoffWeekSnapshot[]
  final: {
    seasonStatus: string
    leagueLifecycle: string | null
    championships: Row[]
    bracketStructure: Row | null
  }
  rollover: {
    result: Row
    nextSeason: Row | null
    nextRosters: Row[]
    nextRosterPlayers: Row[]
    nextDraft: Row | null
    previousDraft: Row | null
    leagueSeason: number | null
  }
}

const COMMISSIONER = 'user-commissioner'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash01(...parts: Array<string | number>): number {
  let h = 2166136261
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000
}

type PoolPlayer = { playerId: string; playerName: string; position: string; proTeam: string; quality: number }

function buildPlayerPool(sport: DailySimSport, count: number): PoolPlayer[] {
  const positions = sport === 'NBA' ? ['PG', 'SG', 'SF', 'PF', 'C'] : ['C', 'LW', 'RW', 'D', 'D', 'G']
  const out: PoolPlayer[] = []
  for (let i = 0; i < count; i += 1) {
    const position = positions[i % positions.length]!
    out.push({
      playerId: `${sport.toLowerCase()}-p${String(i + 1).padStart(4, '0')}`,
      playerName: `${sport} Player ${i + 1}`,
      position,
      proTeam: `T${(i * 7) % 30}`,
      // Rank order: earlier players are better, with some spread.
      quality: Math.max(0.05, 1 - i / count + (hash01('q', i) - 0.5) * 0.1),
    })
  }
  return out
}

/** Whether a pro team plays on a given day — about 3.5 games a week, the same for every league. */
function hasGame(proTeam: string, day: Date): boolean {
  return hash01('game', proTeam, dayKey(day)) < 0.5
}

function gameStats(sport: DailySimSport, player: PoolPlayer, day: Date): Record<string, number> {
  const r = (k: string) => hash01(k, player.playerId, dayKey(day))
  const q = player.quality
  if (sport === 'NBA') {
    return {
      pts: Math.round(6 + 24 * q * (0.6 + r('pts'))),
      reb: Math.round(2 + 9 * q * (0.5 + r('reb'))),
      ast: Math.round(1 + 7 * q * (0.5 + r('ast'))),
      stl: Math.round(2 * q * r('stl')),
      blk: Math.round(2 * q * r('blk')),
      to: Math.round(1 + 2 * r('to')),
      threes: Math.round(3 * q * r('3')),
    }
  }
  if (player.position === 'G') {
    const shots = 24 + Math.round(12 * r('sa'))
    const ga = Math.round(4 * (1.1 - q) * r('ga'))
    const win = r('w') < 0.35 + 0.4 * q ? 1 : 0
    return { g_win: win, g_sa: shots, g_sv: shots - ga, g_ga: ga, g_so: ga === 0 ? 1 : 0 }
  }
  return {
    g: r('g') < 0.15 + 0.35 * q ? 1 : 0,
    a: r('a') < 0.2 + 0.4 * q ? 1 : 0,
    sog: Math.round(1 + 4 * q * (0.5 + r('sog'))),
    blks: Math.round(2 * r('blk')),
    hits: Math.round(3 * r('hit')),
    pim: r('pim') < 0.2 ? 2 : 0,
    plusminus: Math.round(2 * (r('pm') - 0.5)),
    ppp: r('ppp') < 0.15 * q ? 1 : 0,
  }
}

function sumStats(lines: Array<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of lines) for (const [k, v] of Object.entries(line)) out[k] = (out[k] ?? 0) + v
  return out
}

function standingsOf(db: InMemoryPrisma, seasonId: string): StandingRow[] {
  return rowsOf(db, 'RedraftRoster')
    .filter((r) => r.seasonId === seasonId)
    .map((r) => ({
      rosterId: r.id,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      playoffSeed: r.playoffSeed,
    }))
}

/** Records the persisted matchup rows imply, read the way the product defines them (independent of the writer). */
function expectedRecordsFrom(
  matchups: Row[],
  rosterIds: string[],
  opts: { medianGame: boolean; playoffStartWeek: number },
) {
  const rec = new Map(rosterIds.map((id) => [id, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }]))
  const tally = (id: string, mine: number, theirs: number, countPoints: boolean) => {
    const row = rec.get(id)!
    if (countPoints) {
      row.pointsFor += mine
      row.pointsAgainst += theirs
    }
    if (mine > theirs) row.wins += 1
    else if (mine < theirs) row.losses += 1
    else row.ties += 1
  }
  const byWeek = new Map<number, Row[]>()
  for (const m of matchups) {
    if (m.status !== 'final') continue
    byWeek.set(m.week, [...(byWeek.get(m.week) ?? []), m])
  }
  for (const [week, rows] of byWeek) {
    const weekScores = new Map<string, number>()
    for (const m of rows) {
      if (m.awayRosterId) {
        tally(m.homeRosterId, m.homeScore, m.awayScore, true)
        tally(m.awayRosterId, m.awayScore, m.homeScore, true)
        weekScores.set(m.homeRosterId, m.homeScore)
        weekScores.set(m.awayRosterId, m.awayScore)
      } else {
        weekScores.set(m.homeRosterId, m.homeScore)
        const extra = m.lineupSnapshots?.extraMatchup
        if (extra) {
          const opp = rows.find((o) => o.homeRosterId === extra.opponentRosterId || o.awayRosterId === extra.opponentRosterId)
          const oppScore = opp ? (opp.homeRosterId === extra.opponentRosterId ? opp.homeScore : opp.awayScore) : null
          if (oppScore != null) {
            tally(m.homeRosterId, m.homeScore, oppScore, true)
            if (extra.scoring === 'both') tally(extra.opponentRosterId, oppScore, m.homeScore, false)
          }
        }
      }
    }
    if (opts.medianGame && week < opts.playoffStartWeek && weekScores.size > 1) {
      const sorted = [...weekScores.values()].sort((a, b) => a - b)
      const mid = sorted.length / 2
      const median = sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2
      for (const [id, score] of weekScores) tally(id, score, median, false)
    }
  }
  // A plain bye (no extra matchup) earns the week's median head-to-head score as points for, once
  // every game of that regular-season week is final; no result, no points against.
  for (const week of new Set(matchups.map((m) => m.week))) {
    if (week >= opts.playoffStartWeek) continue
    const weekRows = matchups.filter((m) => m.week === week && !m.isMedianMatchup)
    const games = weekRows.filter((m) => m.awayRosterId)
    if (!games.length || !games.every((m) => m.status === 'final' || m.status === 'completed')) continue
    const sorted = games.flatMap((g) => [g.homeScore, g.awayScore]).sort((a, b) => a - b)
    const mid = sorted.length / 2
    const median = sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2
    for (const bye of weekRows.filter((m) => !m.awayRosterId && !m.lineupSnapshots?.extraMatchup)) {
      const row = rec.get(bye.homeRosterId)
      if (row) row.pointsFor += Math.round(median * 100) / 100
    }
  }
  return rec
}

export async function runDailyRedraftFullSeason(db: InMemoryPrisma, config: DailySimConfig): Promise<DailySimResult> {
  const { sport, teamCount } = config
  const season = 2026
  const leagueId = `sim-${sport.toLowerCase()}-${teamCount}`
  const rand = mulberry32(config.seed ?? 7)

  // ------------------------------------------------------------ league, as creation writes it
  const shape = redraftPlayoffShapeFor({ sport, leagueSize: teamCount, leagueType: 'redraft' })
  if (!shape) throw new Error(`no redraft playoff shape for ${sport}`)
  const snapshot = buildDailyRedraftSettingsSnapshot({ sport, teamCount })!
  const settings: Row = applyPlayoffShapeToSettings(snapshot, shape)
  // Daily lineups are the commissioner's switch, opened before week 1 (lib/redraft/lineupModeSwitch.ts).
  settings.sportConfig = withLineupMode((settings.sportConfig as Row) ?? {}, 'daily')
  if (config.extraMatchup) settings[EXTRA_MATCHUP_SETTINGS_KEY] = { enabled: true, opponentRule: 'top_scorer', scoring: 'leftover_only' }
  const layout = getDailyRedraftRosterLayout(sport)!
  const draftable = Number(snapshot.roster_size)

  config.setNow(new Date('2026-09-01T16:00:00.000Z'))
  await db.league.create({
    data: {
      id: leagueId,
      userId: COMMISSIONER,
      platform: 'allfantasy',
      platformLeagueId: leagueId,
      name: `Sim ${sport} ${teamCount}`,
      sport,
      season,
      leagueSize: teamCount,
      leagueType: 'redraft',
      isDynasty: false,
      rosterSize: draftable,
      scoringPresetId: snapshot.scoring_preset_id,
      settings,
      playoffTeams: shape.playoffTeams,
      playoffStartWeek: shape.playoffStartWeek,
      playoffWeeksPerRound: 1,
      playoffSeedingRule: 'record_then_points',
      playoffLowerBracket: 'consolation',
      medianGame: Boolean(config.medianGame),
      status: 'active',
      lifecycleState: 'drafting',
    },
  })
  // The schema's (and creation's) default order method.
  await db.leagueSettings.create({ data: { leagueId, draftOrderMethod: 'manual' } })

  const teams = Array.from({ length: teamCount }, (_, i) => ({
    userId: `user-${i + 1}`,
    name: `Team ${String(i + 1).padStart(2, '0')}`,
  }))
  const genericRosters: Row[] = []
  for (const team of teams) {
    const roster = await db.roster.create({ data: { leagueId, platformUserId: team.userId, playerData: {} } })
    genericRosters.push(roster)
    await db.leagueTeam.create({
      data: {
        leagueId,
        externalId: roster.id,
        ownerName: team.name,
        teamName: team.name,
        platformUserId: team.userId,
        claimedByUserId: team.userId,
        isCommissioner: team.userId === 'user-1',
      },
    })
  }

  // ------------------------------------------------------------ season and draft
  const { season: seasonRow } = await ensureRedraftSeason(leagueId)
  const seasonId = seasonRow.id
  const redraftRosters: Row[] = []
  for (const [i, team] of teams.entries()) {
    const roster = await db.redraftRoster.create({
      data: { seasonId, leagueId, ownerId: team.userId, ownerName: team.name, teamName: team.name, faabBalance: 100, waiverPriority: i + 1 },
    })
    redraftRosters.push(roster)
    await db.roster.update({ where: { id: genericRosters[i]!.id }, data: { redraftRosterId: roster.id } })
  }
  const rosterIds = redraftRosters.map((r) => r.id)

  const slotOrder: DraftRuntimeSlot[] = rosterIds
    .map((rosterId, i) => ({ rosterId, i, r: rand() }))
    .sort((a, b) => a.r - b.r)
    .map((entry, index) => ({ slot: index + 1, rosterId: entry.rosterId, displayName: teams[entry.i]!.name, userId: teams[entry.i]!.userId }))

  const pool = buildPlayerPool(sport, teamCount * draftable + 8 * 6)
  // The player catalogue the waiver engine reads a claimed player's position from.
  await db.sportsPlayer.createMany({
    data: pool.map((p) => ({
      id: p.playerId,
      sport,
      externalId: p.playerId,
      name: p.playerName,
      position: p.position,
      team: p.proTeam,
      source: 'simulation',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    })),
  })
  const available = new Map(pool.map((p) => [p.playerId, p]))
  const openSlots = new Map(
    rosterIds.map((id) => [id, layout.starters.flatMap((s) => Array.from({ length: s.count }, () => ({ key: s.key, eligible: s.eligiblePositions })))]),
  )
  const benchLeft = new Map(rosterIds.map((id) => [id, layout.benchSlots]))
  let picks = 0
  const drafted = new Set<string>()
  for (let overall = 1; overall <= teamCount * draftable; overall += 1) {
    const order = getDraftOrderEntry({ overall, teamCount, draftType: 'snake', slotOrder })
    const slots = openSlots.get(order.rosterId)!
    // Best available player who fills an open starter seat; bench once the starters are full.
    const best = [...available.values()].find((p) => slots.some((s) => s.eligible.includes(p.position)))
    const pick = best ?? [...available.values()][0]!
    let slotType = 'BN'
    const seat = slots.findIndex((s) => s.eligible.includes(pick.position) && !s.eligible.includes('UTIL'))
    const seatIndex = best ? (seat >= 0 ? seat : slots.findIndex((s) => s.eligible.includes(pick.position))) : -1
    if (seatIndex >= 0) {
      slotType = slots[seatIndex]!.key
      slots.splice(seatIndex, 1)
    } else {
      benchLeft.set(order.rosterId, benchLeft.get(order.rosterId)! - 1)
    }
    available.delete(pick.playerId)
    drafted.add(pick.playerId)
    picks += 1
    await db.redraftRosterPlayer.create({
      data: {
        rosterId: order.rosterId,
        playerId: pick.playerId,
        playerName: pick.playerName,
        position: pick.position,
        team: pick.proTeam,
        sport,
        slotType,
        acquisitionType: 'draft',
        addedAt: new Date('2026-09-01T16:00:00.000Z'),
      },
    })
  }
  await db.draftSession.create({
    data: { leagueId, status: 'completed', sportType: sport, draftType: 'snake', rounds: draftable, teamCount, slotOrder },
  })
  await db.league.update({ where: { id: leagueId }, data: { lifecycleState: 'in_season' } })

  const fresh = await db.redraftSeason.findUnique({ where: { id: seasonId } })
  await ensureScheduleForNewSeason({
    seasonId,
    leagueId,
    sport: fresh.sport,
    totalWeeks: fresh.totalWeeks,
    playoffStartWeek: fresh.playoffStartWeek,
    medianGame: Boolean(fresh.medianGame),
  })
  const regularSeasonWeeks = fresh.playoffStartWeek - 1
  const rules = await resolveCanonicalLeagueRules(leagueId)
  const tiebreakers = (rules?.playoffs.tiebreakerRules ?? []) as string[]
  const scorer = buildLeagueStatScorer({ sport, settings })!
  const poolById = new Map(pool.map((p) => [p.playerId, p]))

  // ------------------------------------------------------------ the weeks
  const statsForWeek = async (week: number) => {
    const window = resolveDailySportWeekWindow(sport, season, week)
    if (!window) throw new Error(`${sport} ${season} week ${week} has no window`)
    // Past weeks' daily lines are never re-read once their week is sealed; keep the table small.
    await db.playerDailyScore.deleteMany({ where: { week: { lt: week - 1 } } })
    await db.playerWeeklyScore.deleteMany({ where: { week: { lt: week - 1 } } })
    const days = daysInWindow(window)
    for (const player of pool) {
      const lines: Array<Record<string, number>> = []
      for (const day of days) {
        if (!hasGame(player.proTeam, day)) continue
        const stats = gameStats(sport, player, day)
        lines.push(stats)
        await db.playerDailyScore.create({
          data: { playerId: player.playerId, sport, season, week, scoringDay: day, stats, gamesPlayed: 1, isFinalized: true },
        })
      }
      await db.playerWeeklyScore.create({
        data: { playerId: player.playerId, sport, season, week, stats: sumStats(lines), isFinalized: true },
      })
    }
    return { window, days }
  }

  /** A manager benches a starter with no game that day for a bench player who has one. */
  const dailyLineupMoves = async (week: number, days: Date[]) => {
    const moveDay = days[3]!
    for (const [index, rosterId] of rosterIds.entries()) {
      if ((index + week) % 2 !== 0) continue
      const players = rowsOf(db, 'RedraftRosterPlayer').filter((p) => p.rosterId === rosterId && p.droppedAt == null)
      const before = new Map(players.map((p) => [p.playerId, p.slotType]))
      const idle = players.find((p) => p.slotType !== 'BN' && !hasGame(p.team, moveDay))
      if (!idle) continue
      const seat = layout.starters.find((s) => s.key === idle.slotType)
      const sub = players.find((p) => p.slotType === 'BN' && hasGame(p.team, moveDay) && seat?.eligiblePositions.includes(p.position))
      if (!sub) continue
      config.setNow(new Date(moveDay.getTime() + 16 * 3_600_000))
      await db.redraftRosterPlayer.update({ where: { id: idle.id }, data: { slotType: 'BN' } })
      await db.redraftRosterPlayer.update({ where: { id: sub.id }, data: { slotType: idle.slotType } })
      await writeDailyLineupForSave(db as any, { leagueId, redraftRosterId: rosterId, sport, season, week, before, now: new Date(moveDay.getTime() + 16 * 3_600_000) })
    }
  }

  /** The week's score per roster, re-derived from each day's starters (the daily-lineup rule). */
  const dailyStarterPoints = (week: number, days: Date[]) => {
    const out = new Map<string, number>()
    const lineupsBy = new Map<string, Row[]>()
    for (const l of rowsOf(db, 'RedraftDailyLineup')) {
      if (l.scoringDay >= days[days.length - 1]!.getTime() + 86_400_000) continue
      const k = `${l.rosterId}|${l.playerId}`
      lineupsBy.set(k, [...(lineupsBy.get(k) ?? []), l])
    }
    const statsBy = new Map<string, Row>()
    for (const r of rowsOf(db, 'PlayerDailyScore')) if (r.week === week) statsBy.set(`${r.playerId}|${dayKey(r.scoringDay)}`, r)
    for (const rosterId of rosterIds) {
      const players = rowsOf(db, 'RedraftRosterPlayer').filter(
        (p) => p.rosterId === rosterId && (p.droppedAt == null || p.droppedAt >= days[0]!),
      )
      let total = 0
      for (const p of players) {
        const saves = lineupsBy.get(`${rosterId}|${p.playerId}`) ?? []
        for (const day of days) {
          const key = dayKey(day)
          if (p.addedAt && dayKey(p.addedAt) > key) continue
          if (p.droppedAt && dayKey(p.droppedAt) < key) continue
          // That day's save, else the latest earlier one, else the roster slot (`dailySlotFor`'s rule).
          let saved: Row | undefined
          for (const l of saves) if (dayKey(l.scoringDay) <= key && (!saved || l.scoringDay > saved.scoringDay)) saved = l
          const slot = saved?.slotType ?? p.slotType
          if (!isScoringStarterSlot(slot)) continue
          const line = statsBy.get(`${p.playerId}|${key}`)
          if (line) total += scorer(line.stats, p.position)
        }
      }
      out.set(rosterId, Math.round(total * 100) / 100)
    }
    return out
  }

  const waiverMoves = async (week: number) => {
    const claimant = rosterIds[week % rosterIds.length]!
    const roster = rowsOf(db, 'RedraftRosterPlayer').filter((p) => p.rosterId === claimant && p.droppedAt == null)
    const benchDrop = roster.filter((p) => p.slotType === 'BN').sort((a, b) => poolById.get(a.playerId)!.quality - poolById.get(b.playerId)!.quality)[0]
    if (!benchDrop) return []
    const rostered = new Set(rowsOf(db, 'RedraftRosterPlayer').filter((p) => p.droppedAt == null).map((p) => p.playerId))
    const target = pool.find((p) => !rostered.has(p.playerId) && p.position === benchDrop.position)
    if (!target) return []
    await db.redraftWaiverClaim.create({
      data: {
        seasonId,
        leagueId,
        rosterId: claimant,
        addPlayerId: target.playerId,
        addPlayerName: target.playerName,
        dropPlayerId: benchDrop.playerId,
        dropPlayerName: benchDrop.playerName,
        bidAmount: 3,
        priority: 1,
        status: 'pending',
      },
    })
    return processWaiverWindow(leagueId, seasonId)
  }

  const weeks: WeekSnapshot[] = []
  for (let week = 1; week <= regularSeasonWeeks; week += 1) {
    const { window, days } = await statsForWeek(week)
    config.setNow(new Date(window.start.getTime() + 12 * 3_600_000))
    await dailyLineupMoves(week, days)
    config.setNow(new Date(window.end.getTime() + 6 * 3_600_000))
    await recalculateMatchupsForSeasonWeek(seasonId, week)
    const starterPoints = dailyStarterPoints(week, days)
    const advanced = await advanceNflRedraftScheduleWeek({ seasonId, action: 'advance_week', week, actorUserId: COMMISSIONER })
    if (!advanced.ok) throw new Error(`advance week ${week} refused: ${advanced.code} ${advanced.message}`)
    const waivers = week < regularSeasonWeeks ? await waiverMoves(week) : []
    const matchups = rowsOf(db, 'RedraftMatchup').filter((m) => m.seasonId === seasonId)
    const seasonNow = await db.redraftSeason.findUnique({ where: { id: seasonId } })
    weeks.push({
      week,
      matchups: matchups.filter((m) => m.week === week).map((m) => ({ ...m })),
      standings: standingsOf(db, seasonId),
      expectedRecords: expectedRecordsFrom(
        matchups.filter((m) => m.week <= week),
        rosterIds,
        { medianGame: Boolean(config.medianGame), playoffStartWeek: fresh.playoffStartWeek },
      ),
      dailyStarterPoints: starterPoints,
      waivers,
      seasonStatus: seasonNow.status,
    })
  }

  const standingsAtPlayoffStart = standingsOf(db, seasonId)
  const bracketRow = rowsOf(db, 'RedraftPlayoffBracket').find((b) => b.seasonId === seasonId) ?? null
  const bracket = {
    seeds: rowsOf(db, 'RedraftPlayoffSeed').filter((s) => s.seasonId === seasonId).map((s) => ({ ...s })),
    rounds: rowsOf(db, 'RedraftPlayoffRound').filter((r) => r.seasonId === seasonId).map((r) => ({ ...r })),
    matchups: rowsOf(db, 'RedraftPlayoffMatchup').filter((m) => m.seasonId === seasonId).map((m) => ({ ...m })),
    structure: bracketRow ? { ...bracketRow.structure } : null,
  }

  // ------------------------------------------------------------ playoffs
  const playoffWeeks: PlayoffWeekSnapshot[] = []
  for (let week = fresh.playoffStartWeek; week <= fresh.totalWeeks + 2; week += 1) {
    const current = await db.redraftSeason.findUnique({ where: { id: seasonId } })
    if (current.status === 'complete') break
    if (week <= fresh.totalWeeks) {
      const { window } = await statsForWeek(week)
      config.setNow(new Date(window.end.getTime() + 6 * 3_600_000))
    }
    const scored = await scoreActivePlayoffRound(
      { seasonId, calendarWeek: Math.min(week, fresh.totalWeeks) },
      // The weekly rows the harness writes are already sealed; the finalizer's slate checks are its own suite's.
      { prisma: db as any, finalizeWeek: async () => ({ finalized: true }) as any },
    )
    // Standings may be recomputed in the playoffs (a stat correction): seeds and W-L must hold.
    await updateStandings(seasonId, Math.min(week, fresh.totalWeeks))
    const rollSteps: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const rolled = await rollPostseason({ prisma: db as any })
      const outcome = rolled.outcomes.find((o) => o.seasonId === seasonId)
      if (!outcome) break
      rollSteps.push(outcome.step + (outcome.detail ? `:${outcome.detail}` : ''))
      if (outcome.step !== 'advanced_round') break
    }
    const bracketNow = rowsOf(db, 'RedraftPlayoffBracket').find((b) => b.seasonId === seasonId)
    playoffWeeks.push({
      week,
      scoreOutcome: scored.outcome + (scored.lowerBracket ? `/${scored.lowerBracket.outcome}` : ''),
      rollSteps,
      standings: standingsOf(db, seasonId),
      bracketStatus: bracketNow?.status ?? null,
    })
  }

  const finalSeason = await db.redraftSeason.findUnique({ where: { id: seasonId } })
  const finalLeague = await db.league.findUnique({ where: { id: leagueId } })
  const final = {
    seasonStatus: finalSeason.status,
    leagueLifecycle: finalLeague?.lifecycleState ?? null,
    championships: rowsOf(db, 'LeagueChampionship').filter((c) => c.leagueId === leagueId).map((c) => ({ ...c })),
    bracketStructure: rowsOf(db, 'RedraftPlayoffBracket').find((b) => b.seasonId === seasonId)?.structure ?? null,
  }

  // ------------------------------------------------------------ rollover
  config.setNow(new Date('2027-05-15T16:00:00.000Z'))
  const previousDraft = rowsOf(db, 'DraftSession').find((d) => d.leagueId === leagueId) ?? null
  // The renew route's split: native NBA renews through `renewNativeRedraft`, every other sport through
  // `renewRedraftLeague` (app/api/commissioner/leagues/[leagueId]/renew/route.ts).
  const renewal =
    sport === 'NBA'
      ? await renewNativeRedraft({ leagueId, userId: COMMISSIONER, expectedSeason: season, draftOrder: config.renewDraftOrder })
      : await renewRedraftLeague(leagueId, COMMISSIONER, { draftOrder: config.renewDraftOrder })
  const nextSeason = rowsOf(db, 'RedraftSeason').find((s) => s.leagueId === leagueId && s.season === season + 1) ?? null
  const leagueAfter = await db.league.findUnique({ where: { id: leagueId } })
  const rollover = {
    result: renewal as Row,
    nextSeason,
    nextRosters: nextSeason ? rowsOf(db, 'RedraftRoster').filter((r) => r.seasonId === nextSeason.id) : [],
    nextRosterPlayers: nextSeason
      ? rowsOf(db, 'RedraftRosterPlayer').filter((p) => rowsOf(db, 'RedraftRoster').some((r) => r.id === p.rosterId && r.seasonId === nextSeason.id))
      : [],
    nextDraft:
      rowsOf(db, 'DraftSession').find(
        (d) => d.leagueId === leagueId && d.id === ((renewal as Row).draftSessionId ?? (renewal as Row).sessionId),
      ) ?? null,
    previousDraft,
    leagueSeason: leagueAfter?.season ?? null,
  }

  return {
    config: { sport, teamCount, medianGame: config.medianGame, extraMatchup: config.extraMatchup, seed: config.seed, renewDraftOrder: config.renewDraftOrder },
    leagueId,
    seasonId,
    rosterIds,
    regularSeasonWeeks,
    playoffStartWeek: fresh.playoffStartWeek,
    totalWeeks: fresh.totalWeeks,
    playoffTeams: shape.playoffTeams,
    tiebreakers,
    draft: { picks, uniquePlayers: drafted.size, slotOrder },
    schedule: rowsOf(db, 'RedraftMatchup').filter((m) => m.seasonId === seasonId).map((m) => ({ id: m.id, week: m.week, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId })),
    weeks,
    standingsAtPlayoffStart,
    bracket,
    playoffWeeks,
    final,
    rollover,
  }
}
