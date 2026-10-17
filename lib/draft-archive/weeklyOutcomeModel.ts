import {DEFAULT_SLOT_ELIGIBILITY} from '@/lib/decision-os/trade/rosterImpact'
import type {AnalysisSelection} from './analysisModel'
// 32 teams × 100 rostered players × 18 regular-season weeks.
export const MAX_WEEKLY_ROSTER_PLAYERS = 57600
export type WeeklyRosterEvidence={week:number;rosterId:string;players:Array<{playerId:string;position:string|null;points:number|null;starter:boolean;finalized:boolean}>;slots:Array<{slot:string;playerId:string|null}>}
export type WeeklyReplacement={playerId:string;rosterId:string;week:number;state:'ready'|'unavailable';replacementPlayerId:string|null;replacementPoints:number|null;difference:number|null}
/** Retrospective same-roster bench substitution, never hypothetical waiver availability. */
export function weeklyOutcomes(picks:AnalysisSelection[],expectedWeeks:number[],teams:string[],evidence:WeeklyRosterEvidence[]){
 const empty={finalizedWeeks:[] as number[],replacements:[] as WeeklyReplacement[]}
 if(picks.length>1000||evidence.length>576||evidence.reduce((s,e)=>s+e.players.length,0)>MAX_WEEKLY_ROSTER_PLAYERS||teams.length<2||teams.length>32||new Set(teams).size!==teams.length||expectedWeeks.length>18||new Set(expectedWeeks).size!==expectedWeeks.length||expectedWeeks.some(w=>!Number.isInteger(w)||w<1||w>18))return empty
 const valid=evidence.filter(e=>expectedWeeks.includes(e.week)&&teams.includes(e.rosterId)&&e.players.length<=100&&e.slots.length<=32&&new Set(e.players.map(p=>p.playerId)).size===e.players.length&&e.players.every(p=>typeof p.playerId==='string'&&!!p.playerId&&(p.position===null||typeof p.position==='string')&&(p.points===null||(typeof p.points==='number'&&Number.isFinite(p.points)))&&typeof p.starter==='boolean'&&typeof p.finalized==='boolean')&&e.slots.every(s=>typeof s.slot==='string'&&(s.playerId===null||typeof s.playerId==='string')))
 if(valid.length!==evidence.length)return empty
 const key=(e:WeeklyRosterEvidence)=>JSON.stringify([e.week,e.rosterId])
 const duplicates=new Set(valid.filter((e,i)=>valid.findIndex(o=>key(o)===key(e))!==i).map(key))
 const rows=valid.filter(e=>!duplicates.has(key(e)))
 const finalizedWeeks=expectedWeeks.filter(week=>{
  const weekRows=rows.filter(e=>e.week===week),ids=weekRows.flatMap(e=>e.players.map(p=>p.playerId))
  return weekRows.length===teams.length&&teams.every(t=>weekRows.some(e=>e.rosterId===t))&&new Set(ids).size===ids.length&&weekRows.every(e=>e.players.length>0&&e.players.every(p=>p.finalized&&p.points!==null))
 })
 const replacements=picks.flatMap(pick=>expectedWeeks.map(week=>{
  const base:WeeklyReplacement={playerId:pick.playerId??'',rosterId:pick.rosterId??'',week,state:'unavailable',replacementPlayerId:null,replacementPoints:null,difference:null}
  const row=rows.find(e=>e.week===week&&e.rosterId===pick.rosterId),player=row?.players.find(p=>p.playerId===pick.playerId)
  if(!finalizedWeeks.includes(week)||!row||!player?.starter||player.points===null)return base
  const slots=row.slots.filter(s=>s.playerId===pick.playerId)
  const assigned=row.slots.flatMap(s=>s.playerId?[s.playerId]:[]),starters=row.players.filter(p=>p.starter).map(p=>p.playerId)
  if(slots.length!==1||new Set(assigned).size!==assigned.length||assigned.length!==starters.length||assigned.some(id=>!starters.includes(id)))return base
  const eligible=DEFAULT_SLOT_ELIGIBILITY[slots[0].slot.toUpperCase()]
  const bench=row.players.filter(p=>!p.starter)
  if(!eligible||bench.some(p=>!p.position||!Object.values(DEFAULT_SLOT_ELIGIBILITY).some(positions=>positions.includes(p.position!.toUpperCase()))))return base
  const candidates=bench.filter(p=>eligible.includes(p.position!.toUpperCase())).sort((a,b)=>b.points!-a.points!||a.playerId.localeCompare(b.playerId))
  const replacement=candidates[0]
  return replacement?{...base,state:'ready' as const,replacementPlayerId:replacement.playerId,replacementPoints:replacement.points,difference:player.points-replacement.points!}:base
 }))
 return{finalizedWeeks,replacements}
}

export function validatedWeeklyRosterEvidence(raw:unknown):WeeklyRosterEvidence[]|null {
 if(!Array.isArray(raw)||raw.length>576)return null
 const result:WeeklyRosterEvidence[]=[];let count=0
 for(const value of raw){
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const e=value as Record<string,unknown>
  if(typeof e.week!=='number'||!Number.isInteger(e.week)||e.week<1||e.week>18||typeof e.rosterId!=='string'||!e.rosterId||!Array.isArray(e.players)||e.players.length>100||!Array.isArray(e.slots)||e.slots.length>32)return null
  count+=e.players.length;if(count>MAX_WEEKLY_ROSTER_PLAYERS)return null
  const players:WeeklyRosterEvidence['players']=[],slots:WeeklyRosterEvidence['slots']=[]
  for(const value of e.players){
   if(!value||typeof value!=='object')return null
   const p=value as Record<string,unknown>
   if(typeof p.playerId!=='string'||!p.playerId||!(p.position===null||typeof p.position==='string')||!(p.points===null||(typeof p.points==='number'&&Number.isFinite(p.points)))||typeof p.starter!=='boolean'||typeof p.finalized!=='boolean')return null
   players.push({playerId:p.playerId,position:p.position as string|null,points:p.points as number|null,starter:p.starter,finalized:p.finalized})
  }
  for(const value of e.slots){
   if(!value||typeof value!=='object')return null
   const slot=value as Record<string,unknown>
   if(typeof slot.slot!=='string'||!(slot.playerId===null||typeof slot.playerId==='string'))return null
   slots.push({slot:slot.slot,playerId:slot.playerId as string|null})
  }
  result.push({week:e.week,rosterId:e.rosterId,players,slots})
 }
 return result
}
