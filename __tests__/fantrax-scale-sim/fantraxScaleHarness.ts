/**
 * Big imported leagues (Fantrax 32 / 128 / 256 teams) through the real import, join, trade, integrity,
 * ranking and Chimmy code. Only Fantrax's HTTP layer is fabricated (`fantraxApi` functions, mocked in the
 * test file); the payload copies the committed captures in tests/fixtures/fantrax for each sport's
 * `rosterInfo`, `scoringSystem` and `playoffs`, and fabricates teams, players and rosters at scale.
 */
import fs from 'node:fs'
import path from 'node:path'
import { rowsOf, type InMemoryPrisma } from '../redraft-season-simulation/inMemoryPrisma'

export type ScaleSport = 'NFL' | 'NBA' | 'NHL' | 'MLB' | 'NCAAF' | 'NCAAB' | 'SOCCER'

export type Finding = { code: string; stage: string; message: string; detail?: unknown }

export type ScaleRun = {
  sport: ScaleSport
  teamCount: number
  sourceLeagueId: string
  leagueId: string | null
  commissionerId: string
  findings: Finding[]
  stats: Record<string, unknown>
  timings: Record<string, number>
}

export type ScaleEnv = {
  db: InMemoryPrisma
  signIn: (user: { id: string; email: string; name: string } | null) => void
  /** What the mocked fantraxApi serves for the league being imported. */
  fx: FantraxServe | null
}

export type FantraxServe = {
  sport: ScaleSport
  info: Record<string, unknown>
  rosters: Record<string, { teamName: string; rosterItems: Array<{ id: string; position: string; status: string }> }>
  playerMap: Record<string, { fantraxId: string; name: string; team: string; position: string }>
  standings: Array<Record<string, unknown>>
  /** 0 = the team's best player. Free agents rank below every rostered player. */
  valueRank: Record<string, number>
}

const FIXTURES: Record<ScaleSport, string> = {
  NFL: 'nfl-public-2026.json',
  NBA: 'nba-public-2026.json',
  NHL: 'nhl-public-2026.json',
  MLB: 'mlb-points-public.json',
  NCAAF: 'nfl-public-2026.json',
  NCAAB: 'nba-public-2026.json',
  SOCCER: 'epl-public-2026.json',
}

/** Per-team roster mix that fills each capture's `maxTotalPlayers` with positions its constraints accept. */
const ROSTER_MIX: Record<ScaleSport, Array<[string, number]>> = {
  NFL: [['QB', 3], ['RB', 6], ['WR', 8], ['TE', 3], ['K', 1], ['DL', 5], ['LB', 6], ['DB', 6]],
  NBA: [['PG', 3], ['SG', 3], ['SF', 3], ['PF', 3], ['C', 2]],
  NCAAB: [['PG', 3], ['SG', 3], ['SF', 3], ['PF', 3], ['C', 2]],
  NCAAF: [['QB', 3], ['RB', 6], ['WR', 8], ['TE', 3], ['K', 1]],
  SOCCER: [['FWD', 3], ['MID', 4], ['DEF', 3], ['GK', 1]],
  NHL: [['C', 4], ['LW', 4], ['RW', 4], ['D', 4], ['G', 2]],
  MLB: [['C', 2], ['1B', 2], ['2B', 2], ['3B', 2], ['SS', 2], ['OF', 6], ['SP', 8], ['RP', 6]],
}
const SOCCER_POSITIONS: Record<string, { fantrax: string; match: string }> = {
  FWD: { fantrax: 'F', match: 'Forward' },
  MID: { fantrax: 'M', match: 'Midfielder' },
  DEF: { fantrax: 'D', match: 'Defender' },
  GK: { fantrax: 'G', match: 'Goalkeeper' },
}

const PRO_TEAMS: Record<ScaleSport, string[]> = {
  NFL: ['KC', 'BUF', 'SF', 'PHI', 'DAL', 'MIA', 'DET', 'BAL', 'CIN', 'GB', 'LAR', 'NYJ'],
  NBA: ['BOS', 'DEN', 'MIL', 'PHX', 'LAL', 'GSW', 'MIA', 'NYK', 'DAL', 'OKC'],
  NCAAB: ['DUKE', 'UNC', 'KANS', 'UK', 'UCONN', 'GONZ', 'UCLA', 'BAY', 'HOU', 'TENN'],
  NCAAF: ['TEX', 'OHST', 'MICH', 'IOWA', 'USC', 'UGA', 'UCLA', 'BAY', 'HOU', 'TENN'],
  SOCCER: ['ARS', 'CHE', 'LIV', 'MCI', 'MUN', 'NEW', 'BHA', 'AVL', 'WHU', 'FUL'],
  NHL: ['BOS', 'TOR', 'EDM', 'COL', 'NYR', 'VGK', 'FLA', 'DAL', 'CAR', 'NJD'],
  MLB: ['NYY', 'LAD', 'ATL', 'HOU', 'TEX', 'BAL', 'PHI', 'SEA', 'TOR', 'SD'],
}

export const COMMISH = { id: 'fx-commish', email: 'fx-commish@sim.allfantasy.test', name: 'FX Commish' }
export const managerFor = (i: number) => {
  const id = `fx-mgr-${String(i).padStart(3, '0')}`
  return { id, email: `${id}@sim.allfantasy.test`, name: id }
}
export const teamIdFor = (i: number) => `t${String(i).padStart(3, '0')}`
export const teamNameFor = (i: number) => `Team ${String(i).padStart(3, '0')}`

const FIRST = ['Marcus', 'Devin', 'Tyler', 'Jalen', 'Andre', 'Caleb', 'Noah', 'Isaiah', 'Elijah', 'Owen', 'Miles', 'Rowan', 'Dante', 'Felix', 'Hugo', 'Jonah', 'Levi', 'Malik', 'Nico', 'Quinn', 'Rhys', 'Silas', 'Theo', 'Victor', 'Wade', 'Xavier', 'Yusuf', 'Zane', 'Brock', 'Cyrus', 'Emmett', 'Gideon']
const LAST = ['Abernathy', 'Bellweather', 'Castellano', 'Delacroix', 'Ellingham', 'Fairbanks', 'Galloway', 'Hollister', 'Ingersoll', 'Jablonski', 'Kettering', 'Lindqvist', 'Montgomery', 'Northcutt', 'Okonkwo', 'Pemberton', 'Quarles', 'Rutherford', 'Satterfield', 'Thibodeaux', 'Underwood', 'Vandermeer', 'Whitlock', 'Yarbrough', 'Zielinski', 'Ashcombe', 'Blackwood', 'Copperfield', 'Dunmore', 'Easterly', 'Fenwick', 'Greenhalgh']
/** Unique "Last, First" — Fantrax's own name order — so name lookups have exactly one answer. */
function simName(serial: number): string {
  const first = FIRST[serial % FIRST.length]!
  const last = LAST[Math.floor(serial / FIRST.length) % LAST.length]!
  const gen = Math.floor(serial / (FIRST.length * LAST.length))
  return `${last}${gen ? ['', 'son', 'ford', 'ley', 'ton', 'well', 'by', 'more', 'ham', 'wick'][gen % 10] + (gen >= 10 ? gen : '') : ''}, ${first}`
}

function readFixture(sport: ScaleSport): any {
  const file = path.join(process.cwd(), 'tests', 'fixtures', 'fantrax', FIXTURES[sport])
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Fabricated Fantrax league: N teams, full rosters at the capture's own size, plus a free-agent pool. */
export function fabricateFantraxLeague(sport: ScaleSport, teamCount: number, sourceLeagueId: string): FantraxServe {
  const fixture = readFixture(sport)
  const rosterInfo = fixture.info.rosterInfo ?? {}
  const maxActive = Number(rosterInfo.maxTotalActivePlayers ?? 0) || Infinity
  const playerMap: FantraxServe['playerMap'] = {}
  const rosters: FantraxServe['rosters'] = {}
  const teamInfo: Record<string, { id: string; name: string }> = {}
  let serial = 0
  const valueRank: Record<string, number> = {}
  const positionIndex = new Map<string, number>()
  const perPos = new Map<string, number>()
  const nextPlayer = (position: string) => {
    serial += 1
    // Short base-36 ids like Fantrax's own ("04yk2"); the sport prefix keeps sports' id spaces apart.
    const id = `${sport.toLowerCase()[0]}${serial.toString(36).padStart(5, '0')}`
    const teams = PRO_TEAMS[sport]
    playerMap[id] = { fantraxId: id, name: simName(serial), team: teams[serial % teams.length]!, position }
    const k = perPos.get(position) ?? 0
    perPos.set(position, k + 1)
    positionIndex.set(id, k)
    return id
  }
  for (let i = 1; i <= teamCount; i += 1) {
    const tid = teamIdFor(i)
    teamInfo[tid] = { id: tid, name: teamNameFor(i) }
    const items: Array<{ id: string; position: string; status: string }> = []
    perPos.clear()
    for (const [pos, count] of ROSTER_MIX[sport]) {
      for (let k = 0; k < count; k += 1) {
        items.push({ id: nextPlayer(pos), position: sport === 'SOCCER' ? SOCCER_POSITIONS[pos]!.fantrax : pos, status: 'ACTIVE' })
      }
    }
    items.forEach((item, idx) => {
      if (idx >= maxActive) item.status = 'RESERVE'
    })
    // Value by depth within the team, interleaved across positions, so equal depths are equal value.
    const ordered = [...items].sort((x, y) => (positionIndex.get(x.id)! - positionIndex.get(y.id)!) || (x.id < y.id ? -1 : 1))
    ordered.forEach((item, rank) => (valueRank[item.id] = rank))
    rosters[tid] = { teamName: teamNameFor(i), rosterItems: items }
  }
  const freeAgents = Math.max(40, Math.round(serial * 0.1))
  const perTeam = ROSTER_MIX[sport].reduce((n, [, c]) => n + c, 0)
  for (let k = 0; k < freeAgents; k += 1) {
    const id = nextPlayer(ROSTER_MIX[sport][k % ROSTER_MIX[sport].length]![0])
    valueRank[id] = perTeam + k
  }
  const standings = Array.from({ length: teamCount }, (_, idx) => ({
    teamId: teamIdFor(idx + 1),
    teamName: teamNameFor(idx + 1),
    rank: idx + 1,
    wins: Math.max(0, 10 - (idx % 11)),
    losses: idx % 11,
    ties: 0,
    pointsFor: 1500 - idx,
    winPercentage: null,
    gamesBack: null,
  }))
  return {
    sport,
    info: {
      ...fixture.info,
      leagueName: `Sim ${sport} ${teamCount}`,
      teamInfo,
      playerInfo: {},
      seasonYear: fixture.info.seasonYear ?? 2026,
      ...(sport === 'SOCCER' && teamCount >= 2 ? simulatedSoccerCalendar(teamInfo) : {}),
    },
    rosters,
    playerMap,
    standings,
    valueRank,
  }
}

/** The capture has scoring weights but no calendar. Exercise an in-season import with source totals. */
function simulatedSoccerCalendar(teamInfo: Record<string, { id: string; name: string }>) {
  const [away, home] = Object.values(teamInfo)
  const weekMs = 7 * 86_400_000
  const first = Date.now() - weekMs * 1.5
  const scoringPeriods = Array.from({ length: 38 }, (_, index) => ({
    number: index + 1,
    startDate: new Date(first + index * weekMs).toISOString(),
    endDate: new Date(first + (index + 1) * weekMs - 1).toISOString(),
  }))
  const matchups = [1, 2, 38].map((period) => ({ period, matchupList: [{ away, home }] }))
  return { scoringPeriods, matchups }
}

/** "Last, First" → "First Last", as every other provider and our own registry spell a name. */
export function firstLast(name: string): string {
  const m = /^([^,]+),\s*(.+)$/.exec(name)
  return m ? `${m[2]} ${m[1]}` : name
}

/** Existing identity links are present before Soccer import, as they would be in the registry. */
export async function seedSoccerIdentities(env: ScaleEnv): Promise<void> {
  if (process.env.SIM_SEED_VALUES === '0') return
  await env.db.playerIdentityMap.createMany({ data: Object.entries(env.fx!.playerMap).map(([id, ref]) => {
    const name = firstLast(ref.name)
    return {
      id: `pim-${id}`, canonicalName: name, normalizedName: name.toLowerCase().replace(/[^a-z]/g, ''),
      sport: 'SOCCER', position: ref.position, currentTeam: ref.team, rollingInsightsId: `ri-${id}`,
      fantraxId: process.env.SIM_SEED_SOCCER_LINKS === '0' ? null : id,
    }
  }) })
}

async function seedSoccerMatchValues(env: ScaleEnv, run: ScaleRun): Promise<void> {
  const fx = env.fx!
  const season = Number(fx.info.seasonYear)
  const dayMs = 86_400_000
  const today = Date.now()
  await env.db.playerGameStat.createMany({ data: Object.entries(fx.playerMap).flatMap(([id, ref]) => {
    const strength = Math.max(1, 34 - fx.valueRank[id]! * 1.5)
    const keeper = ref.position === 'GK'
    return Array.from({ length: 12 }, (_, match) => ({
      playerId: `pim-${id}`, gameId: `soc-${ref.team}-${match}`, sportType: 'SOCCER', season,
      weekOrRound: match + 1, team: ref.team, gameDate: new Date(today - (12 - match) * dayMs), statPayload: {},
      normalizedStatMap: {
        group: keeper ? 'goalkeepers' : 'fielders',
        position: SOCCER_POSITIONS[ref.position]!.match,
        stats: keeper ? { minutes_played: 90, saves: strength } : { minutes_played: 90, goals: strength / 10 },
      },
    }))
  }) })
  const clubs = PRO_TEAMS.SOCCER
  await env.db.sportsGame.createMany({ data: Array.from({ length: 18 }, (_, match) =>
    clubs.filter((_, club) => club % 2 === 0).map((club, pair) => ({
      sport: 'SOCCER', externalId: `soc-future-${match}-${pair}`, homeTeam: club, awayTeam: clubs[pair * 2 + 1]!,
      source: 'sim', season, seasonType: 'regular', startTime: new Date(today + (match + 1) * dayMs),
      expiresAt: new Date(today + 365 * dayMs),
    }))).flat() })
  run.stats.seededValues = { identities: Object.keys(fx.playerMap).length, matchesPerClub: 12, season }
}

/**
 * Production-shaped NBA values for every fabricated player, as the app holds them for real players:
 *   - PlayerIdentityMap rows carrying `fantraxId` (what the weekly `ingestProFantraxIdentities` cron
 *     fills) and a Rolling Insights id, named "First Last";
 *   - AFProjectionSnapshot rows keyed on the identity id, with per-game rates (sport-points-loader.test.ts);
 *   - an upcoming schedule, so the games left can be counted.
 * The stock matrix seeds NBA. The audit matrix also seeds NHL, MLB and the college sports.
 */
export async function seedTradeValues(env: ScaleEnv, run: ScaleRun): Promise<void> {
  if (!run.leagueId || process.env.SIM_SEED_VALUES === '0') return
  if (run.sport === 'SOCCER') return seedSoccerMatchValues(env, run)
  if (run.sport === 'NFL') {
    // What `linkNflFantraxIdentities` leaves after an import: the Fantrax id on the player's identity row,
    // which carries his Sleeper id — the same id the served FantasyCalc chart uses (fantrax-scale.test.ts).
    const t1 = now()
    let i = 0
    for (const [id, ref] of Object.entries(env.fx!.playerMap)) {
      i += 1
      const name = firstLast(ref.name)
      await env.db.playerIdentityMap.create({
        data: { id: `pim-${id}`, canonicalName: name, normalizedName: name.toLowerCase().replace(/[^a-z]/g, ''), sport: 'NFL', position: ref.position, sleeperId: `90${String(i).padStart(5, '0')}`, fantraxId: id },
      })
    }
    run.timings.seedValuesMs = now() - t1
    run.stats.seededValues = { identities: i, sleeperLinked: true }
    return
  }
  if (!['NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB'].includes(run.sport)) return
  if (run.sport !== 'NBA' && process.env.SIM_AUDIT_VALUES !== '1') return
  const sport = run.sport
  const league = (rowsOf(env.db, 'League') as any[]).find((l) => l.id === run.leagueId)
  const season = Number(league?.season ?? 2025)
  if (sport === 'NCAAF' && !Object.keys(league.settings?.scoring_settings ?? {}).length) {
    await env.db.league.update({ where: { id: run.leagueId }, data: { settings: {
      ...league.settings, scoring_settings: { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 1, rec_yd: 0.1, fg: 3 },
    } } })
  }
  const fx = env.fx!
  const t0 = now()
  for (const [id, ref] of Object.entries(fx.playerMap)) {
    const rank = fx.valueRank[id] ?? 30
    const pim = `pim-${id}`
    const cfbdId = sport === 'NCAAF' ? `cfbd-${id}` : null
    const name = firstLast(ref.name)
    await env.db.playerIdentityMap.create({
      data: { id: pim, canonicalName: name, normalizedName: name.toLowerCase().replace(/[^a-z]/g, ''), sport, position: ref.position, rollingInsightsId: `ri-${id}`, fantraxId: id, cfbdId },
    })
    const pts = Math.max(4, 34 - rank * 2)
    await env.db.aFProjectionSnapshot.create({
      data: {
        playerId: cfbdId ?? pim, playerName: name, sport, position: ref.position, season, week: null,
        baselineProjection: pts, afProjection: pts, snapshotLookupKey: `sim:${sport}:${season}:${pim}`, computedAt: new Date(),
        adjustmentFactors: { perGameRates: sport === 'NCAAF'
          ? { pass_yd: pts * 10, rush_yd: pts * 3, rec: pts / 8, rec_yd: pts * 2, fg: pts / 10 }
          : sport === 'NHL'
          ? { goals: pts / 20, assists: pts / 20, shots: pts / 5, saves: pts, goals_against: 2, wins: pts / 50 }
          : sport === 'MLB'
            ? { ab: 4, h: pts / 20, hr: pts / 80, r: pts / 40, rbi: pts / 40, ip: 5, outs: 15, so: pts / 5, er: 2 }
            : { points: pts, total_rebounds: Math.max(1, 10 - rank * 0.5), assists: Math.max(1, 8 - rank * 0.4) },
          confidenceReasons: ['60 games in the season sample'], sourceSeason: sport === 'NCAAB' ? season : season - 1 },
      },
    })
  }
  const teams = PRO_TEAMS[sport]
  const start = Date.now()
  for (let day = 1; day <= 60; day += 1) {
    for (let t = 0; t < teams.length; t += 2) {
      await env.db.sportsGame.create({
        data: { sport, externalId: `sim-${season}-${day}-${t}`, homeTeam: teams[t]!, awayTeam: teams[t + 1]!, source: 'sim', season, week: sport === 'NCAAF' ? Math.min(day, 13) : null, seasonType: sport === 'NCAAF' ? 'regular' : null, startTime: new Date(start + day * 86_400_000), expiresAt: new Date(start + 400 * 86_400_000) },
      })
    }
  }
  run.timings.seedValuesMs = now() - t0
  run.stats.seededValues = { identities: Object.keys(fx.playerMap).length, season }
}

export async function seedUser(env: ScaleEnv, user: { id: string; email: string; name: string }) {
  await env.db.appUser.upsert({
    where: { id: user.id },
    create: { id: user.id, email: user.email, username: user.id, emailVerified: new Date('2026-01-01T00:00:00Z') },
    update: {},
  })
  await env.db.userProfile
    .upsert({
      where: { userId: user.id },
      create: { userId: user.id, displayName: user.name, ageConfirmedAt: new Date('2026-01-01T00:00:00Z'), emailVerifiedAt: new Date('2026-01-01T00:00:00Z') },
      update: {},
    })
    .catch(() => undefined)
}

const now = () => Date.now()

// ── 1. Import through the real commit route ─────────────────────────────────

export async function importLeague(env: ScaleEnv, run: ScaleRun): Promise<void> {
  const t0 = now()
  await seedUser(env, COMMISH)
  env.signIn(COMMISH)
  const { POST } = await import('@/app/api/leagues/import/commit/route')
  const { NextRequest } = await import('next/server')
  const sourceId = `fantrax-league:${run.sourceLeagueId}|${teamNameFor(1)}`
  // The import screen previews first; the importer then picks their team from the preview's managers.
  const { POST: previewPost } = await import('@/app/api/leagues/import/preview/route')
  const pre = await previewPost(
    new NextRequest('http://sim.allfantasy.test/api/leagues/import/preview', { method: 'POST', body: JSON.stringify({ provider: 'fantrax', sourceId }) }),
  )
  const preview: any = await pre.json().catch(() => null)
  run.timings.previewMs = now() - t0
  const mine = (preview?.managers ?? preview?.preview?.managers ?? []).find((m: any) => m.teamName === teamNameFor(1))
  run.stats.preview = { status: pre.status, managers: (preview?.managers ?? preview?.preview?.managers ?? []).length, myRosterId: mine?.rosterId ?? null }
  if (pre.status !== 200 || !mine) {
    run.findings.push({ code: 'PREVIEW_NO_TEAM', stage: 'import', message: `Preview ${pre.status}; ${teamNameFor(1)} ${mine ? 'found' : 'not among the managers'}: ${JSON.stringify(preview).slice(0, 200)}` })
  }
  const res = await POST(
    new NextRequest('http://sim.allfantasy.test/api/leagues/import/commit', {
      method: 'POST',
      // What the import screen sends after the importer ticks "I'm the commissioner".
      body: JSON.stringify({
        provider: 'fantrax',
        sourceId,
        // The importer's own team, picked from the preview's managers (no Fantrax Secret ID to prove it).
        ...(mine?.rosterId ? { claimSourceTeamId: String(mine.rosterId) } : {}),
        attestation: { accepted: true, statement: 'I am the commissioner of this league.', confirmedProvider: 'fantrax', confirmedSourceLeagueId: sourceId },
      }),
    }),
  )
  const body: any = await res.json().catch(() => null)
  run.timings.importMs = now() - t0
  run.stats.importStatus = res.status
  run.stats.importBody = JSON.stringify(body).slice(0, 600)
  const league = (rowsOf(env.db, 'League') as any[]).find((l) => l.platform === 'fantrax')
  if (res.status !== 200 || !league) {
    run.findings.push({ code: 'IMPORT_FAILED', stage: 'import', message: `${res.status} ${JSON.stringify(body).slice(0, 300)}` })
    return
  }
  run.leagueId = league.id
  const rosters = (rowsOf(env.db, 'Roster') as any[]).filter((r) => r.leagueId === league.id)
  const teams = (rowsOf(env.db, 'LeagueTeam') as any[]).filter((t) => t.leagueId === league.id)
  const seasons = (rowsOf(env.db, 'RedraftSeason') as any[]).filter((s) => s.leagueId === league.id)
  const seasonRosters = (rowsOf(env.db, 'RedraftRoster') as any[]).filter((r) => r.leagueId === league.id)
  const seasonRosterIds = new Set(seasonRosters.map((r) => r.id))
  const seasonPlayers = (rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => seasonRosterIds.has(p.rosterId) && !p.droppedAt)
  const expectedPlayers = Object.values(env.fx!.rosters).reduce((n, r) => n + r.rosterItems.length, 0)
  run.stats.imported = {
    sport: league.sport,
    leagueSize: league.leagueSize,
    isDynasty: league.isDynasty,
    rosters: rosters.length,
    rosteredPlayers: rosters.reduce((count, roster) => count + leagueHoldings(env, roster.id).length, 0),
    leagueTeams: teams.length,
    seasons: seasons.length,
    seasonRosters: seasonRosters.length,
    seasonPlayers,
    expectedPlayers,
    linked: rosters.filter((r) => r.redraftRosterId && seasonRosterIds.has(r.redraftRosterId)).length,
    inviteCode: Boolean((league.settings as any)?.inviteCode),
  }
  ;(run.stats.imported as any).seasonPlayers = seasonPlayers.length
  if (run.sport === 'SOCCER' && seasons[0]) {
    const { loadFantraxNativePresentation } = await import('@/lib/redraft/fantraxNativePresentation')
    const season = seasons[0]
    const source = await loadFantraxNativePresentation(season)
    run.stats.soccerSeason = {
      currentWeek: season.currentWeek,
      totalWeeks: season.totalWeeks,
      playoffStartWeek: season.playoffStartWeek,
      source: source?.source ?? null,
      matchups: source?.matchups.map(({ week, awayScore, homeScore, status }) => ({ week, awayScore, homeScore, status })),
    }
  }
  run.stats.seasonPlayerSample = seasonPlayers.slice(0, 3).map((p) => ({ playerId: p.playerId, playerName: p.playerName, position: p.position ?? null, slotType: p.slotType ?? null, sport: p.sport ?? null }))
  run.stats.leagueRosterSample = JSON.stringify(rosters[0]?.playerData).slice(0, 300)
  const unknownPos = seasonPlayers.filter((p) => !p.position || /unknown/i.test(String(p.position))).length
  if (unknownPos) run.findings.push({ code: 'IMPORT_PLAYERS_WITHOUT_POSITION', stage: 'import', message: `${unknownPos}/${seasonPlayers.length} season roster players have no position.` })
  const commaNames = seasonPlayers.filter((p) => /,/.test(String(p.playerName ?? ''))).length
  if (commaNames) run.findings.push({ code: 'IMPORT_NAMES_LAST_COMMA_FIRST', stage: 'import', message: `${commaNames}/${seasonPlayers.length} season roster names are stored in Fantrax's "Last, First" order.` })
  if (rosters.length !== run.teamCount) {
    run.findings.push({ code: 'IMPORT_ROSTER_COUNT', stage: 'import', message: `Imported ${rosters.length} league rosters for a ${run.teamCount}-team league.` })
  }
  if (Number(league.leagueSize) !== run.teamCount) {
    run.findings.push({ code: 'IMPORT_LEAGUE_SIZE', stage: 'import', message: `League.leagueSize is ${league.leagueSize}, expected ${run.teamCount}.` })
  }
  if (seasons.length === 0) {
    run.findings.push({ code: 'IMPORT_NO_SEASON', stage: 'import', message: `No RedraftSeason for an imported ${league.sport} league — lineups, scoring, trades and waivers have no season roster to act on.` })
  } else {
    if (seasonRosters.length !== run.teamCount) run.findings.push({ code: 'IMPORT_SEASON_ROSTER_COUNT', stage: 'import', message: `${seasonRosters.length} season rosters for ${run.teamCount} teams.` })
    if (seasonPlayers.length !== expectedPlayers) run.findings.push({ code: 'IMPORT_SEASON_PLAYER_COUNT', stage: 'import', message: `${seasonPlayers.length} season roster players; Fantrax rosters held ${expectedPlayers}.` })
    const linked = (run.stats.imported as any).linked
    if (linked !== run.teamCount) run.findings.push({ code: 'IMPORT_ROSTERS_NOT_LINKED', stage: 'import', message: `${linked}/${run.teamCount} league rosters linked to the season.` })
  }
}

// ── 2. Managers join and claim their teams ──────────────────────────────────

export async function joinAndClaim(env: ScaleEnv, run: ScaleRun): Promise<void> {
  if (!run.leagueId) return
  const t0 = now()
  const league = (rowsOf(env.db, 'League') as any[]).find((l) => l.id === run.leagueId)
  let code = String((league.settings as any)?.inviteCode ?? '')
  if (!code) {
    // The commissioner opens the invite screen, which creates the league's code.
    const { GET: inviteGet } = await import('@/app/api/commissioner/leagues/[leagueId]/invite/route')
    const { NextRequest: Req } = await import('next/server')
    env.signIn(COMMISH)
    const res = await inviteGet(new Req(`http://sim.allfantasy.test/api/commissioner/leagues/${run.leagueId}/invite`), { params: Promise.resolve({ leagueId: run.leagueId }) })
    const body: any = await res.json().catch(() => null)
    code = String(body?.inviteCode ?? '')
    if (!code) run.findings.push({ code: 'NO_INVITE_CODE', stage: 'join', message: `Invite screen returned ${res.status} ${JSON.stringify(body).slice(0, 200)}` })
  }
  const { POST: joinPost } = await import('@/app/api/leagues/join/route')
  const { POST: claimPost } = await import('@/app/api/leagues/[leagueId]/claim-roster/handler')
  const { NextRequest } = await import('next/server')
  const byTeamName = new Map<string, any>()
  for (const r of (rowsOf(env.db, 'Roster') as any[]).filter((x) => x.leagueId === run.leagueId)) {
    const team = (rowsOf(env.db, 'LeagueTeam') as any[]).find((t) => t.leagueId === run.leagueId && (t.externalId === r.platformUserId || t.id === r.leagueTeamId))
    const name = team?.teamName ?? (r.playerData as any)?.import?.teamName ?? null
    if (name) byTeamName.set(String(name), r)
  }
  let joined = 0
  let claimed = 0
  const refusals: Record<string, number> = {}
  const tally = (k: string) => (refusals[k] = (refusals[k] ?? 0) + 1)
  for (let i = 2; i <= run.teamCount; i += 1) {
    const user = managerFor(i)
    await seedUser(env, user)
    env.signIn(user)
    if (code) {
      const res = await joinPost(new NextRequest('http://sim.allfantasy.test/api/leagues/join', { method: 'POST', body: JSON.stringify({ code }) }))
      if (res.status === 200) joined += 1
      else tally(`join ${res.status} ${JSON.stringify(await res.json().catch(() => null)).slice(0, 120)}`)
    }
    const holds = (rowsOf(env.db, 'Roster') as any[]).find((r) => r.leagueId === run.leagueId && r.platformUserId === user.id)
    if (holds) {
      claimed += 1
      continue
    }
    const target = byTeamName.get(teamNameFor(i)) ?? (rowsOf(env.db, 'Roster') as any[]).filter((r) => r.leagueId === run.leagueId)[i - 1]
    if (!target) {
      tally('no roster for team')
      continue
    }
    const res = await claimPost(
      new NextRequest(`http://sim.allfantasy.test/api/leagues/${run.leagueId}/claim-roster`, { method: 'POST', body: JSON.stringify({ rosterId: target.id }) }),
      { params: Promise.resolve({ leagueId: run.leagueId }) },
    )
    if (res.status === 200) claimed += 1
    else tally(`claim ${res.status} ${JSON.stringify(await res.json().catch(() => null)).slice(0, 120)}`)
  }
  env.signIn(COMMISH)
  run.timings.joinMs = now() - t0
  run.stats.join = { inviteCode: Boolean(code), joined, claimed, refusals }
  if (claimed < run.teamCount - 1) {
    run.findings.push({ code: 'CLAIMS_INCOMPLETE', stage: 'join', message: `${claimed}/${run.teamCount - 1} managers hold a team after join + claim.`, detail: refusals })
  }
  const commishRoster = (rowsOf(env.db, 'Roster') as any[]).find((r) => r.leagueId === run.leagueId && r.platformUserId === COMMISH.id)
  if (!commishRoster) run.findings.push({ code: 'IMPORTER_HOLDS_NO_TEAM', stage: 'join', message: `The importing commissioner does not hold ${teamNameFor(1)}.` })
}

// ── 3. Trades, the evaluator's grades, and the collusion scan ─────────────────

type Seat = { rosterId: string; userId: string; seasonRosterId: string | null }

function seats(env: ScaleEnv, run: ScaleRun): Seat[] {
  return (rowsOf(env.db, 'Roster') as any[])
    .filter((r) => r.leagueId === run.leagueId && /^fx-(mgr|commish)/.test(String(r.platformUserId)))
    .map((r) => ({ rosterId: r.id, userId: r.platformUserId, seasonRosterId: r.redraftRosterId ?? null }))
    .sort((a, b) => (a.userId === COMMISH.id ? -1 : b.userId === COMMISH.id ? 1 : a.userId.localeCompare(b.userId)))
}

function seasonHoldings(env: ScaleEnv, seasonRosterId: string | null) {
  if (!seasonRosterId) return []
  return (rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => p.rosterId === seasonRosterId && !p.droppedAt)
}

/** League-roster (Roster.playerData) player ids — the fallback when no season exists. */
function leagueHoldings(env: ScaleEnv, rosterId: string): string[] {
  const r = (rowsOf(env.db, 'Roster') as any[]).find((x) => x.id === rosterId)
  const data = r?.playerData
  const list = Array.isArray(data) ? data : Array.isArray(data?.players) ? data.players : []
  return list.map((p: any) => String(typeof p === 'string' ? p : p?.id ?? p?.playerId ?? '')).filter(Boolean)
}

async function proposeAndProcess(env: ScaleEnv, run: ScaleRun, label: string, from: Seat, to: Seat, assets: any[]) {
  const { createAfLeagueTrade, acceptAfLeagueTrade, commissionerAfTradeDecision } = await import('@/lib/league-trade-engine/tradeService')
  const leagueId = run.leagueId!
  const t0 = now()
  env.signIn({ id: from.userId, email: `${from.userId}@sim.allfantasy.test`, name: from.userId })
  let tradeId: string
  try {
    tradeId = (await createAfLeagueTrade({ leagueId, proposedByUserId: from.userId, proposerRosterId: from.rosterId, receiverRosterId: to.rosterId, assets } as any)).id
  } catch (e) {
    return { ok: false as const, label, stage: 'propose', error: (e as Error).message, ms: now() - t0 }
  }
  env.signIn({ id: to.userId, email: `${to.userId}@sim.allfantasy.test`, name: to.userId })
  let status: string
  try {
    status = (await acceptAfLeagueTrade({ tradeId, userId: to.userId, leagueId } as any)).status
  } catch (e) {
    return { ok: false as const, label, stage: 'accept', tradeId, error: (e as Error).message, ms: now() - t0 }
  }
  if (status === 'awaiting_commissioner' || status === 'held_for_review') {
    env.signIn(COMMISH)
    try {
      await commissionerAfTradeDecision({ tradeId, leagueId, userId: COMMISH.id, decision: 'approve' } as any)
    } catch (e) {
      return { ok: false as const, label, stage: 'commissioner', tradeId, error: (e as Error).message, ms: now() - t0 }
    }
  }
  env.signIn(COMMISH)
  const row = (rowsOf(env.db, 'AfLeagueTrade') as any[]).find((t) => t.id === tradeId)
  return { ok: true as const, label, tradeId, status: row?.status as string, acceptStatus: status, ms: now() - t0 }
}

const playerAsset = (p: { playerId: string; playerName?: string; position?: string }, from: Seat, to: Seat) => ({
  itemType: 'player',
  itemReference: p.playerId,
  fromRosterId: from.rosterId,
  toRosterId: to.rosterId,
  metadata: { playerName: p.playerName, position: p.position },
})

export async function runTrades(env: ScaleEnv, run: ScaleRun): Promise<void> {
  if (!run.leagueId) return
  const all = seats(env, run)
  run.stats.seatsHeld = all.length
  if (all.length < 6) {
    run.findings.push({ code: 'TOO_FEW_SEATS_FOR_TRADES', stage: 'trades', message: `${all.length} claimed seats; trades need 6.` })
    return
  }
  const holdings = (s: Seat) => {
    const season = seasonHoldings(env, s.seasonRosterId)
    if (season.length) return season.map((p) => ({ playerId: String(p.playerId), playerName: p.playerName, position: p.position, slot: String(p.slotType ?? p.slot ?? '') }))
    return leagueHoldings(env, s.rosterId).map((id) => ({ playerId: id, playerName: env.fx?.playerMap[id]?.name, position: env.fx?.playerMap[id]?.position, slot: '' }))
  }
  const serialOf = (playerId: string) => env.fx?.valueRank[playerId] ?? parseInt(playerId.slice(1), 36)
  const bench = (s: Seat) => holdings(s).filter((p) => /bn|bench|reserve/i.test(p.slot))
  const best = (s: Seat) => [...holdings(s)].sort((a, b) => serialOf(a.playerId) - serialOf(b.playerId))
  const worst = (s: Seat) => [...holdings(s)].sort((a, b) => serialOf(b.playerId) - serialOf(a.playerId))
  const results: any[] = []

  // fair: two late players of similar standing, between seats far apart in a big league
  const a = all[Math.floor(all.length / 2)]!
  const b = all[all.length - 1]!
  const ga = worst(a)[0]
  const gb = worst(b)[0]
  if (ga && gb) {
    const res = await proposeAndProcess(env, run, 'fair', a, b, [playerAsset(ga, a, b), playerAsset(gb, b, a)])
    results.push({ ...res, moved: [[ga.playerId, b], [gb.playerId, a]] })
  }
  // collusion: one pair, three lopsided deals in a row
  const [c, d] = [all[1]!, all[2]!]
  for (let i = 0; i < 3; i += 1) {
    const stud = best(c)[i]
    const scrub = worst(d)[i]
    if (!stud || !scrub) break
    const res = await proposeAndProcess(env, run, `collusion-${i + 1}`, c, d, [playerAsset(stud, c, d), playerAsset(scrub, d, c)])
    results.push({ ...res, moved: [[stud.playerId, d], [scrub.playerId, c]] })
  }
  // future pick + player each way (a dynasty asset in an imported league)
  const [e, f] = [all[3]!, all[4]!]
  const league = (rowsOf(env.db, 'League') as any[]).find((l) => l.id === run.leagueId)
  const nextYear = Number(league?.season ?? 2026) + 1
  const pe = worst(e)[0]
  const pf = worst(f)[0]
  if (pe && pf) {
    const res = await proposeAndProcess(env, run, 'future-pick', e, f, [
      { itemType: 'future_pick', itemReference: `fdp:${nextYear}:1:${e.rosterId}`, fromRosterId: e.rosterId, toRosterId: f.rosterId, metadata: { season: nextYear, round: 1 } },
      playerAsset(pe, e, f),
      playerAsset(pf, f, e),
    ])
    results.push({ ...res, moved: [[pe.playerId, f], [pf.playerId, e]] })
  }
  // the commissioner trades too (the importer is the one most likely to)
  const me = all[0]!
  const partner = all[5]!
  const pm = worst(me)[0]
  const pp = worst(partner)[0]
  if (pm && pp) {
    const res = await proposeAndProcess(env, run, 'commissioner', me, partner, [playerAsset(pm, me, partner), playerAsset(pp, partner, me)])
    results.push({ ...res, moved: [[pm.playerId, partner], [pp.playerId, me]] })
  }

  for (const r of results) {
    if (!r.ok) {
      run.findings.push({ code: `TRADE_FAILED_AT_${String(r.stage).toUpperCase()}`, stage: 'trades', message: `${r.label}: ${r.error}` })
      continue
    }
    if (r.status !== 'completed' && r.status !== 'processed' && r.status !== 'accepted') {
      run.findings.push({ code: 'TRADE_NOT_COMPLETED', stage: 'trades', message: `${r.label} ended ${r.status} (accept said ${r.acceptStatus}).` })
    }
    const shadow = String(((rowsOf(env.db, 'League') as any[]).find((l) => l.id === run.leagueId))?.platform ?? '') !== 'native'
    r.moves = []
    for (const [playerId, to] of r.moved as Array<[string, Seat]>) {
      const seasonHolders = (rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => String(p.playerId) === playerId && !p.droppedAt).map((p) => p.rosterId)
      const genericNow = leagueHoldings(env, to.rosterId)
      r.moves.push({ playerId, seasonMoved: Boolean(to.seasonRosterId) && seasonHolders.length === 1 && seasonHolders[0] === to.seasonRosterId, leagueRosterMoved: genericNow.includes(playerId), leagueRosterSize: genericNow.length })
      if (shadow) continue
      if (to.seasonRosterId) {
        const holders = (rowsOf(env.db, 'RedraftRosterPlayer') as any[]).filter((p) => String(p.playerId) === playerId && !p.droppedAt).map((p) => p.rosterId)
        if (holders.length !== 1 || holders[0] !== to.seasonRosterId) {
          run.findings.push({ code: 'TRADED_PLAYER_NOT_ON_SEASON_ROSTER', stage: 'trades', message: `${r.label}: ${playerId} should be on ${to.userId}'s season roster; on [${holders.join(', ')}].` })
        }
      }
      const generic = leagueHoldings(env, to.rosterId)
      if (generic.length && !generic.includes(playerId)) {
        run.findings.push({ code: 'TRADED_PLAYER_NOT_ON_LEAGUE_ROSTER', stage: 'trades', message: `${r.label}: ${playerId} not in ${to.userId}'s league roster (Roster.playerData).` })
      }
    }
  }
  run.stats.trades = results.map((r) => ({ label: r.label, ok: r.ok, status: r.status, acceptStatus: r.acceptStatus, stage: r.stage, error: r.error, ms: r.ms, moves: r.moves }))

  // evaluator: THE one grade (what the Trade Center shows the proposer), recomputed per trade
  const { proposalOneGrade } = await import('@/lib/league-trade-engine/serverTradeDecision')
  const grades: any[] = []
  for (const r of results.filter((x) => x.ok)) {
    const trade = (rowsOf(env.db, 'AfLeagueTrade') as any[]).find((t) => t.id === r.tradeId)
    const items = (rowsOf(env.db, 'AfLeagueTradeItem') as any[]).filter((i) => i.tradeId === r.tradeId)
    const t0 = now()
    try {
      const g: any = await proposalOneGrade({
        leagueId: run.leagueId!,
        proposerRosterId: trade.proposerRosterId,
        proposedByUserId: trade.proposedByUserId,
        assets: items.map((i) => ({ itemType: i.itemType, itemReference: i.itemReference, fromRosterId: i.fromRosterId, toRosterId: i.toRosterId, faabAmount: i.faabAmount, metadata: i.metadata ?? {} })) as any,
      })
      grades.push({
        label: r.label, ms: now() - t0, grade: g?.grade ?? g?.letter ?? null,
        withheld: g?.withheld ?? g?.withheldReason ?? g?.reason ?? null,
        basis: g?.basis ?? null, raw: JSON.stringify(g).slice(0, 260),
      })
    } catch (e) {
      grades.push({ label: r.label, threw: (e as Error).message })
    }
  }
  run.stats.tradeGrades = grades
  const lopsided = grades.find((g) => g.label === 'collusion-1')
  const fairG = grades.find((g) => g.label === 'fair')
  if (grades.length && grades.every((g) => !g.grade)) {
    run.findings.push({ code: 'EVALUATOR_WITHHOLDS_EVERY_GRADE', stage: 'evaluator', message: `No trade got a grade: ${String(grades[0]?.withheld ?? grades[0]?.raw ?? grades[0]?.threw).slice(0, 200)}` })
  } else if (lopsided?.grade && fairG?.grade && lopsided.grade === fairG.grade) {
    run.findings.push({ code: 'EVALUATOR_LOPSIDED_EQUALS_FAIR', stage: 'evaluator', message: `A star-for-scrub deal graded ${lopsided.grade}, the same as the fair swap.` })
  }

  // integrity: what the scan flagged, then a full-league scan run directly
  const flagsAfter = () => (rowsOf(env.db, 'IntegrityFlag') as any[]).filter((fl) => fl.leagueId === run.leagueId)
  run.stats.flagsAfterTrades = flagsAfter().map((fl) => ({ type: fl.flagType ?? fl.type, severity: fl.severity }))
  try {
    const { fullLeagueCollusionScan } = await import('@/lib/integrity/CollusionDetectionEngine')
    const t0 = now()
    const out = await (fullLeagueCollusionScan as any)(run.leagueId)
    run.timings.fullCollusionScanMs = now() - t0
    run.stats.fullScan = JSON.stringify(out).slice(0, 400)
  } catch (e) {
    run.stats.fullScan = `THREW: ${(e as Error).message}`
    run.findings.push({ code: 'COLLUSION_SCAN_THREW', stage: 'integrity', message: (e as Error).message })
  }
  const flags = flagsAfter()
  run.stats.integrityFlags = flags.map((fl) => ({ type: fl.flagType ?? fl.type, severity: fl.severity, ref: fl.tradeId ?? fl.entityId ?? null }))
  const collusionOk = results.filter((r) => String(r.label).startsWith('collusion') && r.ok)
  const flagged = new Set(flags.map((fl) => fl.tradeId ?? fl.entityId ?? fl.metadata?.tradeId).filter(Boolean))
  const pairFlag = flags.some((fl) => /repeat|pair|collu/i.test(String(fl.flagType ?? fl.type ?? '')))
  if (collusionOk.length && !collusionOk.some((r) => flagged.has(r.tradeId)) && !pairFlag) {
    run.findings.push({ code: 'COLLUSION_NOT_FLAGGED', stage: 'integrity', message: `${collusionOk.length} lopsided deals between one pair, no integrity flag.` })
  }
  const fair = results.find((r) => r.label === 'fair' && r.ok)
  if (fair && flagged.has(fair.tradeId)) run.findings.push({ code: 'FAIR_TRADE_FLAGGED', stage: 'integrity', message: 'The fair swap was flagged.' })
}

// ── 4. Rankings and Chimmy's tools (deterministic, no model call) ───────────

export async function runRankAndChimmy(env: ScaleEnv, run: ScaleRun): Promise<void> {
  if (!run.leagueId) return
  try {
    const { calculateAndSaveRank } = await import('@/lib/rank/calculateRank')
    const t0 = now()
    run.timings.rankMs = now() - t0
    const rankResult = await (calculateAndSaveRank as any)(COMMISH.id)
    const profile = (rowsOf(env.db, 'UserProfile') as any[]).find((r) => r.userId === COMMISH.id)
    run.stats.rank = {
      result: rankResult ? JSON.stringify(rankResult).slice(0, 300) : null,
      profile: profile ? { tier: profile.rankTier ?? null, xp: profile.xpTotal ?? null, wins: profile.careerWins ?? null, leagues: profile.careerLeaguesPlayed ?? profile.totalLeagues ?? null } : null,
    }
    if (!rankResult) run.findings.push({ code: 'RANK_EMPTY_LEDGER', stage: 'rank', message: 'calculateAndSaveRank found no career rows for the importing commissioner.' })
  } catch (e) {
    run.stats.rank = `THREW: ${(e as Error).message}`
    run.findings.push({ code: 'RANK_THREW', stage: 'rank', message: (e as Error).message })
  }
  const { executeChimmyTool } = await import('@/lib/chimmy/tools/chimmyTools')
  const ctx = { leagueId: run.leagueId, userId: COMMISH.id } as any
  const mine = seats(env, run)[0]
  const playersFor = (seat: Seat | undefined) => {
    if (!seat) return []
    const season = seasonHoldings(env, seat.seasonRosterId)
    return season.length ? season : leagueHoldings(env, seat.rosterId).map((id) => ({ playerName: env.fx?.playerMap[id]?.name }))
  }
  const myPlayers = playersFor(mine)
  const theirs = seats(env, run)[seats(env, run).length - 1]
  const theirPlayers = playersFor(theirs)
  const out: Record<string, unknown> = {}
  const toolTimes: Record<string, number> = {}
  for (const [name, args] of [
    ['get_league_standings', {}],
    ['get_my_roster', {}],
    ['get_league_trade_history', {}],
    ['get_league_trade_activity', {}],
    ['evaluate_trade', { give: myPlayers[0] ? [myPlayers[0].playerName] : [], get: theirPlayers[0] ? [theirPlayers[0].playerName] : [] }],
    ['find_trade_ideas', {}],
  ] as const) {
    const t0 = now()
    try {
      const text = await executeChimmyTool(name, args as any, ctx)
      out[name] = String(text).slice(0, 500)
    } catch (e) {
      out[name] = `THREW: ${(e as Error).message}`
      run.findings.push({ code: 'CHIMMY_TOOL_THREW', stage: 'chimmy', message: `${name}: ${(e as Error).message}` })
    }
    toolTimes[name] = now() - t0
  }
  run.stats.chimmy = out
  run.timings.chimmy = toolTimes as unknown as number
  const okTrades = ((run.stats.trades as any[]) ?? []).filter((t) => t.ok).length
  const history = String(out.get_league_trade_history ?? '') + String(out.get_league_trade_activity ?? '')
  if (okTrades && /no trades|none found|NO_TRADES|no completed/i.test(history) && !/accepted|completed .*trade|traded/i.test(history)) {
    run.findings.push({ code: 'CHIMMY_MISSES_TRADES', stage: 'chimmy', message: `Chimmy's trade tools report no trades; ${okTrades} completed.` })
  }
  const standings = String(out.get_league_standings ?? '')
  run.stats.chimmyStandingsTeams = (standings.match(/Team \d{3}/g) ?? []).length
}
