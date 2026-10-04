import { fillLineup, type ImpactPlayer } from './rosterImpact'

export type PackageCost = {
  capacity: number | null; activeBefore: number; activeAfter: number; requiredDrops: number | null
  displacedStarters: string[]
  candidates: Array<{playerId:string;name:string;singleDropLineupCost:number|null}>
  note: string
}

/** Marginal weekly starter cost, never a drop recommendation or dynasty price discount. */
export function reviewPackageCost(args: {roster:readonly ImpactPlayer[];sent:readonly string[];incoming:readonly ImpactPlayer[];slots:readonly string[];reserveIds:readonly string[];taxiIds:readonly string[];capacity:number|null}):PackageCost {
  const protectedIds = new Set([...args.reserveIds,...args.taxiIds])
  const sent = new Set(args.sent)
  const before = [...new Map(args.roster.filter(p=>!protectedIds.has(p.playerId)).map(p=>[p.playerId,p])).values()]
  const after = [...new Map([...before.filter(p=>!sent.has(p.playerId)),...args.incoming].map(p=>[p.playerId,p])).values()]
  const capacity = args.capacity != null && Number.isInteger(args.capacity) && args.capacity > 0 ? args.capacity : null
  const requiredDrops = capacity == null ? null : Math.max(0,after.length-capacity)
  const b = fillLineup(before,args.slots), a = fillLineup(after,args.slots)
  const known = (players:readonly ImpactPlayer[])=>players.every(p=>p.projectedPoints!=null && Number.isFinite(p.projectedPoints))
  const complete = known(before) && known(after) && !b.unknownSlots.length && !a.unknownSlots.length && !b.unfilledSlots.length && !a.unfilledSlots.length
  return {capacity,activeBefore:before.length,activeAfter:after.length,requiredDrops,
    displacedStarters:complete?b.starterIds.filter(id=>!sent.has(id)&&!a.starterIds.includes(id)):[],
    candidates:requiredDrops ? after.filter(p=>!args.incoming.some(i=>i.playerId===p.playerId)).map(p=>{
      const without = fillLineup(after.filter(other=>other.playerId!==p.playerId),args.slots)
      return {playerId:p.playerId,name:p.playerId,singleDropLineupCost:complete && !without.unfilledSlots.length && !without.unknownSlots.length ? Math.max(0,a.points-without.points) : null}
    }).sort((x,y)=>(x.singleDropLineupCost??Infinity)-(y.singleDropLineupCost??Infinity)||x.playerId.localeCompare(y.playerId)):[],
    note:'Incoming players are assumed to use active roster slots. IR and taxi occupants are excluded; eligibility for moving new players there is not verified. Each drop scenario removes one retained player independently. Costs cannot be added for multiple drops; zero weekly starter cost does not mean a player has no future or depth value. League position limits and execution rules still need review.',
  }
}
