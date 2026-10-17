'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { teamWorkspaceCopy } from '@/lib/core-app/teamWorkspaceCopy'
import { useEffect, useId, useRef, useState } from 'react'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import type { WeekPlan } from '@/lib/core-app/teamPlan'
import { isEligibleForSlot } from '@/lib/core-app/rosterSlots'

type LegacyPlan = {slots:Record<string,string>;note:string}
export default function TeamWeekPlanner({data,automatic}:{data:MyTeamData;automatic:boolean}) {
  const {language}=useOptionalLanguage(),es=language==='es'
  const copy=(s:string)=>teamWorkspaceCopy(s,language),text=(en:string,spanish:string)=>es?spanish:en
  const feedback=(en:string,spanish:string)=>JSON.stringify([en,spanish])
  const [week,setWeek]=useState(''),[note,setNote]=useState(''),[slots,setSlots]=useState<Record<string,string>>({})
  const [plan,setPlan]=useState<WeekPlan|null>(null),[legacy,setLegacy]=useState<Record<string,LegacyPlan>>({})
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[status,setStatus]=useState(''),[ready,setReady]=useState(false)
  const noteId=useId()
  const request=useRef(0),dirty=useRef(false)
  const validWeek=Number.isInteger(Number(week)) && Number(week)>=1 && Number(week)<=30
  const key=`af-week-plans:${data.league.id}:${data.nativeLineup?.rosterId ?? (data.team.available?data.team.data.teamName:'unclaimed')}`
  const url=`/api/core/team-plan?league=${encodeURIComponent(data.league.id)}&week=${encodeURIComponent(week)}`
  const scope=data.workspaceScope
  useEffect(()=>{try{const v=JSON.parse(localStorage.getItem(key) ?? '{}');setLegacy(v && typeof v==='object' && !Array.isArray(v)?v:{})}catch{setLegacy({})}},[key])
  useEffect(()=>{
    const sequence=++request.current,controller=new AbortController()
    dirty.current=false;setReady(false);setPlan(null);setNote('');setSlots({});setStatus('')
    if(!scope || !validWeek){setLoading(false);return}
    setLoading(true)
    fetch(url,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json()}).then(body=>{
      if(sequence!==request.current)return
      const p=body.plan as WeekPlan|null;setPlan(p);setNote(p?.deleted?'':p?.note ?? '');setSlots(p?.deleted?{}:p?.slots ?? {});setReady(true)
    }).catch(e=>{if(e.name!=='AbortError' && sequence===request.current)setStatus(feedback('The saved plan could not be loaded. Retry before saving.','No se pudo cargar el plan guardado. Reintenta antes de guardar.'))}).finally(()=>{if(sequence===request.current)setLoading(false)})
    return()=>controller.abort()
  },[url,scope?.rosterKey,scope?.season,validWeek])
  const players=[...(data.starters.available?data.starters.data.flatMap(s=>s.player?[s.player]:[]):[]),...(data.bench.available?data.bench.data:[])]
  async function loadSaved(){
    const sequence=++request.current;setLoading(true);setReady(false)
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error();const body=await r.json();if(sequence!==request.current)return;setPlan(body.plan);setNote(body.plan?.deleted?'':body.plan?.note??'');setSlots(body.plan?.deleted?{}:body.plan?.slots??{});dirty.current=false;setReady(true);setStatus('')}
    catch{if(sequence===request.current)setStatus(feedback('Could not reload the saved plan.','No se pudo volver a cargar el plan.'))}finally{if(sequence===request.current)setLoading(false)}
  }
  async function save(remove=false){
    const sequence=request.current;setSaving(true)
    try{
      const r=await fetch(url,{method:remove?'DELETE':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:plan?.version??0,slots,note})})
      const body=await r.json();if(sequence!==request.current)return
      if(r.status===409){setReady(false);setStatus(feedback('Another device changed this plan. Your edits remain here; reload the saved plan before saving again.','Otro dispositivo cambió este plan. Tus cambios siguen aquí; carga el plan guardado antes de volver a guardar.'));return}
      if(!r.ok)throw new Error()
      setPlan(body.plan);dirty.current=false;if(remove){setNote('');setSlots({})}
      setStatus(remove?feedback('Plan removed from your account.','Plan eliminado de tu cuenta.'):feedback('Saved to your account. This is a tentative plan; your submitted lineup has not changed.','Guardado en tu cuenta. Es un plan provisional; tu alineación enviada no ha cambiado.'))
    }catch{if(sequence===request.current)setStatus(feedback('Could not save. Your edits remain here; check your connection and retry.','No se pudo guardar. Tus cambios siguen aquí; comprueba la conexión y reintenta.'))}finally{setSaving(false)}
  }
  const old=legacy[week]
  return <details className="af-tw-panel"><summary>{copy('Plan a future week')}</summary>
    <p>{text('Private plans sync across your devices by league, roster, season and week. Saving a plan does not submit a lineup.','Los planes privados se sincronizan entre tus dispositivos por liga, plantilla, temporada y semana. Guardar un plan no envía una alineación.')}</p>
    {scope?<p>{text('Season','Temporada')} {scope.season} · {text('Tentative plan','Plan provisional')}</p>:<p role="status">{text('A verified roster and season are required to sync a plan.','Se requiere una plantilla y temporada verificadas para sincronizar un plan.')}</p>}
    <label>{copy('Planning week')}<input type="number" min="1" max="30" value={week} disabled={saving} onChange={e=>setWeek(e.target.value)}/></label>
    {loading && <p role="status">{text('Loading saved plan…','Cargando plan guardado…')}</p>}
    {!automatic && data.starters.available && <div className="af-tw-filters">{data.starters.data.map((s,i)=><label key={i}>{s.slotLabel}<select disabled={loading||saving} value={slots[String(i)]??''} onChange={e=>{dirty.current=true;setSlots(v=>({...v,[String(i)]:e.target.value}))}}><option value="">{copy('Unplanned')}</option>{players.filter(p=>isEligibleForSlot(s.slotLabel,p.position)).map(p=><option key={p.sleeperId} value={p.sleeperId} disabled={Object.entries(slots).some(([k,id])=>k!==String(i)&&id===p.sleeperId)}>{p.name}</option>)}</select></label>)}</div>}
    <label htmlFor={noteId}>{copy('Acquisitions, contingency plans, and reminders')}</label><textarea id={noteId} disabled={loading||saving} maxLength={2000} rows={3} value={note} onChange={e=>{dirty.current=true;setNote(e.target.value)}}/>
    <div className="af-tw-links"><button type="button" className="af-btn" disabled={!scope||!validWeek||!ready||loading||saving||new Set(Object.values(slots).filter(Boolean)).size!==Object.values(slots).filter(Boolean).length} onClick={()=>save()}>{copy('Save personal plan')}</button><button type="button" className="af-btn" disabled={!ready||loading||saving||!plan||plan.deleted} onClick={()=>save(true)}>{copy('Remove plan')}</button>{scope&&validWeek&&<button type="button" className="af-btn" disabled={loading||saving} onClick={loadSaved}>{text('Reload saved plan (replaces edits)','Cargar plan guardado (reemplaza cambios)')}</button>}</div>
    {old&&<p><button type="button" className="af-btn" disabled={loading||saving||!ready} onClick={()=>{setNote(typeof old.note==='string'?old.note:'');setSlots(old.slots&&typeof old.slots==='object'?old.slots:{});dirty.current=true;setStatus(feedback('Device-local plan copied into the editor. Review it, then save explicitly to your account.','Plan de este dispositivo copiado al editor. Revísalo y guárdalo explícitamente en tu cuenta.'))}}>{text('Review plan from this device','Revisar plan de este dispositivo')}</button></p>}
    <p role="status">{status?JSON.parse(status)[es?1:0]:''}</p><p>{copy('Each player can occupy only one planned slot. IR and taxi moves require provider eligibility.')}</p>
  </details>
}
