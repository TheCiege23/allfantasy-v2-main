// One-shot staging replay. League IDs come from the operator. Only public source data is read.
// QA team aliases and an isolated app account keep every staging claim synthetic.
const { randomUUID, createHash } = require('node:crypto')
const { prisma } = require('../lib/prisma.ts')
const { fetchFantraxLeagueForImport } = require('../lib/league-import/fantrax/FantraxLeagueFetchService.ts')
const { FantraxAdapter } = require('../lib/league-import/adapters/fantrax/FantraxAdapter.ts')
const { buildCanonicalImportBundle } = require('../lib/league-import/canonicalImportNormalizer.ts')
const { persistImportedLeagueFromNormalization } = require('../lib/league-import/ImportedLeagueCommitService.ts')
const { resolveFantraxChampionTeamId } = require('../lib/league-import/fantrax/FantraxHistoricalBackfillService.ts')
const publicFetch = global.fetch
const api = 'https://www.fantrax.com/fxea/general/'
const sports = ['NBA', 'MLB', 'NFL', 'NCAAB', 'NHL']
const stagingOrigin='https://league-lifecycle-rc-1694980a-redraft-qa.up.railway.app'
async function signIn(login,password) {
  const csrf=await publicFetch(stagingOrigin+'/api/auth/csrf',{redirect:'error'})
  if(!csrf.ok)throw Error('QA sign-in CSRF '+csrf.status)
  const cookie=csrf.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  const csrfToken=(await csrf.json()).csrfToken
  const r=await publicFetch(stagingOrigin+'/api/auth/callback/credentials',{method:'POST',redirect:'manual',
    headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrfToken,login,password,json:'true',callbackUrl:stagingOrigin})})
  const session=r.headers.getSetCookie().filter(c=>c.includes('session-token')).map(c=>c.split(';')[0]).join('; ')
  if(!session)throw Error('Staging QA login did not create a session ('+r.status+')')
  return session
}
async function screen(route,cookie) {
  const r=await publicFetch(stagingOrigin+route,{redirect:'error',headers:{cookie},signal:AbortSignal.timeout(90000)})
  if(!r.ok)throw Error('Staging '+route.split('?')[0]+' returned '+r.status)
  return r.json()
}
const close = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) < 0.0001
async function read(endpoint, id, params = {}) {
  const query = new URLSearchParams({ leagueId: id, ...params })
  for (let attempt=0; attempt<3; attempt++) {
    const r = await publicFetch(api+endpoint+'?'+query, {signal:AbortSignal.timeout(30000)})
    if ((r.status === 429 || r.status >= 500) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)))
      continue
    }
    if (!r.ok) throw Error(endpoint+' returned '+r.status)
    const data=await r.json()
    if (data.error) throw Error(endpoint+' returned a provider error')
    return data
  }
}
async function capture(id) {
  const info=await read('getLeagueInfo',id)
  const rosterData=await read('getTeamRosters',id)
  const rosters=rosterData.rosters??rosterData
  const standings=await read('getStandings',id)
  const periods=[]
  for (const p of info.scoringPeriods) {
    if (Date.parse(p.startDate)>Date.now()) continue
    const data=await read('getMatchupScores',id,{period:String(p.number)})
    if (data.period!==p.number || !Array.isArray(data.matchups)) throw Error('Missing source period '+p.number)
    periods.push({...data,ended:Date.parse(p.endDate)<Date.now()})
  }
  const rulesUrl = 'https://www.fantrax.com/newui/fantasy/leagueRulesSummary.go?leagueId='
  const summary = await publicFetch(rulesUrl + encodeURIComponent(id), { signal: AbortSignal.timeout(20000) })
  if (!summary.ok) throw Error('Missing public league rules')
  const rulesHtml = await summary.text()
  return { info, standings, periods, rosters, rulesUrl, rulesHtml }
}
function replayTransport(source,sport,key) {
  const ids=Object.keys(source.info.teamInfo)
  const names=new Map(ids.map((id,i)=>[id,'QA '+key+' team '+(i+1)]))
  const sid=new Map(ids.map((id,i)=>[id,'t'+(i+1)]))
  const side=t=> t?.id ? {id:sid.get(t.id),name:names.get(t.id)} : null
  const scored=t=> t?.teamId ? {...t,teamId:sid.get(t.teamId),teamName:names.get(t.teamId)} : null
  const {info,standings,periods}=source
  const teamInfo=Object.fromEntries(ids.map(id=>[sid.get(id),{...side({id}),division:info.teamInfo[id].division}]))
  const matchups=info.matchups.map(w=>({period:w.period,matchupList:(w.matchupList||[]).map(p=>({away:side(p.away),home:side(p.home)}))}))
  const cleanInfo={...info,teamInfo,matchups,leagueName:'QA season parity '+key}
  const scores=new Map(periods.map(p=>[p.period,{period:p.period,matchups:p.matchups.map(m=>({...m,away:scored(m.away),home:scored(m.home)}))}]))
  const rows=Array.isArray(standings)?standings:standings.standings
  const dataset = {
    getLeagueInfo:cleanInfo, getStandings:rows.map(scored),
    getTeamRosters:Object.fromEntries(ids.map(id=>[sid.get(id),{teamName:names.get(id),rosterItems:source.rosters[id].rosterItems}])),
    getDraftResults:{draftPicks:[]},getDraftPicks:{},
  }
  return { names,rows, fetch:async(input,init)=>{
    const href=typeof input==='string'?input:input.url || String(input)
    if (href === source.rulesUrl + key) return new Response(source.rulesHtml, {headers:{'content-type':'text/html'}})
    if(!href.startsWith(api))return publicFetch(input,init)
    const u=new URL(href),ep=u.pathname.split('/').at(-1)
    let data
    if(ep==='getPlayerIds'){
      return publicFetch(input,init)
    }else if(u.searchParams.get('leagueId')!==key)throw Error('Unexpected fixture league')
    else if(ep==='getMatchupScores')data=scores.get(Number(u.searchParams.get('period')))
    else data=dataset[ep]
    if(data===undefined)throw Error('Unexpected replay endpoint '+ep)
    return Response.json(data)
  }}
}
async function runCase(userId,sport,id,index,runId,cookie) {
  const source=await capture(id), key='qa'+runId+String(index).padStart(6,'0')
  const replay=replayTransport(source,sport,key)
  const orig=[...replay.names.keys()]
  global.fetch=replay.fetch
  let snapshotId
  try {
    const payload=await fetchFantraxLeagueForImport(userId,'fantrax-league:'+key+'|'+replay.names.get(orig[0]))
    snapshotId=payload.league.leagueId
    const normalized=await FantraxAdapter.normalize(payload)
    const canonicalBundle=buildCanonicalImportBundle(normalized)
    const result=await persistImportedLeagueFromNormalization({userId,provider:'fantrax',normalized,canonicalBundle})
    const leagueId=result.league.id
    const deadline=Date.now()+180000
    let backfill
    do {
      const row=await prisma.league.findUniqueOrThrow({where:{id:leagueId},select:{settings:true}})
      backfill=row.settings?.historicalBackfillStatus
      if(backfill && backfill!=='pending')break
      await new Promise(resolve=>setTimeout(resolve,1000))
    } while(Date.now()<deadline)
    const [league,teams,season,facts] = await Promise.all([
      prisma.league.findUniqueOrThrow({where:{id:leagueId},select:{playoffStartWeek:true,playoffTeams:true,settings:true}}),
      prisma.leagueTeam.findMany({where:{leagueId},select:{externalId:true,teamName:true,currentRank:true,wins:true,losses:true,ties:true,pointsFor:true}}),
      prisma.redraftSeason.findFirstOrThrow({where:{leagueId},select:{id:true,currentWeek:true,totalWeeks:true,playoffStartWeek:true,status:true}}),
      prisma.matchupFact.findMany({where:{leagueId},select:{teamA:true,teamB:true,weekOrPeriod:true,scoreA:true,scoreB:true,winnerTeamId:true}}),
    ])
    const byName=new Map(teams.map(t=>[t.teamName,t]))
    const external=id=>byName.get(replay.names.get(id))?.externalId
    const rosterRows=await prisma.roster.findMany({where:{leagueId},select:{playerData:true}})
    const rosterByTeam=new Map(rosterRows.map(r=>[r.playerData.source_team_id,r.playerData]))
    const sorted=ids=>[...ids].sort().join('|')
    let matchedRosters=0,sourcePlayers=0,suppliedRoster=null,matchedActiveGroups=0
    for(const id of orig){
      const sourceRows=source.rosters[id].rosterItems
      const ids=sourceRows.map(p=>p.id)
      const row=rosterByTeam.get(external(id))
      sourcePlayers+=ids.length
      if(row && sorted(row.players||[])===sorted(ids))matchedRosters++
      const active=sourceRows.filter(p=>p.status==='ACTIVE').map(p=>p.id)
      if(row && sorted(row.starters||[])===sorted(active))matchedActiveGroups++
      const signature=createHash('sha256').update(sorted(ids)).digest('hex')
      if(process.env.QA_ROSTER_FINGERPRINT && signature===process.env.QA_ROSTER_FINGERPRINT){
        const positions={RWT:'FLEX',SFX:'SUPER_FLEX',ID:'IDP_FLEX'}
        suppliedRoster={players:ids.length,storedPlayers:row?.players?.length,starters:active.length,ir:row?.reserve?.length,
          matchedStarterSlots:sourceRows.filter(p=>p.status==='ACTIVE' && row?.starter_slot_by_id?.[p.id]===(positions[p.position]||p.position)).length,
          samePlayers:sorted(row?.players||[])===sorted(ids)}
      }
    }
    const stored=new Map(facts.map(f=>[[f.weekOrPeriod,...[f.teamA,f.teamB].sort()].join('|'),f]))
    let matchedRecords=0,matchedRank=0,matchedPF=0,availablePF=0,games=0,matchedScores=0,matchedContributions=0,matchedRebuiltRecords=0
    const records=new Map(orig.map(id=>[id,[0,0,0]]))
    for(const p of source.periods.filter(p=>p.ended)) for(const m of p.matchups) {
      if(!m.away?.teamId || !m.home?.teamId || !(m.away.gamesPlayed>0 || m.home.gamesPlayed>0))continue
      games++
      const a=external(m.away.teamId),b=external(m.home.teamId)
      const f=stored.get([p.period,...[a,b].sort()].join('|'))
      if(f && close(f.teamA===a?f.scoreA:f.scoreB,m.away.score) && close(f.teamB===b?f.scoreB:f.scoreA,m.home.score))matchedScores++
      for(const [side,other] of [['away','home'],['home','away']]) {
        const team=m[side]
        const record=records.get(team.teamId)
        record[team.score>m[other].score?0:team.score<m[other].score?1:2]++
        if (!Array.isArray(m.categories) || !m.categories.length)continue
        const tally=m.categories.reduce((sum,c)=>{const stat=c[side];return sum+(stat?.outcome==='WIN'?1:stat?.outcome==='TIE'?0.5:Number(stat?.points??0))},0)
        if(close(tally,team.score))matchedContributions++
      }
    }
    for(const t of replay.rows){
      const actual=byName.get(replay.names.get(t.teamId))
      if(actual && [actual.wins,actual.losses,actual.ties].join('-')===t.points)matchedRecords++
      if(actual && actual.currentRank===t.rank)matchedRank++
      if(t.totalPointsFor!=null){availablePF++;if(close(actual?.pointsFor,t.totalPointsFor))matchedPF++}
      if(records.get(t.teamId)?.join('-')===t.points)matchedRebuiltRecords++
    }
    const expected=source.info.playoffs
    const ruleText=source.rulesHtml.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')
    const reseed=/Reseed each playoff round\s*:\s*(Yes|No)/i.exec(ruleText)?.[1]?.toLowerCase()
    const keeperType=/Keeper league Type\s*:\s*(Dynasty|Keeper|Redraft)/i.exec(ruleText)?.[1]?.toLowerCase()
    const divisionTop=/Playoff Seeding\s*:+\s*Division winners get top seeds/i.test(ruleText)
    const policy=league.settings.fantrax_settings?.publicRules
    const policyPass=!!reseed && policy?.reseed===(reseed==='yes') && policy.keeperType===keeperType &&
      (policy.divisionWinners==='top_seeds')===divisionTop && !!policy.standingsTies?.length &&
      !!policy.matchupTies?.length && !!policy.playoffTies?.length && !!policy.standingsOrder?.length &&
      JSON.stringify(policy.standingsOrder)===JSON.stringify(league.settings.tiebreaker_order) &&
      (!keeperType || league.settings.league_type===keeperType) &&
      league.settings.playoff_structure?.reseed_behavior===(reseed==='yes'?'reseed_after_each_round':'fixed_bracket')
    const { loadSeasonRosterDivisions } = require('../lib/league/divisions/loadLeagueDivisions.ts')
    const seasonRosters = await prisma.redraftRoster.findMany({where:{seasonId:season.id},select:{id:true,ownerId:true,teamName:true}})
    const divisions=await loadSeasonRosterDivisions(leagueId,seasonRosters)
    const groupNames=new Map(seasonRosters.map(r=>[r.teamName,divisions?.byRoster.get(r.id)?.name]))
    const dividedTeams=orig.filter(id=>Boolean(source.info.teamInfo[id].division))
    const divisionMatches=dividedTeams.filter(id=>groupNames.get(replay.names.get(id))===source.info.teamInfo[id].division).length
    const divisionPass=!divisionTop || divisions?.playoffRule==='top_seeds' && dividedTeams.length===orig.length && divisionMatches===orig.length
    const displayed=await screen('/api/redraft/standings?seasonId='+season.id,cookie)
    const displayedByName=new Map(displayed.rosters.map(r=>[r.teamName,r]))
    const displayRanks=replay.rows.map(t=>({row:displayedByName.get(replay.names.get(t.teamId)),source:t}))
    const screenRecords=displayRanks.filter(({row,source:t})=>row && row.currentRank===t.rank &&
      [row.wins,row.losses,row.ties].join('-')===t.points && (t.totalPointsFor==null?row.pointsFor==null:close(row.pointsFor,t.totalPointsFor))).length
    let screenGames=0,uniqueGames=0
    for(const p of source.periods.filter(p=>p.ended)){
      const board=await screen('/api/redraft/matchup?seasonId='+season.id+'&week='+p.period,cookie)
      const fixtures=new Map((board.matchups||[]).map(g=>[[g.homeRoster.teamName,g.awayRoster.teamName].sort().join('|'),g]))
      uniqueGames+=new Set((board.matchups||[]).map(g=>g.id)).size
      for(const m of p.matchups){
        if(!m.home?.teamId || !m.away?.teamId || !(m.home.gamesPlayed>0||m.away.gamesPlayed>0))continue
        const home=replay.names.get(m.home.teamId),away=replay.names.get(m.away.teamId)
        const g=fixtures.get([home,away].sort().join('|'))
        if(g?.status==='final' && close(g.homeRoster.teamName===home?g.homeScore:g.awayScore,m.home.score) &&
          close(g.awayRoster.teamName===away?g.awayScore:g.homeScore,m.away.score))screenGames++
      }
    }
    const closed=source.periods.filter(p=>p.ended).length
    const settingsPass=league.playoffTeams===expected.numPlayoffTeams && league.playoffStartWeek===expected.firstPlayoffPeriod &&
      league.settings.regular_season_length===expected.lastRegularSeasonPeriod && season.playoffStartWeek===expected.firstPlayoffPeriod &&
      season.totalWeeks===Math.max(...source.info.scoringPeriods.map(p=>p.number)) &&
      season.currentWeek===(source.periods.length?source.periods.at(-1).period:0)
    const evidence={index,sport,leagueId,field:league.playoffTeams,playoffStart:league.playoffStartWeek,currentPeriod:season.currentWeek,closed,
      backfill,teams:teams.length,sourceTeams:orig.length,matchedRecords,matchedRank,availablePF,matchedPF,matchedRebuiltRecords,
      sourcePlayers,matchedRosters,matchedActiveGroups,suppliedRoster,screenRecords,screenGames,uniqueGames,
      games,matchedScores,storedFacts:facts.length,matchedContributions,settingsPass,policyPass,divisionPass,divisionMatches,
      rules:policy && {reseed:policy.reseed,divisionWinners:policy.divisionWinners,keeperType:policy.keeperType,
        standingsTies:policy.standingsTies,matchupTies:policy.matchupTies,playoffTies:policy.playoffTies},
      scoringRules:payload.settings.scoringRules.length,scoringGaps:payload.settings.raw.scoringGaps||[],
      sourceManagerFields:Object.keys(Object.values(source.info.teamInfo)[0]).filter(k=>/owner|manager|user/i.test(k)),
      champion:resolveFantraxChampionTeamId(payload),warnings:result.incompleteSteps?.map(w=>w.code)||[]}
    evidence.pass=backfill==='complete' && settingsPass && policyPass && divisionPass && teams.length===orig.length && matchedRecords===orig.length && matchedRank===orig.length &&
      matchedRosters===orig.length && matchedActiveGroups===orig.length && matchedPF===availablePF &&
      games===matchedScores && games===screenGames && games===uniqueGames && screenRecords===orig.length &&
      facts.length===games && evidence.champion===null
    console.log('FANTRAX_PARITY '+JSON.stringify(evidence))
    return evidence.pass
  } finally {
    global.fetch=publicFetch
    // Detach the temporary source so scheduled refreshes cannot query a QA fixture on Fantrax.
    if(snapshotId)await prisma.fantraxLeague.updateMany({where:{id:snapshotId,appUserId:userId,sourceLeagueId:key},data:{sourceLeagueId:null}})
  }
}
async function main(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='redraft-qa')throw Error('Use the redraft-qa staging worker')
  const cases=(process.env.QA_FANTRAX_CASES||'').split(',').map(x=>x.split('='))
  if(!cases.length || cases.some(([sport,id])=>!sports.includes(sport)||!/^\w{16}$/.test(id)))throw Error('Expected SPORT=leagueId cases')
  const runId=randomUUID().slice(0,8)
  const password=randomUUID()+randomUUID()
  const username='qa-parity-'+runId
  const passwordHash=await require('bcryptjs').hash(password,10)
  const user=await prisma.appUser.create({data:{username,passwordHash,emailVerified:new Date()},select:{id:true}})
  const cookie=await signIn(username,password)
  let passed=true
  for(const [i,[sport,id]] of cases.entries()){
    try {if(!await runCase(user.id,sport,id,i,runId,cookie))passed=false}
    catch(e){console.error('FANTRAX_PARITY_ERROR '+JSON.stringify({index:i,message:String(e.message).slice(0,900)}));passed=false}
  }
  if(!passed)process.exitCode=1
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect())
