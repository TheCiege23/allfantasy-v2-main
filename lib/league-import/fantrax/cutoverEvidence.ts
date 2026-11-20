import { parse } from 'csv-parse/sync'
import type { DatedPlayerLine } from './datedCutoverScoring'
import { categoryStatValue } from '@/lib/category-scoring/CategoryMatchupResolver'

type EvidenceRow = { team:string; player:string; day:string; slot:string; points:number | null; stats:Record<string,number> }
export function parseCutoverEvidence(csv: string, season:number, period:number) {
  if (!csv || Buffer.byteLength(csv,'utf8')>12_000_000) throw Error('Choose a dated player CSV under 12 MB.')
  const rows:string[][]=parse(csv,{bom:true,skip_empty_lines:true})
  const headers=rows.shift() ?? []
  const required=['season','period','team_id','player_id','date','slot','points']
  if (!required.every(k=>headers.includes(k)) || new Set(headers).size!==headers.length) throw Error('The file must include season, period, team_id, player_id, date, slot and points.')
  const num=(s:string) => {
    if (!/^-?\d+(?:\.\d+)?$/.test(s) || !Number.isFinite(Number(s))) throw Error('An actual score or stat is missing.')
    return Number(s)
  }
  const data=new Map<string,EvidenceRow>()
  for(const row of rows){
    const cell=(key:string)=>String(row[headers.indexOf(key)]??'').trim()
    if (cell('season')!==String(season)||cell('period')!==String(period)) throw Error('The exported season or period differs from the selected handoff.')
    const team=cell('team_id'),player=cell('player_id'),day=cell('date'),slot=cell('slot').toUpperCase()
    if(!team || !player || !/^\d{4}-\d\d-\d\d$/.test(day) || !['ACTIVE','RESERVE','IR','TAXI'].includes(slot)) throw Error('Invalid franchise, athlete, date or lineup status.')
    const key=JSON.stringify([team,day,player])
    if(data.has(key)) throw Error('The file repeats an athlete on the same franchise and date.')
    data.set(key,{team,player,day,slot,points:cell('points') ? num(cell('points')) : null,stats:Object.fromEntries(headers.filter(k=>k.startsWith('stat.')).map(k=>[k.slice(5),num(cell(k))]))})
  }
  if (!data.size) throw Error('The file contains no player lines.')
  return data
}

export function verifyDatedRows(rows: Map<string,EvidenceRow>, team:string, days:string[], roster: Array<{player:string;fantraxId?:string|null}>,
  lines:DatedPlayerLine[], categoryKeys:string[]) {
  let matched=0
  const selected=[...rows.values()].filter(r=>r.team===team)
  if(selected.length !== roster.length*days.length) throw Error('Every athlete needs one lineup and actual score on every elapsed scoring date.')
  const grouped=new Map<string,{points:number;stats:Record<string,number>}>()
  for(const l of lines){
    const key=JSON.stringify([l.day,l.player]), total=grouped.get(key) ?? {points:0,stats:{}}
    total.points+=l.points
    for(const [k,v] of Object.entries(l.stats))total.stats[k]=(total.stats[k]??0)+v
    grouped.set(key,total)
  }
  for(const day of days)for(const p of roster){
    const row=rows.get(JSON.stringify([team,day,p.fantraxId]))
    if(!row)throw Error('A dated source lineup is missing an identified native athlete.')
    const native=grouped.get(JSON.stringify([day,p.player])) ?? {points:0,stats:{}}
    if (!categoryKeys.length && (row.points===null || Math.abs(native.points-row.points)>0.005)) throw Error('Individual fantasy points differ on '+day+'.')
    if(categoryKeys.some(k=>row.stats[k]===undefined || Math.abs(row.stats[k]-categoryStatValue(native.stats,k))>0.000001)) throw Error('A scoring-category component is missing or differs on '+day+'.')
    matched++
  }
  return matched
}
