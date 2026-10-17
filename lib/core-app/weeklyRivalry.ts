import type { Pairing } from './weekBoard'
export type WeeklyRivalryPlan = { leagueId: string; season: number; period: number; opponentRosterId: string; opponent: string; wins: number; losses: number; ties: number; winningStreak: number; losingStreak: number }
/** Provider-qualified pairing and roster ownership are established by the history reader. */
export function weeklyRivalryPlans(pairs: Pairing[], mine: ReadonlyMap<string,string>, names: ReadonlyMap<string,string>, leagues: ReadonlyMap<string,{id:string}>, periods: ReadonlyMap<string,{season:number;week:number}>): WeeklyRivalryPlan[] {
  const results = new Map<string, Array<{season:number;week:number;result:number}>>()
  const fixtures: Array<{scope:string;season:number;period:number;you:string;them:string}> = []
  for (const p of pairs) {
    const aMine=mine.has(p.leagueId+':'+p.a.rosterId), bMine=mine.has(p.leagueId+':'+p.b.rosterId)
    if (aMine === bMine) continue
    const you=aMine?p.a:p.b, them=aMine?p.b:p.a, current=periods.get(p.leagueId)
    if (current && p.season===current.season && p.week>=current.week) fixtures.push({scope:p.leagueId,season:p.season,period:p.week,you:you.rosterId,them:them.rosterId})
    const scored=(r:typeof you)=>r.scored===true || r.pointsFor>0 || r.pointsAgainst>0
    if (you.finalized===false || them.finalized===false || (!scored(you)&&!scored(them)) || !Number.isFinite(you.pointsFor) || !Number.isFinite(them.pointsFor)) continue
    const key=JSON.stringify([p.leagueId,you.rosterId,them.rosterId]); const list=results.get(key)??[]
    list.push({season:p.season,week:p.week,result:Math.sign(you.pointsFor-them.pointsFor)}); results.set(key,list)
  }
  const out:WeeklyRivalryPlan[]=[]
  for (const f of fixtures) {
    const league=leagues.get(f.scope), opponent=names.get(f.scope+':'+f.them)
    if (!league || !opponent) continue
    const games=(results.get(JSON.stringify([f.scope,f.you,f.them]))??[]).filter(g=>g.season<f.season || g.season===f.season&&g.week<f.period).sort((a,b)=>b.season-a.season||b.week-a.week)
    if (!games.length) continue
    const streak=(r:number)=>{let n=0;for(const g of games){if(g.result!==r)break;n++}return n}
    out.push({leagueId:league.id,season:f.season,period:f.period,opponentRosterId:f.them,opponent,wins:games.filter(g=>g.result>0).length,losses:games.filter(g=>g.result<0).length,ties:games.filter(g=>g.result===0).length,winningStreak:streak(1),losingStreak:streak(-1)})
  }
  return out
}
