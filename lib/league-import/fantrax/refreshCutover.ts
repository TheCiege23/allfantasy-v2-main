import { prisma } from '@/lib/prisma'
import { getFantraxMatchupScores, getFantraxStandings, type FantraxPeriodScore } from './fantraxApi'
import { fantraxCategoryTieWinner } from './fantraxPublicRules'
import { object, readCutover } from './cutoverPolicy'
import { saveCutover } from './installCutover'
import { updateStandings } from '@/lib/redraft/standingsEngine'

type Fixture = { id: string; homeRosterId: string; awayRosterId: string | null; lineupSnapshots: unknown }
export function refreshScores(fixtures: Fixture[], scores: FantraxPeriodScore, rules: string[], closed: boolean) {
  const pairs = new Map<string, typeof scores.matchups>()
  const key = (a: string,b: string) => JSON.stringify([a,b].sort())
  for (const row of scores.matchups) {
    const k = key(row.home.teamId,row.away.teamId)
    const list = pairs.get(k) ?? []
    list.push(row)
    pairs.set(k,list)
  }
  return fixtures.map(m => {
    const snapshot = object(m.lineupSnapshots), source = object(snapshot.fantraxCutover)
    const rows = pairs.get(key(source.homeTeam,source.awayTeam))
    if (!rows?.length) throw Error('Fantrax has not returned every scheduled pairing.')
    const values = rows.map(r => {
      const [home,away] = r.home.teamId === source.homeTeam ? [r.home,r.away] : [r.away,r.home]
      const played = home.gamesPlayed > 0 || away.gamesPlayed > 0
      const tie = played && home.score === away.score ? fantraxCategoryTieWinner(rules,r.categoryOutcomes) : null
      return { homeScore: home.score, awayScore: away.score, played, winner: tie === source.homeTeam ? m.homeRosterId : tie === source.awayTeam ? m.awayRosterId : null }
    })
    const first = values[0]
    if (values.some(v => JSON.stringify(v) !== JSON.stringify(first)) || (closed && !first.played)) throw Error('An official result is missing or conflicting.')
    return { id: m.id, homeScore: first.homeScore, awayScore: first.awayScore, status: closed ? 'final' : first.played ? 'active' : 'scheduled',
      lineupSnapshots: { ...snapshot, fantraxCutover: { ...source, winner: first.winner } } }
  })
}

/** The source owns this period until all of its official final results can be committed together. */
export async function refreshCutover(leagueId: string, seasonId: string, now = new Date()) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
  const cut = readCutover(league.settings)
  if (!cut || cut.installedSeasonId !== seasonId || cut.settled) return
  const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: cut.snapshotId }, select: { sourceLeagueId: true } })
  const providerId = snapshot?.sourceLeagueId
  if (!providerId) return
  const closed = now.getTime() > Date.parse(cut.periods[cut.period-1].endDate)
  const result = await getFantraxMatchupScores(providerId, cut.period)
  if (!result.ok || result.data.period !== cut.period) throw Error('Waiting for the official Fantrax scoreboard.')
  const fixtures = await prisma.redraftMatchup.findMany({ where: { seasonId, week: cut.period } })
  const updates = refreshScores(fixtures,result.data,object(object(league.settings).fantrax_public_rules).matchupTies ?? [],closed)
  if (!updates.length) throw Error('Missing scoring-period fixtures.')
  if (closed) {
    const standing = await getFantraxStandings(providerId)
    if (!standing.ok) throw Error('Waiting for official standings after the period close.')
    const records = new Map<string,number[]>()
    const prior = await prisma.redraftMatchup.findMany({ where: { seasonId, week: { lt:cut.period }, status:'final' } })
    for (const m of [...prior,...updates]) {
      const s = object(object(m.lineupSnapshots).fantraxCutover)
      const home = records.get(s.homeTeam) ?? [0,0,0], away = records.get(s.awayTeam) ?? [0,0,0]
      const id = fixtures.find(f => f.id === m.id)?.homeRosterId ?? ('homeRosterId' in m ? m.homeRosterId : null)
      const h = m.homeScore === m.awayScore ? !s.winner ? 2 : s.winner === id ? 0 : 1 : m.homeScore > m.awayScore ? 0 : 1
      home[h]++; away[h === 2 ? 2 : 1-h]++
      records.set(s.homeTeam,home); records.set(s.awayTeam,away)
    }
    // A delayed import can see standings that already include later periods. Require at least every
    // official W/L/T earned through the handoff. Equal totals give an exact result at the boundary.
    if (records.size !== standing.data.length || standing.data.some(t => !records.has(t.teamId) || [t.wins,t.losses,t.ties].some((n,i) => n < records.get(t.teamId)![i]))) throw Error('Fantrax has not posted matching final standings.')
  }
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const latest = readCutover((await tx.league.findUniqueOrThrow({ where: { id:leagueId }, select:{settings:true} })).settings)
    if (!latest || latest.installedSeasonId !== seasonId || latest.settled || (latest.lastSourceReadAt && Date.parse(latest.lastSourceReadAt)>=now.getTime())) return
    latest.lastSourceReadAt=now.toISOString()
    for (const { id,...data } of updates) await tx.redraftMatchup.update({ where:{id}, data })
    if (closed) {
      latest.settled = true
      latest.nativeFrom = cut.period+1
      latest.reason = 'Fantrax finalized the selected period. AllFantasy owns subsequent periods.'
    }
    await saveCutover(tx,leagueId,latest)
  },{ timeout:60000 })
  if (closed) {
    const season = await prisma.redraftSeason.findUniqueOrThrow({ where:{id:seasonId}, select:{currentWeek:true} })
    await updateStandings(seasonId,Math.max(season.currentWeek,cut.period))
  }
}
