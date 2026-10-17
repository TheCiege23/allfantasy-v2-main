export function verifiedSourceZero(receipts: Array<{data: unknown}>, input: {period:number;playerId:string;rosterId:number|null;points:number}) {
  if(input.points!==0 || input.rosterId==null)return null
  for(const receipt of receipts){
    const data=receipt.data as any
    if(data?.verified!==true || data.period!==input.period || data.rosterId!==input.rosterId || !/^[a-f0-9]{64}$/.test(data.sha256??'') || !Array.isArray(data.zeroEvidence))continue
    const evidence=data.zeroEvidence.filter((e:any)=>e?.playerId===input.playerId)
    if(evidence.length!==1)continue
    const e=evidence[0]
    if((e.kind==='bye' && e.opponent==='Bye') || (e.kind==='zero_exported_stats' && typeof e.opponent==='string' && /\sF(?:\s|$)/.test(e.opponent)))return {...e,sha256:data.sha256,independentCalculation:false}
  }
  return null
}

/** A reviewed game-stat conflict can be explained without rewriting provider facts.
 * Apply only against the exact original value, player and game. Re-score afterward. */
export function reviewedGameStats(raw:unknown, input:{playerId:string;gameId:string}, reviews:unknown) {
  if(!Array.isArray(reviews) || !raw || typeof raw!=='object' || Array.isArray(raw))return null
  const candidates=reviews.filter(r=>r?.playerId===input.playerId && r.gameId===input.gameId)
  if(candidates.length!==1)return null
  const review=candidates[0]
  if(review?.kind!=='official_box_score' || typeof review.sourceUrl!=='string' || !/^https:\/\/[^/]+\/.+/.test(review.sourceUrl) || !Number.isFinite(Date.parse(review.reviewedAt)) || !Array.isArray(review.changes) || !review.changes.length)return null
  const stats={...(raw as Record<string,unknown>)}
  const keys=new Set<string>()
  for(const change of review.changes){
    if(typeof change.key!=='string' || keys.has(change.key) || !Number.isFinite(change.before) || !Number.isFinite(change.after) || stats[change.key]!==change.before)return null
    keys.add(change.key);stats[change.key]=change.after
  }
  return {stats,sourceUrl:review.sourceUrl,reviewedAt:review.reviewedAt,changes:review.changes}
}
