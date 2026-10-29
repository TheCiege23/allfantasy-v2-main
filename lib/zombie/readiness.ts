import { getDraftStatColumnsForSport, getStatValueForDraftPlayer, type DraftStatPlayerSource } from '@/lib/draft-room/draftSportStatColumns'

export type ReadinessCheck = { id: string; label: string; status: 'ready'|'attention'|'waiting'|'unknown'; detail: string; href?: string }
export type ZombieLeagueReadiness = { leagueId: string; name: string; sport: string; season: number; week: number; checks: ReadinessCheck[] }
export type ZombieReadinessReport = { checkedAt: string; scope: 'league'|'universe'; leagues: ZombieLeagueReadiness[] }

/** Only actual distinct AppUser IDs count. Duplicate ownership cannot fill multiple seats. */
export function registeredSeatReadiness(owners: string[], registeredIds: string[], capacity: number) {
  const registered=new Set(registeredIds)
  const claimed=owners.filter(id=>registered.has(id))
  const distinct=new Set(claimed).size
  return { registered: distinct, missing: Math.max(0,capacity-distinct),
    duplicate: claimed.length-distinct, ready: owners.length===capacity && distinct===capacity && claimed.length===distinct }
}
const record=(v:unknown):Record<string,unknown>=>v && typeof v==='object' && !Array.isArray(v)?v as Record<string,unknown>:{}
const numeric=(v:unknown)=>typeof v==='number' && Number.isFinite(v)
/** Coverage of the exact saved draft snapshot; zero is a valid statistic, placeholders aren't portraits. */
export function savedPoolCoverage(payload: unknown, sport: string) {
  const raw=record(payload).entries
  const entries=Array.isArray(raw)?raw.map(record):[]
  let portraits=0,stats=0,adp=0,positions=0
  for(const entry of entries) {
    const display=record(entry.display),assets=record(display.assets)
    if(typeof entry.position==='string' && entry.position.trim()) positions++
    if(typeof assets.headshotUrl==='string' && /^https?:\/\//.test(assets.headshotUrl) && assets.headshotFallbackUsed!==true) portraits++
    if(numeric(entry.adp) && (entry.adp as number)>0) adp++
    const columns=getDraftStatColumnsForSport(sport,{position:String(entry.position||'')}).filter(c=>!/adp|bye/i.test(c.key))
    if(columns.some(c=>getStatValueForDraftPlayer(entry as DraftStatPlayerSource,c)!==null)) stats++
  }
  return { entries:entries.length, portraits,stats,adp,positions }
}

/** Missing settlements are actionable even if no existing row carries a pending flag. */
export function settlementReadiness(rows: Array<{week:number;status:string;requiresStatCorrection:boolean}>, first: number, lastDue: number) {
  const missing=Array.from({length:Math.max(0,lastDue-first+1)},(_,i)=>first+i).filter(week=>!rows.some(r=>r.week===week))
  const pending=rows.filter(r=>r.status!=='complete'||r.requiresStatCorrection).length
  return {missing:missing.length,pending}
}
