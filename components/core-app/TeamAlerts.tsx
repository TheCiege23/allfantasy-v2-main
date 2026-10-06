'use client'
import Link from 'next/link'
import { useEffect,useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { teamWorkspaceCopy } from '@/lib/core-app/teamWorkspaceCopy'
import type { TeamAlert } from '@/lib/core-app/teamAlerts'
import LocalDateTime from './LocalDateTime'
export default function TeamAlerts({leagueId}:{leagueId:string}){
  const {language}=useOptionalLanguage(),t=(en:string,es:string)=>language==='es'?es:en
  const [state,setState]=useState<{available:boolean;alerts:TeamAlert[]}|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0),[opened,setOpened]=useState(false)
  useEffect(()=>{if(!opened)return;const controller=new AbortController();setState(null);setFailed(false);fetch(`/api/core/team-alerts?league=${encodeURIComponent(leagueId)}`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json()}).then(setState).catch(e=>{if(e.name!=='AbortError')setFailed(true)});return()=>controller.abort()},[leagueId,retry,opened])
  return <details className="af-tw-panel" onToggle={e=>setOpened(e.currentTarget.open)}><summary>{t('League injury and deadline alerts','Alertas de lesión y plazos de la liga')}</summary><p>{t('Alerts use saved league evidence. Delivery follows your channel preferences and quiet hours.','Las alertas usan datos guardados de la liga. La entrega respeta tus canales y horas de silencio.')}</p><Link href="/settings?tab=notifications">{t('Notification preferences','Preferencias de notificación')}</Link>
    {failed||state?.available===false?<p role="status">{t('Alert evidence is unavailable. Refresh before making a lineup decision.','Los datos de alertas no están disponibles. Actualiza antes de decidir sobre tu alineación.')}</p>:!state?<p role="status">{t('Loading league alerts…','Cargando alertas de liga…')}</p>:!state.alerts.length?<p>{t('No upcoming alerts were identified in the readable evidence. Missing news or schedules may hide issues.','No se identificaron alertas próximas en los datos legibles. Las noticias o calendarios faltantes pueden ocultar problemas.')}</p>:<ul>{state.alerts.map(a=><li key={a.key}><strong>{a.playerName??teamWorkspaceCopy(a.label,language)} · {a.leagueName}</strong><p>{t('Deadline','Plazo')}: <LocalDateTime value={a.deadline}/></p>{a.kind==='injury'&&<p>{t('Eligible bench alternative','Alternativa elegible de banca')}: {a.alternative??t('None verified','Ninguna verificada')}</p>}<p>{t('Source','Fuente')}: {a.source} · {a.observedAt?<LocalDateTime value={a.observedAt}/>:t('Freshness unavailable','Actualización no disponible')}{!a.fresh&&` · ${t('Review stale or uncertain evidence','Revisar datos antiguos o inciertos')}`}</p><Link href={a.href}>{t('Review this league','Revisar esta liga')}</Link></li>)}</ul>}
    <button type="button" className="af-btn" onClick={()=>setRetry(v=>v+1)}>{t('Refresh alerts','Actualizar alertas')}</button>
  </details>
}
