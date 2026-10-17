import { z } from 'zod'

const Points = z.record(z.string(),z.number().finite())
const Departure = z.object({season:z.string(),week:z.number().int(),via:z.enum(['dropped','traded'])}).nullable()
const Asset = z.object({name:z.string(),creditedBySeason:Points,departed:Departure})
const Pick = z.object({label:z.string(),pending:z.boolean(),rerouted:z.boolean(),resolved:Asset.nullable()})
const Side = z.object({ownerId:z.string().nullable(),playersIn:z.array(Asset),playersOut:z.array(Asset),picksIn:z.array(Pick),picksOut:z.array(Pick),seasonNets:z.array(z.object({season:z.string(),net:z.number().finite(),partial:z.boolean()})),faabIn:z.number().finite().optional(),faabOut:z.number().finite().optional()})
const Payload = z.object({version:z.literal(2),sleeperLeagueId:z.string(),fetchedAt:z.string().datetime(),staleAsOf:z.string().nullable(),missing:z.array(z.string()),contextNotes:z.array(z.string()),trades:z.array(z.object({id:z.string(),multiTeam:z.boolean(),sides:z.array(Side)}))})
export type RealizedReceipt = {asOf:string;stale:boolean;ongoing:boolean;receivedPoints:number|null;sentPoints:number|null;assets:Array<{direction:'received'|'sent';name:string;points:number|null;seasons:Record<string,number>;status:string}>;notes:string[]}

/** Exact league, transaction, and owner match. Never rebuild a provider ledger in a request. */
export function realizedReceipt(data:unknown,args:{leagueId:string;transactionId:string;ownerId:string;expiresAt:Date|null;now:Date}):RealizedReceipt|null {
  const parsed=Payload.safeParse(data)
  if (!parsed.success) return null
  const payload=parsed.data
  if (payload.sleeperLeagueId!==args.leagueId) return null
  const key=`${args.leagueId}:${args.transactionId}`
  const trade=payload.trades.find(t=>t.id===key)
  if (!trade || trade.multiTeam || trade.sides.length!==2) return null
  const matches=trade.sides.filter(s=>s.ownerId===args.ownerId)
  if (matches.length!==1) return null
  const side=matches[0]
  const sum=(points:Record<string,number>)=>Object.keys(points).length?Object.values(points).reduce((a,b)=>a+b,0):null
  const assets:RealizedReceipt['assets']=[]
  for (const direction of ['received','sent'] as const) {
    for (const a of direction==='received'?side.playersIn:side.playersOut) assets.push({direction,name:a.name,points:sum(a.creditedBySeason),seasons:a.creditedBySeason,status:a.departed?`${a.departed.via} in ${a.departed.season}, week ${a.departed.week}`:'No recorded departure in the scanned tenure'})
    for (const p of direction==='received'?side.picksIn:side.picksOut) assets.push({direction,name:p.resolved?`${p.label} → ${p.resolved.name}`:p.label,points:p.resolved&&!p.pending&&!p.rerouted?sum(p.resolved.creditedBySeason):null,seasons:!p.pending&&!p.rerouted?p.resolved?.creditedBySeason??{}:{},status:p.rerouted?'Flipped before the draft; later outcome is not attributed to this trade':p.pending?'Draft outcome pending':p.resolved?.departed?`${p.resolved.departed.via} in ${p.resolved.departed.season}, week ${p.resolved.departed.week}`:p.resolved?'Drafted player credited during recorded first stint':'Draft outcome unavailable'})
  }
  const stale=Boolean(payload.staleAsOf)||!args.expiresAt||args.expiresAt.getTime()<args.now.getTime()||args.now.getTime()-Date.parse(payload.fetchedAt)>6*60*60*1000
  const total=(direction:'received'|'sent')=>{
    const list=assets.filter(a=>a.direction===direction)
    if (payload.missing.length||!list.length||list.some(a=>a.points==null)) return null
    return Math.round(list.reduce((a,b)=>a+b.points!,0)*10)/10
  }
  return {asOf:payload.fetchedAt,stale,ongoing:side.seasonNets.some(s=>s.partial),receivedPoints:total('received'),sentPoints:total('sent'),assets,notes:[
    ...payload.contextNotes,...payload.missing.map(g=>`Ledger gap: ${g}. Aggregate totals withheld.`),
    'These are league-scored points produced while assets were held in their recorded first stint, including bench production. They are not points started, wins caused, or a counterfactual result for your team.',
    'Sent-asset points belong to the receiving teams’ recorded tenure. Full re-trade proceeds are not followed; rerouted picks are disclosed.',
    ...(side.faabIn||side.faabOut?['FAAB transfers are outside these production totals.']:[]),
  ]}
}
