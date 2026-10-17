import { z } from 'zod'
import type { SeasonRules } from './seasonRules'
const id = z.string().min(1).max(200)
export const seasonStatBatchSchema = z.object({
  requestId: id, expectedRevision: z.number().int().min(0).max(249), period: z.number().int().min(1).max(30),
  provider: z.enum(['rolling_insights','sleeper']), format: z.enum(['nba_ri_box_v1','nfl_canonical_game_v1','canonical_game_v1']),
  observedAt: z.string().datetime({ offset: true }), coverage: z.enum(['missing','provisional','complete']),
  games: z.array(z.object({ providerGameId: id, actualStartsAt: z.string().datetime({ offset: true }), startVerified: z.literal(true), seasonType: z.literal('regular'), status: z.enum(['provisional','final']),
    rows: z.array(z.object({ providerPlayerId: id, revision: z.number().int().positive(), stats: z.record(z.string(),z.unknown()) }).strict()).max(1000),
  }).strict()).max(250),
}).strict()
export type SeasonStatBatch = z.infer<typeof seasonStatBatchSchema>
function decimal(value: number) {
  const [coefficient, exponent = '0'] = value.toString().toLowerCase().split('e')
  const scale = (coefficient!.split('.')[1]?.length ?? 0) - Number(exponent)
  const digits = BigInt(coefficient!.replace('.', ''))
  return scale < 0 ? { n: digits * 10n ** BigInt(-scale), scale: 0 } : { n: digits, scale }
}
/** Exact decimal products, one final four-place rounding (halves away from zero). No absent stat becomes zero. */
export function scoreSeasonCanonicalStats(rules: SeasonRules, stats: Record<string, unknown>) {
  if (new Set(rules.weights.map(w=>w.statKey)).size !== rules.weights.length) throw new Error('Frozen scoring weights must be distinct.')
  const products = rules.weights.filter(w=>w.points!==0).map(weight=>{
    const value=stats[weight.statKey]
    if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000000||!Number.isFinite(weight.points)||Math.abs(weight.points)>100) throw new Error('Missing or invalid weighted stat: '+weight.statKey)
    const a=decimal(value),b=decimal(weight.points)
    return {n:a.n*b.n,scale:a.scale+b.scale}
  })
  const scale=Math.max(4,...products.map(p=>p.scale))
  const total=products.reduce((sum,p)=>sum+p.n*10n**BigInt(scale-p.scale),0n)
  const divisor=10n**BigInt(scale-4), absolute=total<0n?-total:total
  const rounded=(absolute+divisor/2n)/divisor*(total<0n?-1n:1n)
  const points=Number(rounded)/10000
  if(!Number.isSafeInteger(Number(rounded))||Math.abs(points)>1000000) throw new Error('Fantasy points exceed the supported range.')
  return points===0?0:points
}
// Measured RI NBA player_box fields: contracts/rolling-insights/fixtures/live.NBA.json.
const nbaFields: Record<string,string> = { points:'points', rebounds:'total_rebounds', assists:'assists', steals:'steals', blocks:'blocks', turnovers:'turnovers', three_pointers_made:'three_points_made', field_goals_made:'field_goals_made',field_goals_attempted:'field_goals_attempted',free_throws_made:'free_throws_made',free_throws_attempted:'free_throws_attempted',three_point_attempted:'three_points_attempted',two_point_made:'two_points_made',two_point_attempted:'two_points_attempted',offensive_rebound:'offensive_rebounds',defensive_rebound:'defensive_rebounds',personal_foul:'fouls' }
const nbaDerived = new Set(['double_double','triple_double','forty_plus_points_bonus','fifty_plus_points_bonus'])
const nbaNeedsOtherFeed = new Set(['technical_foul','flagrant_foul'])
/** Report the frozen NBA weights the measured RI box can prove. Never treat absent foul events as zero. */
export function assessSeasonRiNbaCoverage(rules: SeasonRules) {
  if (rules.sport !== 'NBA') throw new Error('An NBA frozen scoring contract is required.')
  const active = rules.weights.filter(w => w.points !== 0).map(w => w.statKey)
  return {
    measured: active.filter(key => Object.hasOwn(nbaFields, key)),
    derived: active.filter(key => nbaDerived.has(key)),
    needsOtherFeed: active.filter(key => nbaNeedsOtherFeed.has(key)),
    unsupported: active.filter(key => !Object.hasOwn(nbaFields, key) && !nbaDerived.has(key) && !nbaNeedsOtherFeed.has(key)),
  }
}
export function mapSeasonRiNbaStats(rules: SeasonRules, raw: Record<string, unknown>) {
  if(rules.sport!=='NBA') throw new Error('An NBA frozen scoring contract is required.')
  const coverage=assessSeasonRiNbaCoverage(rules)
  if(coverage.needsOtherFeed.length||coverage.unsupported.length) throw new Error('NBA box lacks weighted evidence for: '+[...coverage.needsOtherFeed,...coverage.unsupported].join(', '))
  const stats: Record<string,number>={}
  const required=(key:string)=>{
    const value=raw[key]
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isInteger(value)||value>1000000) throw new Error('Missing or invalid NBA box field: '+key)
    return value
  }
  for(const weight of rules.weights.filter(w=>w.points!==0)) {
    if(weight.statKey==='forty_plus_points_bonus'||weight.statKey==='fifty_plus_points_bonus') {
      stats[weight.statKey]=required('points') >= (weight.statKey==='forty_plus_points_bonus'?40:50) ? 1 : 0
    } else if(weight.statKey==='double_double'||weight.statKey==='triple_double') {
      const doubles=['points','total_rebounds','assists','steals','blocks'].filter(key=>required(key)>=10).length
      stats[weight.statKey]=doubles>=(weight.statKey==='double_double'?2:3)?1:0
    } else {
      const key=nbaFields[weight.statKey]
      if(!key) throw new Error('Unsupported weighted NBA stat: '+weight.statKey)
      stats[weight.statKey]=required(key)
    }
  }
  return stats
}
