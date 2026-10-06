const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
/** Calendar feeds overlap football seasons. Require the entire regular-season inventory. */
export function historicalNflSchedule(payloads:unknown[],season:number){
 if(!Number.isInteger(season)||season<2018||season>=new Date().getUTCFullYear()||payloads.length!==2)throw new Error('Historical season only')
 const games=new Map<string,{externalId:string;week:number;startTime:Date;homeTeam:string;awayTeam:string;status:string}>()
 for(const payload of payloads){
  const events=obj(payload).events
  if(!Array.isArray(events)||events.length>400)throw new Error('Schedule payload unavailable or oversized')
  for(const raw of events){
   const e=obj(raw),scope=obj(e.season)
   if(scope.year!==season||scope.type!==2)continue
   const week=obj(e.week).number,at=typeof e.date==='string'?Date.parse(e.date):NaN
   if(typeof e.id!=='string'||!/^\d+$/.test(e.id)||typeof week!=='number'||!Number.isInteger(week)||week<1||week>(season>=2021?18:17)||!Number.isFinite(at)||at>Date.now()||!Array.isArray(e.competitions)||e.competitions.length!==1)throw new Error('Invalid historical schedule identity or date')
   const competitors=obj(e.competitions[0]).competitors
   if(!Array.isArray(competitors)||competitors.length!==2)throw new Error('Missing schedule teams')
   const home=competitors.map(obj).find(c=>c.homeAway==='home'),away=competitors.map(obj).find(c=>c.homeAway==='away')
   const homeTeam=obj(home?.team).abbreviation,awayTeam=obj(away?.team).abbreviation
   if(typeof homeTeam!=='string'||typeof awayTeam!=='string'||homeTeam===awayTeam)throw new Error('Invalid schedule teams')
   const game={externalId:e.id,week,startTime:new Date(at),homeTeam,awayTeam,status:obj(obj(e.status).type).completed===true?'final':'unknown'}
   const previous=games.get(e.id)
   if(previous&&(previous.week!==week||previous.startTime.getTime()!==at||previous.homeTeam!==homeTeam||previous.awayTeam!==awayTeam))throw new Error('Conflicting historical schedule')
   games.set(e.id,game)
  }
 }
 const values=[...games.values()],weeks=new Set(values.map(g=>g.week))
 // NFL officially cancelled BUF at CIN in week 17 of 2022; no invented kickoff is stored.
 // https://www.nfl.com/_amp/week-17-buffalo-cincinnati-game-will-not-be-resumed-neutral-afc-championship-gam
 const expected=season===2022?271:season>=2021?272:256
 const teams=new Map<string,number>();for(const g of values)for(const t of [g.homeTeam,g.awayTeam])teams.set(t,(teams.get(t)??0)+1)
 if(teams.size!==32||[...teams].some(([team,count])=>count!==(season===2022&&['BUF','CIN'].includes(team)?16:season>=2021?17:16)))throw new Error('Incomplete team schedule inventory')
 if(season===2022&&!values.some(g=>g.week===17&&g.startTime.getTime()<Date.parse('2023-01-02T00:00:00Z')))throw new Error('Unverified 2022 cancelled-game inventory')
 if(values.length!==expected||weeks.size!==(season>=2021?18:17))throw new Error('Incomplete regular-season schedule')
 return values.sort((a,b)=>a.startTime.getTime()-b.startTime.getTime())
}
