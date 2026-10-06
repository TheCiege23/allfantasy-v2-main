'use client'
import { useEffect,useRef,useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { isEligibleForSlot } from '@/lib/core-app/rosterSlots'
import type { MyTeamData } from '@/lib/core-app/myTeam'
import type { NativeAutoSubsAssignment } from '@/lib/core-app/nativeAutoSubsPolicy'
import LocalDateTime from './LocalDateTime'
export function NativeAutoSubsControls({data}:{data:MyTeamData}){
  const {language}=useOptionalLanguage(),t=(en:string,es:string)=>language==='es'?es:en
  const [state,setState]=useState<{commissionerEnabled:boolean;assignment:NativeAutoSubsAssignment|null;audit?:Array<{id:string;message:string;createdAt:string}>}|null>(null),[backups,setBackups]=useState<Record<string,string>>({}),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[opened,setOpened]=useState(false)
  const url=`/api/core/native-auto-subs?league=${encodeURIComponent(data.league.id)}`
  const scopeRequest=useRef(0)
  async function load(){const sequence=++scopeRequest.current;setBusy(true);try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error();const body=await r.json();if(sequence!==scopeRequest.current)return;setState(body);setEnabled(body.assignment?.enabled??false);const raw=body.assignment?.backups??{};setBackups(Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Object.entries(data.nativeLineup?.benchIds??{}).find(([,id])=>id===v)?.[0]??''])));setMessage('')}catch{if(sequence!==scopeRequest.current)return;setState(null);setMessage(t('Could not load native AutoSubs. Refresh before changing settings.','No se pudieron cargar las sustituciones nativas. Actualiza antes de cambiar la configuración.'))}finally{if(sequence===scopeRequest.current)setBusy(false)}}
  useEffect(()=>{scopeRequest.current++;setState(null);setBackups({});setEnabled(false);setBusy(false);setMessage('');if(opened)void load();return()=>{scopeRequest.current++}},[url,opened])
  async function save(){const sequence=scopeRequest.current;setBusy(true);try{const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled,backups,expectedVersion:state?.assignment?.version??0})});if(!r.ok)throw new Error();const body=await r.json();if(sequence!==scopeRequest.current)return;setState(v=>({...body,audit:v?.audit}));setMessage(t('Backup choices saved for this week. Execution requires fresh inactive status and unlocked games.','Reservas guardadas para esta semana. La ejecución requiere un estado de baja actualizado y partidos sin bloqueo.'))}catch{if(sequence!==scopeRequest.current)return;setState(null);setMessage(t('Settings were not saved. Reload to check commissioner permission or changes on another device.','No se guardó la configuración. Actualiza para comprobar el permiso del comisionado o cambios en otro dispositivo.'))}finally{if(sequence===scopeRequest.current)setBusy(false)}}
  return <details className="af-tw-panel" onToggle={e=>setOpened(e.currentTarget.open)}><summary>{t('Native AutoSubs','Sustituciones nativas')}</summary><p>{t('Choose a backup for each starter. Only a confirmed inactive starter is replaced; questionable status never triggers a swap. Both games must be unlocked and status evidence no more than 30 minutes old.','Elige una reserva para cada titular. Solo se reemplaza un titular confirmado de baja; un estado dudoso nunca activa un cambio. Ambos partidos deben estar sin bloqueo y los estados tener como máximo 30 minutos.')}</p>
    <p>{state?.commissionerEnabled?t('Commissioner enabled. Each manager must opt in.','Habilitado por el comisionado. Cada manager debe activarlo.'):t('Commissioner enablement required.','Se requiere habilitación del comisionado.')}</p>
    <label className="af-tw-optin"><input type="checkbox" checked={enabled} disabled={!state||busy||(!state.commissionerEnabled&&!enabled)} onChange={e=>setEnabled(e.target.checked)}/>{t('Authorize my assigned backups for this week','Autorizar mis reservas asignadas para esta semana')}</label>
    {data.starters.available&&<div className="af-tw-filters">{data.starters.data.map((s,i)=><label key={i}>{s.slotLabel} · {s.player?.name}<select value={backups[String(i)]??''} disabled={!state||busy} onChange={e=>setBackups(v=>({...v,[String(i)]:e.target.value}))}><option value="">{t('No backup','Sin reserva')}</option>{data.bench.available&&data.bench.data.filter(p=>isEligibleForSlot(s.slotLabel,p.position)).map(p=><option key={p.sleeperId} value={p.sleeperId} disabled={Object.entries(backups).some(([k,id])=>k!==String(i)&&id===p.sleeperId)}>{p.name}</option>)}</select></label>)}</div>}
    <div className="af-tw-links"><button type="button" className="af-btn" disabled={!state||busy} onClick={save}>{t('Save backup authorization','Guardar autorización de reservas')}</button><button type="button" className="af-btn" disabled={busy} onClick={load}>{t('Reload settings','Actualizar configuración')}</button></div><p role="status">{message}</p>
    <p>{t('A manual lineup change pauses these assignments until you review and save them again. External providers must be managed in their own app.','Un cambio manual de alineación pausa estas asignaciones hasta que las revises y guardes de nuevo. Las plataformas externas se gestionan en su propia aplicación.')}</p>
    {!!state?.audit?.length&&<ul>{state.audit.map(a=><li key={a.id}><p>{a.message}</p><LocalDateTime value={a.createdAt}/></li>)}</ul>}
  </details>
}
export function NativeAutoSubsCommissioner({leagueId}:{leagueId:string}){
  const {language}=useOptionalLanguage(),t=(en:string,es:string)=>language==='es'?es:en
  const [enabled,setEnabled]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const url=`/api/core/native-auto-subs/commissioner?league=${encodeURIComponent(leagueId)}`
  useEffect(()=>{
    const controller=new AbortController()
    setEnabled(null);setMessage('')
    fetch(url,{cache:'no-store',signal:controller.signal})
      .then(async r=>{if(!r.ok)throw new Error();return r.json()})
      .then(v=>{if(!controller.signal.aborted)setEnabled(v.enabled)})
      .catch(()=>{if(!controller.signal.aborted)setMessage(t('Commissioner permission or a connection is required.','Se requiere permiso del comisionado o conexión.'))})
    return()=>controller.abort()
  },[url])
  async function toggle(){setBusy(true);try{const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedEnabled:enabled,enabled:!enabled})});if(!r.ok)throw new Error();setEnabled((await r.json()).enabled);setMessage(t('League policy saved and audited.','Política de liga guardada y registrada.'))}catch{setEnabled(null);setMessage(t('Policy changed or permission was denied. Refresh this page before retrying.','La política cambió o se denegó el permiso. Actualiza la página antes de reintentar.'))}finally{setBusy(false)}}
  return <section className="af-tw af-tw-panel"><h2>{t('Native AutoSubs policy','Política de sustituciones nativas')}</h2><p>{t('Enable owner-assigned, injury-only backups for native manual lineups. Each owner must separately authorize their backups. Disabling this policy stops execution without removing their choices.','Habilita reservas asignadas por el propietario solo por lesión para alineaciones manuales nativas. Cada propietario debe autorizarlas por separado. Desactivar esta política detiene la ejecución sin eliminar las elecciones.')}</p><button type="button" className="af-btn" disabled={enabled===null||busy} onClick={toggle}>{enabled?t('Disable native AutoSubs','Desactivar sustituciones nativas'):t('Enable native AutoSubs','Habilitar sustituciones nativas')}</button><p role="status">{message}</p></section>
}
