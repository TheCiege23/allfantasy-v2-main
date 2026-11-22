const assert = require('node:assert/strict')
const { prisma } = require('../prisma')
const { loadLeaguePlayerMetrics } = require('../af-projections/leaguePlayerMetrics')
const { loadLeagueRosterWeeks } = require('../af-projections/leagueRosterWeek')
const { loadMatchupAfProjections } = require('../matchup-center/afProjections')
const { buildPlayerProjectionContext } = require('../chimmy/tools/playerProjectionTool')
const { rosteredIdsOf } = require('../decision-os/trade/tradePlayers')
const { writeAfProjectionSnapshotsForSeason } = require('../af-projections/writeAfProjectionSnapshots')
const { extractSeasonAggregate } = require('../af-projections/core')
const { resolveSportWeek } = require('../season-week/seasonWeekService')
const { normalize, sources, databaseEvidence, readSource, schoolStats } = require('../workers/providers/collegeRecheckEvidence.cjs')
const { refreshCollegeBoxProjections } = require('./refreshCollegeBoxProjections')
const { resolveCollegeRecheckLeague } = require('./collegeRecheckLeague')
const { easternCalendarDay } = require('../sports-data/easternGameDay')
const { redactAndCap } = require('../security/redactSecrets')

// Fantrax roster ID, name, RI ID, ESPN ID and optional alternate spelling.
const groups = [
  { sport: 'NCAAF', controls: ['078dv','06ycq'], players: [
    ['076fw','Braxton Lillis','68313','5383054'], ['063i6','Diante Griffin','66225','5081815'],
    ['07814','Elijah Fernandez','62174','5291758'], ['076ox','Roderick Bingham','67577','5327500'],
    ['077fz','Isaac Richardson','62454','5381558'], ['076vy','Jacob Arbuckle II','63483','5289840','Jacob Arbuckle'],
    ['076oo','Tyler Stearman','67256','5394413'], ['076l6','Beau Wendel','65417'],
    ['076hz','Paul Kouame','67893','5384722'], ['074o5','Travis Burgess','61641','5199937'],
  ]},
  { sport: 'NCAAB', controls: ['068yl','0713y'], players: [
    ['01atq','Adam Miller'], ['0725p','CJ Ray'],
  ]},
]

async function refreshFootball(players, season) {
  const links = await prisma.playerIdentityMap.findMany({ where: { sport: 'NCAAF', fantraxId: { in: players.map(p => p[0]) } },
    select: { fantraxId: true, cfbdId: true, canonicalName: true } })
  const wanted = new Map()
  for (const [id, name,,,alias] of players) {
    const owners = links.filter(row => row.fantraxId === id)
    if (owners.length === 1 && owners[0].cfbdId && [name, alias].filter(Boolean).some(n => normalize(n) === normalize(owners[0].canonicalName))) {
      wanted.set(owners[0].cfbdId, [name, alias].filter(Boolean).map(normalize))
    }
  }
  const ids = [...wanted.keys()]
  if (!ids.length) return []
  const [lines, snapshots, allOwners] = await Promise.all([
    prisma.fantasyStatLine.findMany({ where: { sport: 'NCAAF', season: String(season), source: 'cfbd', week: 0, playerId: { in: ids } } }),
    prisma.aFProjectionSnapshot.findMany({ where: { sport: 'NCAAF', season, week: null, eventId: null, playerId: { in: ids } } }),
    prisma.playerIdentityMap.findMany({ where: { sport: 'NCAAF', cfbdId: { in: ids } }, select: { cfbdId: true } }),
  ])
  const rebuild = lines.filter(line => {
    const agg = extractSeasonAggregate(line.stats)
    if (!agg || agg.gamesPlayed < 2 || !wanted.get(line.playerId)?.includes(normalize(line.stats.riPlayerName))) return false
    if (allOwners.filter(r => r.cfbdId === line.playerId).length !== 1) return false
    const snap = snapshots.find(s => s.playerId === line.playerId)
    return !snap || snap.adjustmentFactors?.sourceSeason !== season || snap.computedAt < line.fetchedAt
  }).map(l => l.playerId)
  if (!rebuild.length) return []
  const r = await writeAfProjectionSnapshotsForSeason({ sport: 'NCAAF', playerIds: rebuild, sourceSeason: season,
    targetSeason: season, writeWeeklySnapshots: false })
  if (r.errors.length) throw Error('AF writer errors: ' + r.errors.join(', '))
  return [{ requested: rebuild, written: r.written, refusals: r.refusalsByReason }]
}

async function check(group, league) {
  const { sport, players, controls } = group
  const leagueId = league.id
  assert.equal(league.sport, sport); assert.equal(league.platform, 'fantrax')
  const season = league.season
  assert(Number.isInteger(season))
  const signal = await resolveSportWeek(sport, season, { now: new Date() })
  if (!signal.ok) throw Error(sport + ' calendar: ' + signal.reason)
  const week = signal.state === 'played' ? signal.nextSportWeek : signal.sportWeek
  if (signal.seasonType !== 'regular' || !Number.isInteger(week)) return { sport, season, checked: players.length, phase: signal.seasonType, state: signal.state, weeklyWindow: false }
  const warnings = []
  const evidence = await sources(group, season, warnings)
  await databaseEvidence(group, season, evidence)
  if (sport === 'NCAAF') {
    for (let offset = 0; offset < players.length; offset += 4) {
      await Promise.all(players.slice(offset, offset+4).map(async ([id,name]) => {
        try {
          evidence[id].school = await readSource(() => schoolStats(id,name,season))
          if (evidence[id].school.status !== 'read') warnings.push(name + ': official school table unavailable')
        }
        catch (err) { warnings.push(name + ': official school ' + err.message) }
      }))
    }
  }
  const boxRefresh = await refreshCollegeBoxProjections(sport, season, players.map(([id, name, riId,,alias]) => ({
    rosterId: id, name, riId, acceptedNames: [name, alias].filter(Boolean),
    dates: evidence[id].gameLog?.events.map(event => easternCalendarDay(new Date(event.date))?.toISOString().slice(0, 10)).filter(Boolean) ?? [],
  })))
  warnings.push(...boxRefresh.warnings)
  const writer = sport === 'NCAAF' ? await refreshFootball(players, season) : []
  writer.push({ requested: boxRefresh.requested, written: boxRefresh.written, boxesWritten: boxRefresh.boxesWritten,
    linkedPlayers: boxRefresh.linkedPlayers, noGameDates: boxRefresh.noGameDates })
  const ids = [...controls, ...players.map(p => p[0])]
  const boardFor = ids => loadLeaguePlayerMetrics({ leagueId, week, rosterIds: ids, limit: ids.length, includeTradeValues: false })
  const os = await boardFor(ids)
  assert.equal(os?.season, season); assert.equal(os.week, week); assert.equal(os.unit, 'fantasy points')
  let control = os.rows.find(row => controls.includes(row.rosterPlayerId) && row.weekly > 0)
  if (!control) {
    const savedRosters = await prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } })
    const candidates = [...new Set(savedRosters.flatMap(row => rosteredIdsOf(row.playerData)))].filter(id => !ids.includes(id))
    const board = candidates.length ? await loadLeaguePlayerMetrics({
      leagueId, week, rosterIds: candidates, limit: 100, includeTradeValues: false,
    }) : null
    control = board?.rows.find(row => row.rosterPlayerId && row.weekly > 0)
  }
  assert(control?.rosterPlayerId, sport + ': no rostered player with a positive weekly projection for comparison')
  const comparedIds = [...new Set([...ids, control.rosterPlayerId])]
  const [rosters, matchup] = await Promise.all([
    loadLeagueRosterWeeks([{ leagueId, season, week, ids: comparedIds }], { fresh: true }),
    loadMatchupAfProjections({ leagueId, season, week, sport, platform: league.platform, leagueSettings: league.settings, playerIds: comparedIds })
  ])
  const roster = rosters.get(leagueId)
  assert(roster)
  assert.equal(roster.get(control.rosterPlayerId)?.points, control.weekly, sport + ': roster control')
  assert.equal(matchup.get(control.rosterPlayerId), control.weekly, sport + ': matchup control')
  const example = await buildPlayerProjectionContext({ leagueId, sport, week, playerName: control.playerName })
  assert(example.includes('Week ' + week + ': ' + control.weekly.toFixed(2) + ' fantasy points'), sport + ': Chimmy control failed')
  const results = []
  for (const [id, name, , , alias] of players) {
    const af = os.rows.find(row => row.rosterPlayerId === id)?.weekly ?? null
    const rosterValue = roster.get(id)?.points ?? null
    const matchupValue = matchup.get(id) ?? null
    assert.equal(af, rosterValue, name + ': roster parity')
    assert.equal(af, matchupValue, name + ': matchup parity')
    for (const asked of new Set([name, alias ?? name])) {
      const answer = await buildPlayerProjectionContext({ leagueId, sport, week, playerName: asked })
      const matched = af === null ? answer.includes('no matching projection') || answer.includes('Weekly estimate unavailable') :
        answer.includes('Week ' + week + ': ' + af.toFixed(2) + ' fantasy points')
      assert(matched && !answer.includes('Several players'), name + ': Chimmy parity')
    }
    const e = evidence[id]
    const hasBox = e.collegeBoxes?.length || e.gameLog?.events.length || e.seasonLines.length || e.cfbd?.length
    const schoolComponents = e.school?.lines.some(r => Object.keys(r).some(k => !['gamesPlayed','playerName','playerRosterBioId'].includes(k)))
    const review = af === null && (hasBox || schoolComponents || sport === 'NCAAB' && e.directory) ? 'verify_current_scoring_evidence' : null
    results.push({ id, name, weekly: af, review, evidence: e })
  }
  return { sport, season, week, checked: results.length, projected: results.filter(r => r.weekly !== null).length, control: { name: control.playerName, weekly: control.weekly }, writer, warnings: warnings.map(w => redactAndCap(w, 250)), results }
}

// Only the deployment's private configuration contains the two imported league IDs.
/** @returns {Promise<Array<{sport:string, season?:number, week?:number, checked?:number, projected?:number, weeklyWindow?:boolean, warnings?:string[], writer?:Array<{written:number, boxesWritten?:number}>, error?:string}>>} */
async function runCollegeProjectionRecheck() {
  const config = await prisma.sportsDataCache.findUniqueOrThrow({ where: { cacheKey: 'af:college-weekly-recheck:leagues' } })
  const outcomes = await Promise.allSettled(groups.map(async group => {
    const league = await resolveCollegeRecheckLeague(config.data, group.sport)
    return check(group, league)
  }))
  return outcomes.map((outcome, i) => outcome.status === 'fulfilled'
    ? outcome.value
    : { sport: groups[i].sport, error: outcome.reason instanceof Error ? redactAndCap(outcome.reason.message, 500) : 'recheck failed' })
}

module.exports = { runCollegeProjectionRecheck }
