'use client'
import { useEffect,useState } from 'react'
import Link from 'next/link'
type Task = { id: string; title: string; status: string; sourceKey: string }
export default function WeeklyTaskFollowthrough({leagueId,es}:{leagueId:string;es:boolean}) {
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false)
  const [tasks,setTasks]=useState<Task[]>([]),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0)
  useEffect(()=>{const refresh=(event:Event)=>{if((event as CustomEvent).detail?.leagueId===leagueId)setRevision(v=>v+1)};window.addEventListener('af-commissioner-queue-refresh',refresh);return()=>window.removeEventListener('af-commissioner-queue-refresh',refresh)},[leagueId])
  useEffect(()=>{
    if(!open)return
    const controller=new AbortController();setTasks([]);setFailed(false);setLoading(true)
    fetch(`/api/core/commissioner-queue?league=${encodeURIComponent(leagueId)}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error();const body=await response.json();if(!controller.signal.aborted)setTasks((Array.isArray(body.tasks)?body.tasks:[]).filter((t:Task)=>typeof t.id==='string'&&typeof t.title==='string'&&typeof t.status==='string'&&t.sourceKey?.startsWith('weekly:')).slice(0,10))}).catch(()=>{if(!controller.signal.aborted)setFailed(true)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[leagueId,revision,open])
  const labels:Record<string,string>=es?{open:'Abierta',in_progress:'En curso',waiting_on_manager:'Esperando al manager',waiting_on_league_vote:'Esperando votación',completed:'Completada',archived:'Archivada'}:{open:'Open',in_progress:'In progress',waiting_on_manager:'Waiting on manager',waiting_on_league_vote:'Waiting on league vote',completed:'Completed',archived:'Archived'}
  return <details onToggle={e=>setOpen(e.currentTarget.open)} aria-label={es?'Seguimiento semanal':'Weekly follow-through'}><summary>{es?'Seguimiento semanal':'Weekly follow-through'}</summary>
    {loading?<p>{es?'Cargando tareas…':'Loading tasks…'}</p>:failed?<p role="status">{es?'No se pudo leer el seguimiento. Abre la cola para comprobarlo.':'Follow-through could not be loaded. Open the queue to check it.'}</p>:tasks.length?<ul>{tasks.map(t=><li key={t.id}><strong>{t.title}</strong> · {labels[t.status]??t.status}</li>)}</ul>:<p>{es?'Aún no hay tareas semanales guardadas.':'No saved weekly tasks yet.'}</p>}
    <p>{es?'Los anuncios y encuestas se envían desde el chat. Después actualiza el estado de la tarea; abrir un borrador no completa el asunto.':'Send announcements and polls from league chat, then update the task status. Opening a draft does not resolve the issue.'}</p>
    <Link href={`/core/commissioner?league=${encodeURIComponent(leagueId)}`}>{es?'Actualizar estado y revisar auditoría':'Update status and review audit history'} →</Link>
  </details>
}
