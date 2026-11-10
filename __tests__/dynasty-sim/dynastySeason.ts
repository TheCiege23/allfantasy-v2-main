/**
 * Dynasty season → playoffs → champion → offseason, on a league the draft harness just produced, through
 * the production engines:
 *
 *   per week   stat lines written as the ingest stores them → recalculateMatchupsForSeasonWeek (which runs
 *              updateStandings) — the same pair the score-sync cron runs
 *   playoffs   generateNflRedraftPlayoffRuntimeBracket → scoreActivePlayoffRound → advance…Round
 *   close      finalizeSeasonAndEnterOffseason — the production wrapper: champion, LeagueSeason /
 *              FranchiseSeason / SeasonResult history, record book and awards, keeper/dynasty offseason,
 *              next-season shell, rosters carried forward
 *
 * Stat generators are the existing full-season harness's (__tests__/helpers/redraftFullSeasonHarness.ts).
 * Expected values are computed here: the score from the starters' own stat lines, the record from the
 * harness's own ledger of results, the playoff field from that ledger.
 */
import type { InMemoryPrisma } from '../redraft-season-simulation/inMemoryPrisma'
import { rowsOf } from '../redraft-season-simulation/inMemoryPrisma'
import { dailyBoxLine, dailyNormalizer, easternDayKey, nflWeekStats, rngFor } from '../helpers/redraftFullSeasonHarness'
import { aggregateWeeklyStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import type { Finding, LeagueRun, SimEnv } from './dynastyHarness'

const DAY_MS = 86_400_000
const round2 = (n: number) => Math.round(n * 100) / 100

type Ledger = Map<string, { wins: number; losses: number; ties: number; pf: number; pa: number }>

export type SeasonFinding = Omit<Finding, 'stage'> & { stage: 'season' | 'playoffs' | 'offseason' }

function hashSkill(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return 2 + (h % 9)
}

const SCENARIOS = process.env.SIM_SCENARIOS === '1'

export async function runDynastySeason(env: SimEnv, run: LeagueRun): Promise<void> {
  const findings = run.findings as unknown as SeasonFinding[]
  const add = (f: SeasonFinding) => findings.push(f)
  const leagueId = run.leagueId
  if (!leagueId || run.stats.draftStatus !== 'completed') return
  const db = env.db
  const league = rowsOf(db, 'League').find((l: any) => l.id === leagueId) as any
  const season = rowsOf(db, 'RedraftSeason').find((s: any) => s.leagueId === leagueId && s.status === 'active') as any
  if (!season) return
  const seasonId = season.id as string
  const seasonYear = Number(season.season)
  const sport = run.sport
  const daily = sport !== 'NFL' && sport !== 'NCAAF'

  const { buildLeagueStatScorer, isScoringStarterSlot, recalculateMatchupsForSeasonWeek } = await import('@/lib/redraft/scoringEngine')
  const { updateStandings } = await import('@/lib/redraft/standingsEngine')
  const { resolveDailySportWeekWindow } = await import('@/lib/season-week/dailySportSeasonStarts')
  const scorer = buildLeagueStatScorer({ sport, settings: league.settings })
  // A daily sport scores by DAILY lineup only when the league turns that on; otherwise from the weekly line.
  const dailyLineups = daily && (await import('@/lib/redraft/dailyLineups')).isDailyLineupScoringEnabled(league.settings, sport)
  run.stats.dailyLineupScoring = dailyLineups
  if (!scorer) {
    add({ code: 'NO_SCORER', stage: 'season', message: `No stat scorer resolves for this ${sport} dynasty league.` })
    return
  }

  const rosterIds = (rowsOf(db, 'RedraftRoster').filter((r: any) => r.seasonId === seasonId) as any[]).map((r) => r.id as string)
  const skill = new Map(rosterIds.map((id) => [id, hashSkill(id)]))
  const scheduleWeeks = [...new Set((rowsOf(db, 'RedraftMatchup').filter((m: any) => m.seasonId === seasonId) as any[]).map((m) => Number(m.week)))].sort((a, b) => a - b)
  const regularWeeks = scheduleWeeks.length ? Math.max(...scheduleWeeks) : 0
  run.stats.regularWeeks = regularWeeks

  // ── Stat lines, as the ingest stores them ──
  const playerRows = () => (rowsOf(db, 'RedraftRosterPlayer') as any[]).filter((p) => rosterIds.includes(p.rosterId) && !p.droppedAt)
  // The ingest writes each line under the roster player's own sport, which is what scoring reads:
  // college football's season and roster rows say `NCAAFB` where the league says `NCAAF`.
  const statSport = (p: { sport?: string | null }) => p.sport || sport
  const writeWeek = async (week: number): Promise<boolean> => {
    const window = daily ? resolveDailySportWeekWindow(sport as never, seasonYear, week) : null
    if (daily && !window) {
      add({ code: 'NO_WEEK_WINDOW', stage: 'season', message: `${sport} ${seasonYear}: no scoring window for week ${week}.` })
      return false
    }
    for (const p of playerRows()) {
      const rng = rngFor(seasonYear, `${p.playerId}:${week}`)
      const s = skill.get(p.rosterId) ?? 5
      if (!daily) {
        await db.playerWeeklyScore.create({ data: { playerId: p.playerId, week, season: seasonYear, sport: statSport(p), stats: nflWeekStats(p.position, rng, s), isFinalized: true } })
        continue
      }
      const normalize = dailyNormalizer(sport as never)
      const lines: unknown[] = []
      for (let d = 0; d < 7; d += 1) {
        const line = dailyBoxLine(sport as never, p.position, rng, s, d)
        if (!line) continue
        lines.push(line)
        await db.playerDailyScore.create({
          data: { playerId: p.playerId, sport: statSport(p), season: seasonYear, week, scoringDay: new Date(window!.start.getTime() + d * DAY_MS), stats: normalize(line).stats, gamesPlayed: 1, isFinalized: true },
        })
      }
      // The ingest also rolls the days into a weekly line; a league scored by weekly lineup reads that.
      await db.playerWeeklyScore.create({
        data: { playerId: p.playerId, week, season: seasonYear, sport: statSport(p), stats: aggregateWeeklyStats(lines, normalize).stats, isFinalized: true },
      })
    }
    return true
  }
  const clearStats = () => {
    // Scenarios keep every week's lines: Max PF (the rookie order) is computed from all of them.
    if (SCENARIOS) return
    db.$tables.set('PlayerWeeklyScore', [])
    db.$tables.set('PlayerDailyScore', [])
  }

  /** A team's score by the league's rules, from its own starters' lines — computed here, not by the engine. */
  const expectedScore = (rosterId: string, week: number): number => {
    let total = 0
    const starters = playerRows().filter((p) => p.rosterId === rosterId && isScoringStarterSlot(p.slotType))
    if (!daily || !dailyLineups) {
      for (const p of starters) {
        const row = (rowsOf(db, 'PlayerWeeklyScore') as any[]).find((r) => r.playerId === p.playerId && r.week === week)
        if (row) total += scorer(row.stats, p.position)
      }
      return round2(total)
    }
    // Only this week's days: with the scenarios on, earlier weeks' lines are kept.
    const window = resolveDailySportWeekWindow(sport as never, seasonYear, week)
    const inWeek = (day: unknown) => {
      const t = new Date(day as string | Date).getTime()
      return !window || (t >= window.start.getTime() && t < window.end.getTime())
    }
    const byPlayer = new Set(starters.map((p) => p.playerId))
    const rows = (rowsOf(db, 'PlayerDailyScore') as any[]).filter((r) => byPlayer.has(r.playerId) && inWeek(r.scoringDay))
    for (const p of starters) {
      for (const row of rows.filter((r) => r.playerId === p.playerId)) total += scorer(row.stats, p.position)
    }
    return round2(total)
  }

  // ── Regular season ──
  const ledger: Ledger = new Map(rosterIds.map((id) => [id, { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 }]))
  let scoreMismatches = 0
  let standingsMismatches = 0
  for (let week = 1; week <= regularWeeks; week += 1) {
    await db.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: week } })
    if (!(await writeWeek(week))) break
    try {
      await recalculateMatchupsForSeasonWeek(seasonId, week)
      await updateStandings(seasonId, week)
    } catch (e) {
      add({ code: 'WEEK_SCORING_THREW', stage: 'season', message: `Week ${week}: ${(e as Error).message}` })
      break
    }
    for (const m of (rowsOf(db, 'RedraftMatchup') as any[]).filter((x) => x.seasonId === seasonId && x.week === week && x.awayRosterId)) {
      for (const [rid, engineScore] of [[m.homeRosterId, m.homeScore], [m.awayRosterId, m.awayScore]] as const) {
        const expected = expectedScore(rid, week)
        if (Math.abs(Number(engineScore ?? 0) - expected) > 0.011) {
          scoreMismatches += 1
          if (scoreMismatches <= 3) add({ code: 'TEAM_SCORE_WRONG', stage: 'season', message: `Week ${week}: ${rid} scored ${engineScore}; its starters' lines add to ${expected}.` })
        }
      }
      const h = ledger.get(m.homeRosterId)!
      const a = ledger.get(m.awayRosterId)!
      const hs = Number(m.homeScore ?? 0)
      const as = Number(m.awayScore ?? 0)
      h.pf += hs
      h.pa += as
      a.pf += as
      a.pa += hs
      if (hs > as) (h.wins += 1), (a.losses += 1)
      else if (as > hs) (a.wins += 1), (h.losses += 1)
      else (h.ties += 1), (a.ties += 1)
      if (m.status !== 'final' && m.status !== 'completed') {
        run.stats.matchupsNotFinal = Number(run.stats.matchupsNotFinal ?? 0) + 1
      }
    }
    for (const r of (rowsOf(db, 'RedraftRoster') as any[]).filter((x) => x.seasonId === seasonId)) {
      const mine = ledger.get(r.id)!
      if (r.wins !== mine.wins || r.losses !== mine.losses || r.ties !== mine.ties || Math.abs(Number(r.pointsFor) - mine.pf) > 0.05 * week + 0.01) {
        standingsMismatches += 1
        if (standingsMismatches <= 3) add({ code: 'STANDINGS_WRONG', stage: 'season', message: `Week ${week}: ${r.id} shows ${r.wins}-${r.losses}-${r.ties} (${r.pointsFor} PF); results say ${mine.wins}-${mine.losses}-${mine.ties} (${round2(mine.pf)} PF).` })
      }
    }
    clearStats()
    const scenarioCtx = { seasonId, week, regularWeeks, add: add as never }
    if (SCENARIOS) {
      const sc = await import('./dynastyScenarios')
      await sc.beforeWeekScoring(env, run, scenarioCtx)
      await sc.weeklyScenarios(env, run, scenarioCtx)
    }
    // Mid-season trading window, well before the deadline.
    if (process.env.SIM_TRADES !== '0' && week === Math.min(6, Math.max(1, regularWeeks - 2))) {
      const { runDynastyTrades } = await import('./dynastyTrades')
      await runDynastyTrades(env, run, { seasonId, week }, add as never)
      if (SCENARIOS) {
        const sc = await import('./dynastyScenarios')
        await sc.collusionConsequences(env, run, scenarioCtx).catch((e: Error) => add({ code: 'SCENARIO_THREW', stage: 'season', message: `collusion: ${e.message}` }))
        if (run.leagueType !== 'redraft') await sc.secondRoundPickTrade(env, run, scenarioCtx).catch((e: Error) => add({ code: 'SCENARIO_THREW', stage: 'season', message: `pick trade: ${e.message}` }))
      }
    }
  }
  if (SCENARIOS) (await import('./dynastyScenarios')).checkTankingConsequences(env, run, add as never)
  run.stats.scoreMismatches = scoreMismatches
  run.stats.standingsMismatches = standingsMismatches

  // ── Playoffs ──
  const { generateNflRedraftPlayoffRuntimeBracket, advanceNflRedraftPlayoffRuntimeRound } = await import('@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime')
  const { scoreActivePlayoffRound } = await import('@/lib/playoff-runtime/playoffRoundScoring')
  const playoffStart = regularWeeks + 1
  await db.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: playoffStart } })
  try {
    await generateNflRedraftPlayoffRuntimeBracket({ seasonId, actorUserId: run.commissionerId, lockBracket: true })
  } catch (e) {
    add({ code: 'PLAYOFF_BRACKET_FAILED', stage: 'playoffs', message: (e as Error).message })
    return
  }
  const seeded = (rowsOf(db, 'RedraftRoster') as any[]).filter((r) => r.seasonId === seasonId && r.playoffSeed != null)
  run.stats.playoffTeams = seeded.length
  checkPlayoffField(ledger, seeded, add)

  const advances: string[] = []
  for (let week = playoffStart; week < playoffStart + 6; week += 1) {
    await db.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: week } })
    if (!(await writeWeek(week))) break
    try {
      await updateStandings(seasonId, week)
      await scoreActivePlayoffRound({ seasonId, calendarWeek: week }, { finalizeWeek: (async () => ({ finalized: true, alreadyFinal: false })) as never })
      for (let guard = 0; guard < 4; guard += 1) {
        const adv = (await advanceNflRedraftPlayoffRuntimeRound({ seasonId, week, actorUserId: run.commissionerId })) as any
        advances.push(adv.ok ? adv.status : adv.code)
        if (!adv.ok) break
      }
    } catch (e) {
      add({ code: 'PLAYOFF_WEEK_THREW', stage: 'playoffs', message: `Week ${week}: ${(e as Error).message}` })
      break
    }
    clearStats()
    // The bracket is played out once the engine reports nothing left to advance.
    if (advances[advances.length - 1] === 'NO_ACTIVE_ROUND') break
  }
  run.stats.playoffAdvances = advances

  // ── Close the season the production way ──
  const { finalizeSeasonAndEnterOffseason } = await import('@/lib/redraft/offseason/finalizeSeasonAndEnterOffseason')
  let closed: any
  try {
    closed = await finalizeSeasonAndEnterOffseason({ seasonId, leagueId, actorUserId: run.commissionerId })
  } catch (e) {
    add({ code: 'SEASON_CLOSE_THREW', stage: 'offseason', message: (e as Error).message })
    return
  }
  run.stats.seasonClose = { ok: closed?.ok, code: closed?.code, champion: closed?.championRosterId ?? closed?.champion?.rosterId ?? null }
  const seasonAfter = rowsOf(db, 'RedraftSeason').find((s: any) => s.id === seasonId) as any
  const championId = (closed?.championRosterId ?? seasonAfter?.championRosterId ?? null) as string | null
  run.stats.championRosterId = championId
  if (!championId) add({ code: 'NO_CHAMPION', stage: 'playoffs', message: `Season closed without a champion (${closed?.code ?? closed?.reason ?? 'no reason'}).` })
  else if (!seeded.some((r) => r.id === championId)) add({ code: 'CHAMPION_NOT_A_PLAYOFF_TEAM', stage: 'playoffs', message: `${championId} won the title without a playoff seed.` })

  // ── Offseason state ──
  const leagueAfter = rowsOf(db, 'League').find((l: any) => l.id === leagueId) as any
  run.stats.lifecycleAfterClose = leagueAfter?.lifecycleState
  const history = {
    leagueSeasons: rowsOf(db, 'LeagueSeason').filter((r: any) => r.leagueId === leagueId).length,
    franchiseSeasons: rowsOf(db, 'FranchiseSeason').filter((r: any) => r.leagueId === leagueId).length,
    seasonResults: rowsOf(db, 'SeasonResult').filter((r: any) => r.leagueId === leagueId).length,
  }
  run.stats.history = history
  if (history.franchiseSeasons !== run.teamCount) add({ code: 'FRANCHISE_HISTORY_INCOMPLETE', stage: 'offseason', message: `${history.franchiseSeasons} franchise-season rows for ${run.teamCount} teams — rankings read these.` })
  if (history.seasonResults !== run.teamCount) add({ code: 'SEASON_RESULTS_INCOMPLETE', stage: 'offseason', message: `${history.seasonResults} season results for ${run.teamCount} teams — legacy and hall of fame read these.` })

  if (run.leagueType === 'redraft') {
    await runRankings(env, run, championId, add)
    await runRedraftRenewal(env, run, { seasonId, rosterIds, ledger, championId }, add)
    return
  }
  const next = (rowsOf(db, 'RedraftSeason') as any[]).filter((s) => s.leagueId === leagueId && s.id !== seasonId)
  run.stats.nextSeasons = next.map((s) => ({ season: s.season, status: s.status }))
  if (!next.length) {
    add({ code: 'NO_NEXT_SEASON', stage: 'offseason', message: 'The dynasty league has no year-2 season after the offseason started.' })
    return
  }
  // Rosters carried: every owner keeps exactly the players they ended year 1 with.
  const year1 = new Map<string, Set<string>>()
  const ownerOf = new Map((rowsOf(db, 'RedraftRoster') as any[]).map((r) => [r.id, r.ownerId]))
  for (const p of (rowsOf(db, 'RedraftRosterPlayer') as any[]).filter((p) => rosterIds.includes(p.rosterId) && !p.droppedAt)) {
    const owner = ownerOf.get(p.rosterId)!
    year1.set(owner, (year1.get(owner) ?? new Set()).add(p.playerId))
  }
  const nextRosterIds = new Set((rowsOf(db, 'RedraftRoster') as any[]).filter((r) => r.seasonId === next[0].id).map((r) => r.id))
  const year2 = new Map<string, Set<string>>()
  for (const p of (rowsOf(db, 'RedraftRosterPlayer') as any[]).filter((p) => nextRosterIds.has(p.rosterId) && !p.droppedAt)) {
    const owner = ownerOf.get(p.rosterId)!
    year2.set(owner, (year2.get(owner) ?? new Set()).add(p.playerId))
  }
  let lost = 0
  let gained = 0
  for (const [owner, players] of year1) {
    const kept = year2.get(owner) ?? new Set()
    for (const id of players) if (!kept.has(id)) lost += 1
    for (const id of kept) if (!players.has(id)) gained += 1
  }
  run.stats.carryover = { owners: year1.size, lost, gained }
  if (lost || gained) add({ code: 'DYNASTY_ROSTER_NOT_CARRIED', stage: 'offseason', message: `Year 2 rosters differ from year 1's: ${lost} player(s) lost, ${gained} appeared.` })

  await runRankings(env, run, championId, add)
  if (SCENARIOS) {
    const sc = await import('./dynastyScenarios')
    await sc.takeover(env, run, { add: add as never, seasonId, week: 0 }, (run.stats.scenarios ??= {}) as Record<string, any>, 'offseason').catch((e: Error) => add({ code: 'SCENARIO_THREW', stage: 'offseason', message: `offseason takeover: ${e.message}` }))
  }
  run.stats.playoffStart = playoffStart
  await runRookieDraft(env, run, { ledger, championId, runnerUpId: (closed?.runnerUpRosterId ?? null) as string | null, year1RosterIds: rosterIds, year1, nextSeasonId: next[0].id }, add)
}

// ── Redraft renewal → year 2: the commissioner's Renew, then a fresh season and a fresh draft ──
async function runRedraftRenewal(
  env: SimEnv,
  run: LeagueRun,
  ctx: { seasonId: string; rosterIds: string[]; ledger: Ledger; championId: string | null },
  add: (f: SeasonFinding) => void,
): Promise<void> {
  const db = env.db
  const leagueId = run.leagueId!
  const year1 = rowsOf(db, 'RedraftSeason').find((s: any) => s.id === ctx.seasonId) as any
  const ownerOf = new Map((rowsOf(db, 'RedraftRoster') as any[]).filter((r) => ctx.rosterIds.includes(r.id)).map((r) => [r.id, String(r.ownerId)]))
  const year1Owners = new Set(ownerOf.values())

  env.signIn({ id: run.commissionerId, email: 'commish@sim.allfantasy.test', name: 'Sim Commish' } as never)
  const route = await import('@/app/api/commissioner/leagues/[leagueId]/renew/route')
  const { NextRequest } = await import('next/server')
  const view = await route.GET(new NextRequest(`http://sim.allfantasy.test/api/commissioner/leagues/${leagueId}/renew`), { params: Promise.resolve({ leagueId }) } as never)
  run.stats.renewView = { status: view.status }
  if (view.status !== 200) add({ code: 'RENEW_SCREEN_NOT_READABLE', stage: 'offseason', message: `The renew screen returned ${view.status}.` })
  const res = await route.POST(
    new NextRequest(`http://sim.allfantasy.test/api/commissioner/leagues/${leagueId}/renew`, { method: 'POST', body: JSON.stringify({ draftOrder: 'standings' }) }),
    { params: Promise.resolve({ leagueId }) } as never,
  )
  const body = (await res.json().catch(() => null)) as any
  run.stats.renewal = { status: res.status, error: body?.error ?? null }
  if (res.status !== 200) {
    add({ code: 'RENEWAL_REFUSED', stage: 'offseason', message: `Renew returned ${res.status}: ${JSON.stringify(body).slice(0, 240)}` })
    return
  }

  // A fresh season, one year on.
  const next = (rowsOf(db, 'RedraftSeason') as any[]).filter((s) => s.leagueId === leagueId && s.id !== ctx.seasonId)
  run.stats.nextSeasons = next.map((s) => ({ season: s.season, status: s.status }))
  const season2 = next.find((s) => Number(s.season) === Number(year1?.season) + 1) ?? next[0]
  if (!season2) {
    add({ code: 'NO_NEXT_SEASON', stage: 'offseason', message: 'Renewal returned 200 but the league has no year-2 season.' })
    return
  }
  if (Number(season2.season) !== Number(year1?.season) + 1) add({ code: 'NEXT_SEASON_WRONG_YEAR', stage: 'offseason', message: `Year 1 was ${year1?.season}; the renewed season is ${season2.season}.` })

  // Every manager is still in the league, each with an EMPTY roster: a redraft league starts over.
  const rosters2 = (rowsOf(db, 'RedraftRoster') as any[]).filter((r) => r.seasonId === season2.id)
  const owners2 = new Set(rosters2.map((r) => String(r.ownerId)))
  const missing = [...year1Owners].filter((o) => !owners2.has(o))
  if (rosters2.length !== run.teamCount) add({ code: 'RENEWED_ROSTER_COUNT', stage: 'offseason', message: `${rosters2.length} season-2 rosters for a ${run.teamCount}-team league.` })
  if (missing.length) add({ code: 'MANAGER_LOST_AT_RENEWAL', stage: 'offseason', message: `${missing.length} manager(s) have no season-2 team: ${missing.slice(0, 3).join(', ')}.` })
  const ids2 = new Set(rosters2.map((r) => r.id))
  const kept = (rowsOf(db, 'RedraftRosterPlayer') as any[]).filter((p) => ids2.has(p.rosterId) && !p.droppedAt)
  run.stats.renewedRosters = { rosters: rosters2.length, players: kept.length, missingOwners: missing.length }
  if (kept.length) add({ code: 'REDRAFT_ROSTERS_NOT_RESET', stage: 'offseason', message: `${kept.length} player(s) are still on season-2 rosters; a redraft league starts empty.` })
  const genericLeft = (rowsOf(db, 'Roster') as any[]).filter((r) => r.leagueId === leagueId)
    .reduce((n, r) => n + ((r.playerData as any)?.players?.length ?? 0), 0)
  if (genericLeft) add({ code: 'REDRAFT_LEAGUE_ROSTERS_NOT_RESET', stage: 'offseason', message: `${genericLeft} player(s) remain on the league rosters after renewal.` })

  // A fresh draft, waiting to be run, in the order the commissioner chose: "standings" is worst to first,
  // champion last (renewRedraftLeague: "reverse standings" is champion first).
  const sessions = (rowsOf(db, 'DraftSession') as any[]).filter((s) => s.leagueId === leagueId)
  const draft2 = sessions.filter((s) => s.status === 'pre_draft').sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
  run.stats.renewedDraft = draft2 ? { status: draft2.status, rounds: draft2.rounds, draftType: draft2.draftType, slots: (draft2.slotOrder ?? []).length } : null
  if (!draft2) {
    add({ code: 'NO_DRAFT_FOR_NEXT_SEASON', stage: 'offseason', message: `Renewed with no pre-draft session (sessions: ${sessions.map((s) => s.status).join(', ')}).` })
    return
  }
  const slots = ([...(draft2.slotOrder ?? [])] as Array<{ slot: number; rosterId: string }>).sort((a, b) => a.slot - b.slot)
  if (slots.length !== run.teamCount) add({ code: 'NEXT_DRAFT_SLOT_COUNT', stage: 'offseason', message: `${slots.length} draft slots for ${run.teamCount} teams.` })
  if (ctx.championId) {
    const championOwner = ownerOf.get(ctx.championId)
    const genericOfOwner = new Map((rowsOf(db, 'Roster') as any[]).filter((r) => r.leagueId === leagueId).map((r) => [String(r.platformUserId), String(r.id)]))
    const championRoster = championOwner ? genericOfOwner.get(championOwner) : undefined
    const last = slots.at(-1)?.rosterId
    run.stats.renewedDraftLast = { champion: championRoster ?? null, last: last ?? null }
    if (championRoster && last && last !== championRoster) add({ code: 'STANDINGS_ORDER_CHAMPION_NOT_LAST', stage: 'offseason', message: 'Renewed with "standings" (worst to first); the champion does not pick last.' })
  }

  // A second Renew into the same season is refused.
  const again = await route.POST(
    new NextRequest(`http://sim.allfantasy.test/api/commissioner/leagues/${leagueId}/renew`, { method: 'POST', body: JSON.stringify({ draftOrder: 'standings' }) }),
    { params: Promise.resolve({ leagueId }) } as never,
  )
  run.stats.renewTwice = again.status
  if (again.status === 200) add({ code: 'RENEWED_TWICE', stage: 'offseason', message: 'A second Renew into the same season was accepted.' })
}

// ── Rankings: the manager rank the career ledger produces from the season just closed ──
async function runRankings(env: SimEnv, run: LeagueRun, championId: string | null, add: (f: SeasonFinding) => void): Promise<void> {
  const db = env.db
  const { calculateAndSaveRank } = await import('@/lib/rank/calculateRank')
  const owners = [run.commissionerId, ...run.managerIds]
  const championOwner = championId ? ((rowsOf(db, 'RedraftRoster') as any[]).find((r) => r.id === championId)?.ownerId as string | undefined) : undefined
  const ranks: Record<string, unknown> = {}
  for (const userId of owners) {
    try {
      const res = (await calculateAndSaveRank(userId)) as any
      ranks[userId] = res && { tier: res.rankTier, level: res.xpLevel, xp: res.xpTotal, titles: res.careerChampionships, seasons: res.careerSeasonsPlayed, wins: res.careerWins, losses: res.careerLosses, playoffs: res.careerPlayoffAppearances }
    } catch (e) {
      add({ code: 'RANK_CALCULATION_THREW', stage: 'offseason', message: `${userId}: ${(e as Error).message}` })
      return
    }
  }
  run.stats.ranks = ranks
  const profiles = rowsOf(db, 'UserProfile') as any[]
  run.stats.rankProfilesWritten = profiles.filter((p) => owners.includes(p.userId)).length
  if (championOwner) {
    const champ = ranks[championOwner] as any
    const others = owners.filter((o) => o !== championOwner).map((o) => ranks[o] as any)
    run.stats.championRank = { owner: championOwner, ...champ }
    if (champ && others.some((o) => o && Number(o.xp ?? 0) > Number(champ.xp ?? 0) && Number(o.titles ?? 0) === 0 && Number(champ.titles ?? 0) === 0)) {
      // Not asserted as a bug: XP weighs more than titles. Recorded so a reviewer can see the shape.
      run.stats.championOutrankedOnXp = true
    }
    if (champ && champ.titles != null && Number(champ.titles) < 1) add({ code: 'CHAMPION_TITLE_NOT_COUNTED', stage: 'offseason', message: `${championOwner} won the title; their career ledger shows ${champ.titles} championships.` })
  }
}

// ── Rookie draft → year 2 ──
async function runRookieDraft(
  env: SimEnv,
  run: LeagueRun,
  ctx: { ledger: Ledger; championId: string | null; runnerUpId: string | null; year1RosterIds: string[]; year1: Map<string, Set<string>>; nextSeasonId: string },
  add: (f: SeasonFinding) => void,
): Promise<void> {
  const db = env.db
  const leagueId = run.leagueId!
  const { createNextLeagueDraft } = await import('@/lib/live-draft-engine/createNextLeagueDraft')
  // Simulate an AF Commissioner league that switched the automatic rookie order on (owner's decision
  // 2026-10-29: OFF by default, AF Commissioner only). The test mocks the entitlement check to true.
  // Without this the rookie draft takes the league's own order, by design, and standings are never read.
  const leagueRow = rowsOf(db, 'League').find((l: any) => l.id === leagueId) as any
  // With the scenarios on, the commissioner already chose the order on the rookie-order screen; leave it.
  if (!SCENARIOS) await db.league.update({ where: { id: leagueId }, data: { settings: { ...(leagueRow.settings ?? {}), rookie_draft_order: { enabled: true, mode: 'reverse_max_pf' } } } })
  // Picks as they stand before the draft is created: traded owners, forfeits.
  const picksBefore = (rowsOf(db, 'FutureDraftPick') as any[]).filter((p) => p.leagueId === leagueId).map((p) => ({ season: p.pickSeason, round: p.round, original: p.originalRosterId, owner: p.currentOwnerId, status: p.status }))
  run.stats.picksBeforeRookieDraft = picksBefore
  if (SCENARIOS) run.stats.liveRookieView = await (await import('./dynastyScenarios')).readLiveRookieView(env, run).catch((e: Error) => ({ threw: e.message }))
  const orderFacts = SCENARIOS ? await (await import('@/lib/rookie-order/loadRookieOrderInput')).loadRookieOrderInput(leagueId).catch((e: Error) => ({ threw: e.message })) : null
  const created = (await createNextLeagueDraft(leagueId, run.commissionerId)) as any
  run.stats.rookieDraft = created.ok ? { kind: created.kind, rounds: created.rounds, orderSource: created.orderSource } : { code: created.code, message: created.message }
  if (!created.ok) {
    add({ code: 'ROOKIE_DRAFT_NOT_CREATED', stage: 'offseason', message: `${created.code}: ${created.message}` })
    return
  }
  const session = rowsOf(db, 'DraftSession').find((s: any) => s.id === created.sessionId) as any
  const slotOrder = ([...(session?.slotOrder ?? [])] as Array<{ slot: number; rosterId: string; userId?: string | null }>).sort((a, b) => a.slot - b.slot)

  // Expected order, computed here from the harness's own ledger: worst to first (points only for max_pf,
  // record then points otherwise), runner-up second to last, champion last.
  const dynastyCfg = rowsOf(db, 'DynastyLeagueConfig').find((c: any) => c.leagueId === leagueId) as any
  const method = String(dynastyCfg?.rookiePickOrderMethod ?? 'max_pf')
  const ownerOfSeason = new Map((rowsOf(db, 'RedraftRoster') as any[]).map((r) => [r.id, r.ownerId]))
  const draftRosterOfOwner = new Map((rowsOf(db, 'Roster') as any[]).filter((r) => r.leagueId === leagueId).map((r) => [String(r.platformUserId), String(r.id)]))
  const finalists = new Set([ctx.championId, ctx.runnerUpId].filter(Boolean) as string[])
  if (SCENARIOS) {
    // The commissioner's live rule: non-playoff teams by max PF, playoff teams by finish, runner-up then champion.
    const sc = await import('./dynastyScenarios')
    const exp = sc.expectedOrderFromFacts(orderFacts)
    // Facts are keyed by league roster or season roster; the board by league roster.
    const generic = new Set((rowsOf(db, 'Roster') as any[]).filter((r) => r.leagueId === leagueId).map((r) => String(r.id)))
    const toGeneric = (id: string) => (generic.has(id) ? id : draftRosterOfOwner.get(String(ownerOfSeason.get(id))) ?? `?${id}`)
    const expected = exp.order.map(toGeneric)
    if (exp.detail.champion && ctx.championId && toGeneric(String(exp.detail.champion)) !== toGeneric(ctx.championId)) add({ code: 'ROOKIE_FACTS_WRONG_CHAMPION', stage: 'offseason', message: `The rookie order's facts name ${exp.detail.champion} champion; the season closed with ${ctx.championId}.` })
    const actual = slotOrder.map((s) => s.rosterId)
    run.stats.liveRookieOrderCheck = { orderSource: created.orderSource, matches: JSON.stringify(expected) === JSON.stringify(actual), expected, actual, detail: exp.detail }
    // The commissioner's rookie order SCREEN: it loads, it is final once the season is over, and the
    // order it shows is the order the rookie draft was seated in, team for team.
    const view: any = run.stats.liveRookieView
    if (!view || view.threw || view.status !== 200) {
      add({ code: 'ROOKIE_ORDER_SCREEN_NOT_READABLE', stage: 'offseason', message: `The live rookie order screen returned ${view?.status ?? view?.threw ?? 'nothing'}.` })
    } else {
      if (view.phase !== 'final') add({ code: 'ROOKIE_ORDER_SCREEN_NOT_FINAL', stage: 'offseason', message: `After the season the screen says phase "${view.phase}"; it should be final.` })
      const screen = [...(view.slots ?? [])].sort((a: any, b: any) => a.slot - b.slot).map((s: any) => toGeneric(String(s.team)))
      if (JSON.stringify(screen) !== JSON.stringify(actual)) add({ code: 'ROOKIE_ORDER_SCREEN_DISAGREES_WITH_DRAFT', stage: 'offseason', message: 'The rookie order screen shows a different order from the one the rookie draft was seated in.', detail: { screen, draft: actual } })
    }
    const member = run.managerIds[0]
    if (member) {
      const preview = await sc.readRookiePreview(env, run, member).catch((e: Error) => ({ status: 0, slots: 0, error: e.message }))
      run.stats.rookiePreviewForMember = preview
      if (preview.status !== 200 || preview.slots !== run.teamCount) add({ code: 'ROOKIE_ORDER_PREVIEW_FAILED_FOR_MEMBER', stage: 'offseason', message: `A member opening the rookie order preview got ${preview.status} with ${preview.slots} of ${run.teamCount} slots${preview.error ? `: ${preview.error}` : ''}.` })
    }
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      add({ code: 'ROOKIE_ORDER_NOT_THE_COMMISSIONERS_RULE', stage: 'offseason', message: `Order source ${created.orderSource}; the order does not follow "non-playoff by reverse max PF, playoff by finish, runner-up 2nd-last, champion last".`, detail: { expected, actual, ...exp.detail } })
    }
  }
  const pct = (r: { wins: number; losses: number; ties: number }) => (r.wins + r.losses + r.ties ? (r.wins + r.ties / 2) / (r.wins + r.losses + r.ties) : 0)
  const field = ctx.year1RosterIds
    .filter((id) => !finalists.has(id))
    .sort((a, b) => {
      const ra = ctx.ledger.get(a)!
      const rb = ctx.ledger.get(b)!
      if (method !== 'max_pf' && pct(ra) !== pct(rb)) return pct(ra) - pct(rb)
      if (Math.abs(ra.pf - rb.pf) > 1e-9) return ra.pf - rb.pf
      return a < b ? -1 : 1
    })
  if (ctx.runnerUpId) field.push(ctx.runnerUpId)
  if (ctx.championId) field.push(ctx.championId)
  const expected = field.map((id) => draftRosterOfOwner.get(String(ownerOfSeason.get(id))) ?? `?${id}`)
  const actual = slotOrder.map((s) => s.rosterId)
  run.stats.rookieOrder = { method, orderSource: created.orderSource, matches: JSON.stringify(expected) === JSON.stringify(actual) }
  // Only a standings-based order is checkable; a lottery or a saved live order is the commissioner's own.
  if (created.orderSource === 'standings' && JSON.stringify(expected) !== JSON.stringify(actual)) {
    add({ code: 'ROOKIE_ORDER_WRONG', stage: 'offseason', message: `Rookie draft order does not follow ${method} worst-to-first with the champion last.`, detail: { expected, actual } })
  }
  if (ctx.championId && actual[actual.length - 1] !== draftRosterOfOwner.get(String(ownerOfSeason.get(ctx.championId)))) {
    add({ code: 'CHAMPION_NOT_PICKING_LAST', stage: 'offseason', message: 'The champion does not pick last in the rookie draft.' })
  }

  // Rookie class: fresh players nobody owns, at the positions the league starts.
  const roster = run.stats.enforcedRoster as { draftable: string[] }
  const rookies: Array<{ id: string; name: string; position: string }> = []
  for (const position of roster.draftable) for (let i = 1; i <= Math.ceil((created.rounds * run.teamCount) / roster.draftable.length) + 3; i += 1) rookies.push({ id: `rookie-${run.sport.toLowerCase()}-${position.toLowerCase()}-${i}`, name: `Rookie ${position} ${i}`, position })
  await db.sportsPlayer.createMany({ data: rookies.map((p) => ({ id: p.id, sport: run.sport, externalId: p.id, name: p.name, position: p.position, team: 'FA', yearsExp: 0, source: 'simulation', expiresAt: new Date('2030-01-01T00:00:00Z') })) })

  const { startDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
  const { submitPick } = await import('@/lib/live-draft-engine/PickSubmissionService')
  const started = (await startDraftSession(leagueId)) as any
  if (!started.ok) {
    add({ code: 'ROOKIE_DRAFT_WOULD_NOT_START', stage: 'offseason', message: `${started.reason} ${started.error ?? ''}` })
    return
  }
  const kind: 'linear' | 'snake' = session?.draftType === 'snake' ? 'snake' : 'linear'
  const { expectedRosterForPick } = await import('./dynastyHarness')
  const total = created.rounds * run.teamCount
  let made = 0
  const rookieIds = rookies.map((r) => r.id)
  const { buildSessionSnapshot } = await import('@/lib/live-draft-engine/DraftSessionService')
  run.stats.rookieClock = [] as Array<{ overall: number; slotOwner: string; onClock: string }>
  for (let overall = 1; overall <= total; overall += 1) {
    if (SCENARIOS) {
      // What the engine's own forfeit skip submits, and what pick validation answers it.
      const { skipForfeitedPicksOnClock } = await import('@/lib/live-draft-engine/forfeitedPickSkips')
      await skipForfeitedPicksOnClock(leagueId, async (input) => {
        const r = (await submitPick(input as never)) as any
        ;((run.stats.forfeitSkips ??= []) as any[]).push({ overall: input.expectedOverall, ok: r.success, code: r.code ?? null, error: r.error ?? null })
        return r
      }).catch((e: Error) => ((run.stats.forfeitSkips ??= []) as any[]).push({ threw: e.message }))
    }
    // Whoever the ENGINE puts on the clock — a traded pick belongs to its new owner, not the slot's.
    const snap = (await buildSessionSnapshot(leagueId, new Date(), null, { skipRepair: true }).catch(() => null)) as any
    // The engine fills a forfeited pick itself (a "(Forfeited)" skip); follow its board, not our count.
    if (snap && !snap.currentPick) break
    if (snap?.currentPick?.overall && snap.currentPick.overall > overall) overall = Number(snap.currentPick.overall)
    const slotOwner = expectedRosterForPick(slotOrder, overall, kind)
    const rosterId: string = snap?.currentPick?.rosterId ?? slotOwner
    if (rosterId !== slotOwner) (run.stats.rookieClock as any[]).push({ overall, slotOwner, onClock: rosterId })
    const owner = slotOrder.find((s) => s.rosterId === rosterId)
    // Positive control once: a veteran in a rookies-only draft.
    if (overall === 1) {
      const veteran = [...(ctx.year1.values().next().value ?? [])][0]
      const vetPlayer = veteran ? (rowsOf(db, 'SportsPlayer').find((p: any) => p.id === veteran) as any) : null
      if (vetPlayer) {
        const res = (await submitPick({ leagueId, rosterId, playerId: vetPlayer.id, playerName: vetPlayer.name, position: vetPlayer.position, team: vetPlayer.team, madeByUserId: owner?.userId ?? null, source: 'user', expectedOverall: overall } as never)) as any
        run.stats.rookieVeteranControl = res.success ? 'ACCEPTED' : res.code ?? res.error
        if (res.success) {
          run.stats.vetControlPick = { playerId: vetPlayer.id, draftedByDraftRoster: rosterId }
          add({ code: 'ROOKIE_DRAFT_TOOK_A_ROSTERED_VETERAN', stage: 'offseason', message: `A rookies-only draft accepted ${vetPlayer.id}, who is already on a roster.` })
          made += 1
          continue
        }
      }
    }
    const candidate = rookies.find((r) => rookieIds.includes(r.id))
    if (!candidate) break
    const res = (await submitPick({ leagueId, rosterId, playerId: candidate.id, playerName: candidate.name, position: candidate.position, team: 'FA', madeByUserId: owner?.userId ?? null, source: 'user', expectedOverall: overall } as never)) as any
    if (!res.success) {
      add({ code: 'ROOKIE_PICK_REFUSED', stage: 'offseason', message: `Rookie pick ${overall} (${rosterId}): ${res.code ?? ''} ${res.error ?? ''}`.trim() })
      break
    }
    rookieIds.splice(rookieIds.indexOf(candidate.id), 1)
    rookies.splice(rookies.indexOf(candidate), 1)
    made += 1
  }
  run.stats.rookiePicks = made
  const traded = run.stats.tradedPick as { pickId: string; from: string; to: string } | undefined
  if (traded?.to) {
    const firstRound = (rowsOf(db, 'DraftPick') as any[]).filter((p) => p.sessionId === created.sessionId && p.round === 1)
    const slotOfOriginal = slotOrder.find((s) => s.rosterId === traded.from)?.slot
    const thatPick = firstRound.find((p) => p.pick === slotOfOriginal || p.slot === slotOfOriginal || p.originalRosterId === traded.from)
    run.stats.tradedPickInRookieDraft = { slotOfOriginal, pickedBy: thatPick?.rosterId ?? null, expected: traded.to, row: thatPick ? { overall: thatPick.overall, rosterId: thatPick.rosterId, originalRosterId: thatPick.originalRosterId } : null }
    if (thatPick && thatPick.rosterId !== traded.to) add({ code: 'TRADED_PICK_USED_BY_ORIGINAL_OWNER', stage: 'offseason', message: `${traded.pickId} was traded to ${traded.to}, but ${thatPick.rosterId} made that pick.` })
  }

 const rookieSession = rowsOf(db, 'DraftSession').find((s: any) => s.id === created.sessionId) as any
  if (SCENARIOS) {
    // The board: every pick made by the team that owns it — traded picks by their new owner, and a pick
    // forfeited for tanking not made by the team that lost it.
    const draftYear = Number((rowsOf(db, 'RedraftSeason') as any[]).find((x) => x.id === ctx.nextSeasonId)?.season ?? 0)
    const board = (rowsOf(db, 'DraftPick') as any[]).filter((p) => p.sessionId === created.sessionId).sort((a, b) => a.overall - b.overall)
    const checks: any[] = []
    for (const p of board) {
      const slotOwner = expectedRosterForPick(slotOrder, p.overall, kind)
      const fdp = picksBefore.find((x) => x.season === draftYear && x.round === p.round && x.original === slotOwner)
      if (!fdp || (fdp.owner === slotOwner && fdp.status !== 'forfeited')) continue
      checks.push({ overall: p.overall, round: p.round, slotOwner, fdpOwner: fdp.owner, fdpStatus: fdp.status, madeBy: p.rosterId })
      const skipped = String(p.position ?? '').toUpperCase() === 'SKIP' || (p.pickMetadata as any)?.forfeited === true
      checks[checks.length - 1].skipped = skipped
      if (fdp.status === 'forfeited' && !skipped) add({ code: 'FORFEITED_PICK_STILL_USED', stage: 'offseason', message: `${draftYear} round ${p.round} of ${slotOwner} was forfeited for tanking; ${slotOwner} made that pick (#${p.overall}).` })
      if (fdp.status !== 'forfeited' && fdp.owner !== slotOwner && p.rosterId !== fdp.owner) add({ code: 'TRADED_PICK_ON_WRONG_TEAM', stage: 'offseason', message: `${draftYear} round ${p.round} of ${slotOwner} belongs to ${fdp.owner}; ${p.rosterId} made it (#${p.overall}).` })
    }
    run.stats.boardPickOwnership = { checks, picksMade: board.length }
  }
  const year2 = rowsOf(db, 'RedraftSeason').find((s: any) => s.id === ctx.nextSeasonId) as any
  run.stats.year2 = { rookieDraft: rookieSession?.status, seasonStatus: year2?.status }
  if (rookieSession?.status !== 'completed') add({ code: 'ROOKIE_DRAFT_NOT_COMPLETED', stage: 'offseason', message: `Rookie draft is ${rookieSession?.status} after ${made}/${total} picks.` })
  if (year2?.status !== 'active') add({ code: 'YEAR_2_NOT_ACTIVE', stage: 'offseason', message: `After the rookie draft, year 2 is ${year2?.status}.` })

  // Year 2 rosters = year 1 rosters + exactly the rookies each team drafted; nobody on two rosters.
  const y2Rosters = new Set((rowsOf(db, 'RedraftRoster') as any[]).filter((r) => r.seasonId === ctx.nextSeasonId).map((r) => r.id))
  const y2Players = (rowsOf(db, 'RedraftRosterPlayer') as any[]).filter((p) => y2Rosters.has(p.rosterId) && !p.droppedAt)
  const owners = new Map<string, string>()
  let doubles = 0
  for (const p of y2Players) {
    if (owners.has(p.playerId) && owners.get(p.playerId) !== p.rosterId) doubles += 1
    owners.set(p.playerId, p.rosterId)
  }
  const expectedCount = [...ctx.year1.values()].reduce((n, s) => n + s.size, 0) + made
  run.stats.year2Rosters = { players: y2Players.length, expected: expectedCount, doubles }
  // Where did the already-rostered player the rookie draft accepted actually end up?
  const vet = run.stats.vetControlPick as { playerId: string; draftedByDraftRoster: string } | undefined
  if (vet) {
    const holders = y2Players.filter((p) => p.playerId === vet.playerId).map((p) => p.rosterId)
    const drafterOwner = (rowsOf(db, 'Roster') as any[]).find((r) => r.id === vet.draftedByDraftRoster)?.platformUserId
    const drafterY2 = (rowsOf(db, 'RedraftRoster') as any[]).find((r) => r.seasonId === ctx.nextSeasonId && r.ownerId === drafterOwner)?.id
    const drafterCount = y2Players.filter((p) => p.rosterId === drafterY2).length
    const typical = Math.round(y2Players.length / run.teamCount)
    run.stats.vetControlOutcome = { holders, drafterY2, drafterHasHim: holders.includes(drafterY2), drafterRosterSize: drafterCount, typicalRosterSize: typical }
  }
  if (doubles) add({ code: 'YEAR_2_PLAYER_ON_TWO_ROSTERS', stage: 'offseason', message: `${doubles} player(s) on two year-2 rosters.` })
  if (y2Players.length !== expectedCount) add({ code: 'YEAR_2_ROSTER_SIZE_WRONG', stage: 'offseason', message: `${y2Players.length} rostered players in year 2; carried + rookies drafted = ${expectedCount}.` })
}

function checkPlayoffField(ledger: Ledger, seeded: any[], add: (f: SeasonFinding) => void): void {
  const n = seeded.length
  if (!n) {
    add({ code: 'NO_PLAYOFF_TEAMS', stage: 'playoffs', message: 'The bracket was generated with no seeded teams.' })
    return
  }
  const rows = [...ledger.entries()].map(([id, r]) => {
    const g = r.wins + r.losses + r.ties
    return { id, pct: g ? (r.wins + r.ties / 2) / g : 0, wins: r.wins, pf: round2(r.pf) }
  })
  rows.sort((a, b) => b.pct - a.pct || b.wins - a.wins || b.pf - a.pf)
  const lastIn = rows[n - 1]
  const firstOut = rows[n]
  // Divisions or a tie at the line make the field a tiebreaker call; only assert a strict cut.
  if (lastIn && (!firstOut || lastIn.pct > firstOut.pct)) {
    const expected = new Set(rows.slice(0, n).map((r) => r.id))
    const missing = [...expected].filter((id) => !seeded.some((s) => s.id === id))
    if (missing.length) add({ code: 'PLAYOFF_FIELD_WRONG', stage: 'playoffs', message: `By record, ${missing.join(', ')} made the playoffs; the bracket left them out.` })
  }
}
