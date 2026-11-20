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
// A scoreboard can include extra exhibitions and repeat the same scheduled result. Keep their
// counts visible and compare official schedule games once. Conflicting duplicates fail the audit.
function scheduledResults(source) {
  const periods=[], pair=(a,b)=>[a,b].sort().join('|')
  let unscheduled=0, repeated=0, conflicting=0
  for(const p of source.periods.filter(p=>p.ended)) {
    const scheduled=new Set(source.info.matchups.find(w=>w.period===p.period)?.matchupList
      .filter(m=>m.away?.id && m.home?.id).map(m=>pair(m.away.id,m.home.id)))
    const games=new Map()
    for(const m of p.matchups){
      if(!m.away?.teamId || !m.home?.teamId || !(m.away.gamesPlayed>0 || m.home.gamesPlayed>0))continue
      const key=pair(m.away.teamId,m.home.teamId)
      if(!scheduled.has(key)){unscheduled++;continue}
      const first=games.get(key)
      if(!first){games.set(key,m);continue}
      repeated++
      const straight=first.away.teamId===m.away.teamId
      if(!close(first.away.score,straight?m.away.score:m.home.score) || !close(first.home.score,straight?m.home.score:m.away.score))conflicting++
    }
    periods.push({...p,matchups:[...games.values()]})
  }
  return {periods,unscheduled,repeated,conflicting}
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
// Play future rounds in memory on the staged runtime. The real season and its champion stay untouched.
async function exerciseBracket(seasonId, expected, divisionTop, reseed) {
  const { resolveNflRedraftPlayoffRuntime } = require('../lib/playoff-runtime/resolveNflRedraftPlayoffRuntime.ts')
  const { generateNflRedraftPlayoffBracket, advanceNflRedraftPlayoffRound, finalizeNflRedraftPlayoffChampion } = require('../lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime.ts')
  const loaded = await resolveNflRedraftPlayoffRuntime({seasonId, week:expected.firstPlayoffPeriod})
  if (!loaded.ok) return {pass:false,reason:loaded.reason}
  let state = loaded.state
  const s=state.settings, rounds=Math.ceil(Math.log2(expected.numPlayoffTeams)), byes=2**rounds-expected.numPlayoffTeams
  state={...state,bracket:generateNflRedraftPlayoffBracket({state,lockBracket:true}).bracket}
  const first=state.bracket.rounds[0]
  const qualification=s.playoffTeamCount===expected.numPlayoffTeams && s.playoffStartWeek===expected.firstPlayoffPeriod &&
    s.regularSeasonEndWeek===expected.lastRegularSeasonPeriod && s.roundCount===rounds && s.firstRoundByes===byes &&
    first?.matchups.filter(m=>m.bye).length===byes && s.reseedAfterEachRound===reseed && s.divisionWinnersTopSeeds===divisionTop
  for(let step=0;step<12;step++){
    for(const round of [...state.bracket.rounds,...state.bracket.consolationRounds]){
      for(const game of round.matchups){
        if(game.bye || game.complete || !game.homeRosterId || !game.awayRosterId)continue
        game.homeScore=round.roundNumber%2?70:91;game.awayScore=80
      }
    }
    const third=state.bracket.thirdPlaceMatchup
    if(third?.homeRosterId && third.awayRosterId){third.homeScore=62;third.awayScore=65}
    const advance=advanceNflRedraftPlayoffRound({state})
    if(!advance.ok) return {pass:false,qualification,reason:advance.code}
    state=advance.state
    const final=finalizeNflRedraftPlayoffChampion({state})
    if(final.ok)return {pass:qualification && !!final.championRosterId,qualification,simulatedChampion:true,rounds,byes,
      field:s.playoffTeamCount,start:s.playoffStartWeek,regular:s.regularSeasonEndWeek,reseed:s.reseedAfterEachRound,divisionTop:s.divisionWinnersTopSeeds}
  }
  return {pass:false,qualification,reason:'round limit'}
}
async function tryNativeConversion(leagueId,teamCount,cookie,provider,replay,policy='after_open_period') {
  const {createStateFromImportedLeague}=require('../lib/create-league-v2/import-template.ts')
  const {submitCreateLeagueV2}=require('../lib/create-league-v2/submit.ts')
  const source=await prisma.league.findUniqueOrThrow({where:{id:leagueId},select:{
    name:true,sport:true,leagueType:true,leagueVariant:true,scoringPresetId:true,leagueSettings:{select:{draftType:true}},
  }})
  const state=createStateFromImportedLeague({...source,leagueSize:teamCount,draftType:source.leagueSettings?.draftType})
  const selection={sourceType:source.leagueType,selectedType:state.leagueType,idp:state.idpSelected,teamCount:state.teamCount}
  if(state.teamCount!==teamCount)return {...selection,created:false,reason:'Wizard cannot preserve the source team count'}
  const restore=global.fetch
  try {
    global.fetch=async(path,options)=>{
      if(path!=='/api/leagues')throw Error('Unexpected wizard endpoint')
      return publicFetch(stagingOrigin+path,{...options,redirect:'error',headers:{...options.headers,cookie},signal:AbortSignal.timeout(240000)})
    }
    // Keep the source lineup frequency. The audit cannot consent to a commissioner rule change.
    const active=provider.info.scoringPeriods.find(p=>Date.parse(p.startDate)<=Date.now() && Date.now()<=Date.parse(p.endDate))
    const choice=active ? { policy, period:active.number } : undefined
    const result=await submitCreateLeagueV2(state,leagueId,false,false,choice)
    if(!result.ok || !result.leagueId)return {...selection,created:false,reason:result.error || 'Missing league ID'}
    const native=await prisma.league.findUniqueOrThrow({where:{id:result.leagueId},select:{leagueSize:true,leagueType:true,playoffTeams:true,playoffStartWeek:true,settings:true}})
    const finalizeResponse=await publicFetch(stagingOrigin+'/api/leagues/'+encodeURIComponent(result.leagueId)+'/import-carryover/finalize',{
      method:'POST',redirect:'error',headers:{cookie},signal:AbortSignal.timeout(200000)})
    const final=await finalizeResponse.json()
    const season=await prisma.redraftSeason.findFirst({where:{leagueId:result.leagueId},orderBy:{createdAt:'desc'},select:{id:true,season:true,currentWeek:true}})
    let matchedNativeRecords=0,matchedNativeRanks=0,liveFinalGames=0,matchedNativeScores=0
    if(season){
      const board=await screen('/api/redraft/standings?seasonId='+season.id,cookie)
      const byName=new Map(board.rosters.map(t=>[t.teamName,t]))
      matchedNativeRecords=replay.rows.filter(t=>{const row=byName.get(replay.names.get(t.teamId));return row && [row.wins,row.losses,row.ties].join('-')===t.points}).length
      matchedNativeRanks=replay.rows.filter(t=>byName.get(replay.names.get(t.teamId))?.playoffSeed===t.rank).length
      const dated=scheduledResults(provider).periods
      for(const p of dated){
        const board=await screen('/api/redraft/matchup?seasonId='+season.id+'&week='+p.period,cookie)
        for(const m of p.matchups){
          const home=replay.names.get(m.home.teamId),away=replay.names.get(m.away.teamId)
          const paired=board.matchups.filter(f=>f.homeRoster?.teamName===home && f.awayRoster?.teamName===away || f.homeRoster?.teamName===away && f.awayRoster?.teamName===home)
          if(paired.length===1 && paired[0].status==='final'){
            const x=paired[0],same=x.homeRoster.teamName===home
            if(close(x.homeScore,same?m.home.score:m.away.score)&&close(x.awayScore,same?m.away.score:m.home.score))matchedNativeScores++
          }
        }
      }
      liveFinalGames=await prisma.redraftMatchup.count({where:{seasonId:season.id,status:{in:['final','completed']}}})
    }
    let categoryChecks=null
    if(provider.info.scoringSystem?.type==='HEAD_TO_HEAD_ROTI_SINGLE_WIN'){
      const {nativeCategoryScoringContext}=require('../lib/category-scoring/nativeCategoryScoringContext.ts')
      const {fantraxNbaCategoryOutcome}=require('../lib/category-scoring/fantraxNbaCategories.ts')
      const context=nativeCategoryScoringContext(native.settings,'NBA'), ids=context?.categories.map(c=>c.id)||[]
      const configs=provider.info.scoringSystem.scoringCategorySettings.flatMap(g=>g.configs)
      const bySource=new Map(configs.map((c,i)=>[c.scoringCategory.name,ids[i]]))
      let games=0,matched=0,tiebreakWins=0
      for(const p of scheduledResults(provider).periods)for(const m of p.matchups){games++
        const categories=m.categories.map(c=>({categoryId:bySource.get(c.name),winner:c.home.outcome==='WIN'?'a':c.away.outcome==='WIN'?'b':'tie'}))
        const result={categories,aWins:categories.filter(c=>c.winner==='a').length,bWins:categories.filter(c=>c.winner==='b').length,ties:categories.filter(c=>c.winner==='tie').length}
        const scored=fantraxNbaCategoryOutcome(result,native.settings?.fantrax_category_scoring,true)
        if(ids.length===configs.length && scored.homeScore===m.home.score && scored.awayScore===m.away.score)matched++
        if(scored.tiebreak)tiebreakWins++
      }
      categoryChecks={categories:ids.length,games,matched,tiebreakWins,recordMode:context?.recordMode||null}
    }
    return {...selection,created:true,nativeType:native.leagueType,franchises:native.leagueSize,field:native.playoffTeams,
      start:native.playoffStartWeek,rosterCopies:native.settings?.importCarryover?.playerCount,finalizeStatus:finalizeResponse.status,
      complete:final.complete===true,materializedPlayers:final.materializedPlayers,finalizeError:final.error,season:season?.season,currentWeek:season?.currentWeek,
      policy,cutover:final.cutover,matchedNativeRecords,matchedNativeRanks,matchedNativeScores,liveFinalGames,archivedGames:native.settings?.importCarryover?.history?.matchups,categoryChecks}
  }finally{global.fetch=restore}
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
    const decidedRecords=new Map(orig.map(id=>[id,[0,0,0]]))
    let sourceTiebreaks=0, matchedTiebreaks=0
    const scheduled=scheduledResults(source)
    for(const p of scheduled.periods) for(const m of p.matchups) {
      if(!m.away?.teamId || !m.home?.teamId || !(m.away.gamesPlayed>0 || m.home.gamesPlayed>0))continue
      games++
      const a=external(m.away.teamId),b=external(m.home.teamId)
      const f=stored.get([p.period,...[a,b].sort()].join('|'))
      if(f && close(f.teamA===a?f.scoreA:f.scoreB,m.away.score) && close(f.teamB===b?f.scoreB:f.scoreA,m.home.score))matchedScores++
      let winner
      if(m.away.score===m.home.score){
        for(const rule of league.settings.fantrax_settings?.publicRules?.matchupTies||[]){
          const categoryName=/^Ahead in specific scoring category\s*-\s*(.+)$/i.exec(rule)?.[1]
          const c=m.categories?.find(c=>c.name===categoryName)
          if(!c || !c.home?.outcome)break
          if(c.home.outcome==='TIE' && c.away?.outcome==='TIE')continue
          winner=c.home.outcome==='WIN'?m.home.teamId:c.away?.outcome==='WIN'?m.away.teamId:null
          break
        }
        if(winner){sourceTiebreaks++;if(f?.winnerTeamId===external(winner))matchedTiebreaks++}
      }
      for(const [side,other] of [['away','home'],['home','away']]) {
        const team=m[side]
        const record=records.get(team.teamId)
        record[team.score>m[other].score?0:team.score<m[other].score?1:2]++
        const withTiebreak=decidedRecords.get(team.teamId)
        withTiebreak[winner ? (winner===team.teamId?0:1) : team.score>m[other].score?0:team.score<m[other].score?1:2]++
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
    const divisionMatches=dividedTeams.filter(id=>groupNames.get(replay.names.get(id))===source.info.teamInfo[id].division.trim()).length
    const divisionPass=!divisionTop || divisions?.playoffRule==='top_seeds' && dividedTeams.length===orig.length && divisionMatches===orig.length
    const simulatedBracket=await exerciseBracket(season.id,expected,divisionTop,reseed==='yes')
    const displayed=await screen('/api/redraft/standings?seasonId='+season.id,cookie)
    const displayedByName=new Map(displayed.rosters.map(r=>[r.teamName,r]))
    const displayRanks=replay.rows.map(t=>({row:displayedByName.get(replay.names.get(t.teamId)),source:t}))
    const screenRecords=displayRanks.filter(({row,source:t})=>row && row.currentRank===t.rank &&
      [row.wins,row.losses,row.ties].join('-')===t.points && (t.totalPointsFor==null?row.pointsFor==null:close(row.pointsFor,t.totalPointsFor))).length
    let screenGames=0,uniqueGames=0
    for(const p of scheduled.periods){
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
      unscheduledScores:scheduled.unscheduled,repeatedScores:scheduled.repeated,conflictingScores:scheduled.conflicting,
      backfill,teams:teams.length,sourceTeams:orig.length,matchedRecords,matchedRank,availablePF,matchedPF,matchedRebuiltRecords,
      sourcePlayers,matchedRosters,matchedActiveGroups,suppliedRoster,screenRecords,screenGames,uniqueGames,
      games,matchedScores,storedFacts:facts.length,matchedContributions,settingsPass,policyPass,divisionPass,divisionMatches,simulatedBracket,
      sourceTiebreaks,matchedTiebreaks,matchedDecidedRecords:replay.rows.filter(t=>decidedRecords.get(t.teamId)?.join('-')===t.points).length,
      rules:policy && {reseed:policy.reseed,divisionWinners:policy.divisionWinners,keeperType:policy.keeperType,
        standingsTies:policy.standingsTies,matchupTies:policy.matchupTies,playoffTies:policy.playoffTies},
      scoringRules:payload.settings.scoringRules.length,scoringGaps:payload.settings.raw.scoringGaps||[],
      sourceManagerFields:Object.keys(Object.values(source.info.teamInfo)[0]).filter(k=>/owner|manager|user/i.test(k)),
      champion:resolveFantraxChampionTeamId(payload),warnings:result.incompleteSteps?.map(w=>w.code)||[]}
    evidence.pass=backfill==='complete' && settingsPass && policyPass && divisionPass && simulatedBracket.pass && teams.length===orig.length && matchedRecords===orig.length && matchedRank===orig.length &&
      matchedRosters===orig.length && matchedActiveGroups===orig.length && matchedPF===availablePF &&
      games===matchedScores && games===screenGames && games===uniqueGames && screenRecords===orig.length &&
      facts.length===games && scheduled.conflicting===0 && matchedTiebreaks===sourceTiebreaks && evidence.champion===null
    try {evidence.native=await tryNativeConversion(leagueId,orig.length,cookie,source,replay)}
    catch(error){evidence.native={created:false,reason:String(error.message).slice(0,260)}}
    if(source.info.scoringSystem?.type==='HEAD_TO_HEAD_ROTI_SINGLE_WIN'){
      evidence.immediate=await tryNativeConversion(leagueId,orig.length,cookie,source,replay,'reconcile_open_period')
      evidence.pass=evidence.pass && [evidence.native,evidence.immediate].every(n=>n.complete && n.cutover?.policy===n.policy && n.currentWeek===season.currentWeek &&
        n.matchedNativeRecords===orig.length && n.matchedNativeRanks===orig.length && n.matchedNativeScores===games && n.liveFinalGames===games)
    }
    if(!evidence.native.created && sourcePlayers){
      const ids=[...new Set(Object.values(source.rosters).flatMap(t=>t.rosterItems.map(p=>p.id)))]
      const nativeKey=sport==='NFL'?'sleeperId':'rollingInsightsId'
      const links=await prisma.playerIdentityMap.findMany({where:{sport,fantraxId:{in:ids}},select:{fantraxId:true,sleeperId:true,rollingInsightsId:true,canonicalName:true,position:true}})
      const known=new Set(links.map(p=>p.fantraxId)), verified=new Set(links.filter(p=>p[nativeKey]&&p.position&&p.canonicalName).map(p=>p.fantraxId))
      evidence.native.identityCoverage={distinct:ids.length,verified:verified.size,missingProviderLink:ids.filter(id=>!known.has(id)).length,missingNativeDetails:known.size-verified.size}
      if(sport==='NFL'){
        const {getPlayersBySport}=require('../lib/sleeper-client.ts'),{matchSharedFantraxPlayers}=require('../lib/player-identity/fantraxSharedPlayerIds.ts')
        const {getCachedFantraxPlayerIds}=require('../lib/league-import/fantrax/fantraxPlayerDirectoryCache.ts')
        const fan=await getCachedFantraxPlayerIds('NFL'), players=await getPlayersBySport('nfl')
        if(fan.ok){
          const direct=matchSharedFantraxPlayers(ids.filter(id=>!verified.has(id)).map(i=>fan.data[i]).filter(Boolean),Object.values(players))
          const targets=await prisma.playerIdentityMap.findMany({where:{sport,sleeperId:{in:direct.map(p=>p.player.player_id)}},select:{sleeperId:true,fantraxId:true}})
          evidence.native.sharedIds={unresolvedWithTwoIds:direct.length,matchingNativeIdentity:targets.length,nativeTargetHasProviderLink:targets.filter(t=>!!t.fantraxId).length}
        }
      }
    }
    console.log('FANTRAX_PARITY '+JSON.stringify(evidence))
    return evidence.pass
  } finally {
    global.fetch=publicFetch
    // Detach the temporary source so scheduled refreshes cannot query a QA fixture on Fantrax.
    if(snapshotId)await prisma.fantraxLeague.updateMany({where:{id:snapshotId,appUserId:userId,sourceLeagueId:key},data:{sourceLeagueId:null}})
  }
}
async function waitForWebCommit(){
  const expected=process.env.QA_STAGING_WEB_COMMIT
  if(!expected)return
  if(!/^[a-f0-9]{40}$/.test(expected))throw Error('Invalid expected staging revision')
  const until=Date.now()+30*60*1000
  while(Date.now()<until){
    try{const res=await publicFetch(stagingOrigin+'/api/af-debug/sha',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)})
      if(res.ok && (await res.json()).sha===expected)return
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,15000))
  }
  throw Error('Staging web did not reach the requested revision')
}
async function main(){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='redraft-qa')throw Error('Use the redraft-qa staging worker')
  const cases=(process.env.QA_FANTRAX_CASES||'').split(',').map(x=>x.split('='))
  if(!cases.length || cases.some(([sport,id])=>!sports.includes(sport)||!/^\w{16}$/.test(id)))throw Error('Expected SPORT=leagueId cases')
  await waitForWebCommit()
  const runId=randomUUID().slice(0,8)
  const password=randomUUID()+randomUUID()
  const username='qa-parity-'+runId
  const passwordHash=await require('bcryptjs').hash(password,10)
  const user=await prisma.appUser.create({data:{username,passwordHash,emailVerified:new Date()},select:{id:true}})
  const cookie=await signIn(username,password)
  const pro=require('../lib/player-identity/ingestProFantraxIdentities.ts')
  const college=require('../lib/player-identity/ingestNcaabFantraxIdentities.ts')
  const refresh={NBA:pro.ingestNbaFantraxIdentities,NHL:pro.ingestNhlFantraxIdentities,NCAAB:college.ingestNcaabFantraxIdentities}
  for(const sport of new Set(cases.map(([sport])=>sport))){
    const registry=require('../lib/sports-data/multiSportIdentityMap.ts')
    const feedPlayers=await prisma.sportsPlayer.count({where:{sport,source:'rolling_insights'}})
    const registryRun=feedPlayers ? await registry.backfillIdentityMapForSport(sport,{limit:feedPlayers}):null
    if(sport==='NBA' && feedPlayers){
      const {refreshSleeperPlayerRows}=require('../lib/sleeper/refreshSleeperPlayerRows.ts')
      const {reconcileSleeperNbaIdentities}=require('../lib/player-identity/reconcileSleeperNbaIdentities.ts')
      const until=Date.now()+180000
      const isExhausted=()=>Date.now()>=until
      await refreshSleeperPlayerRows({sport,limit:feedPlayers,isExhausted})
      await reconcileSleeperNbaIdentities({limit:feedPlayers,isExhausted})
    }
    if(sport==='NFL' && feedPlayers){
      const {backfillSleeperIds}=require('../lib/player-match/sleeperIdentitySync.ts')
      await backfillSleeperIds({sport,deadlineAt:Date.now()+120000}).catch(()=>null)
    }
    const native=sport==='NFL'?{sleeperId:{not:null}}:{rollingInsightsId:{not:null}}
    const nativeIdentities=await prisma.playerIdentityMap.count({where:{sport,...native}})
    const registryErrors=registryRun?.errors?.length??0
    const link=refresh[sport] && nativeIdentities ? await refresh[sport]().catch(()=>({error:'Identity refresh failed'})):null
    const linked=await prisma.playerIdentityMap.count({where:{sport,...native,fantraxId:{not:null}}})
    console.log('FANTRAX_DIRECTORY '+JSON.stringify({sport,nativeIdentities,feedPlayers,registryErrors,linked,updated:link?.updated||0,refreshError:link?.error||null}))
  }
  let passed=true
  for(const [i,[sport,id]] of cases.entries()){
    try {if(!await runCase(user.id,sport,id,i,runId,cookie))passed=false}
    catch(e){console.error('FANTRAX_PARITY_ERROR '+JSON.stringify({index:i,message:String(e.message).slice(0,900)}));passed=false}
  }
  if(!passed)process.exitCode=1
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect())
