'use client'

import Link from 'next/link'

import {measureAlert,measuredAlertHref} from '@/lib/core-app/teamAlertClientMetrics'

import { useEffect,useState } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

import { teamWorkspaceCopy } from '@/lib/core-app/teamWorkspaceCopy'

import type { TeamAlert } from '@/lib/core-app/teamAlerts'

import { TeamDeliveryHistory,type TeamDeliveryRow } from './DeliveryReceipt'

import LocalDateTime from './LocalDateTime'

export default function TeamAlerts({leagueId}:{leagueId:string}){

  const {language}=useOptionalLanguage(),t=(en:string,es:string)=>language==='es'?es:en

  const [state,setState]=useState<{available:boolean;alerts:TeamAlert[];delivery?:TeamDeliveryRow[]}|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0),[opened,setOpened]=useState(false),[feedback,setFeedback]=useState<string[]>([]),[metricsFailed,setMetricsFailed]=useState(false),[metricsOpened,setMetricsOpened]=useState(false),[metrics,setMetrics]=useState<{days:number;counts:Record<string,number>}|null>(null)

  useEffect(()=>{

    if(!opened)return

    const controller=new AbortController()

    let disposed=false

    setState(null);setFailed(false);setFeedback([]);setMetrics(null)

    const timeout=setTimeout(()=>{if(!disposed){setFailed(true);controller.abort()}},15000)

    fetch(`/api/core/team-alerts?league=${encodeURIComponent(leagueId)}`,{cache:'no-store',signal:controller.signal})

      .then(async r=>{if(!r.ok)throw new Error();return r.json()})

      .then(body=>{if(!disposed&&!controller.signal.aborted)setState(body)})

      .catch(()=>{if(!disposed)setFailed(true)})

      .finally(()=>clearTimeout(timeout))

    return()=>{disposed=true;clearTimeout(timeout);controller.abort()}

  },[leagueId,retry,opened])

  useEffect(()=>{

    if(!opened)return

    let lastRefresh=-Infinity

    const resume=()=>{

      if(document.visibilityState==='hidden'||Date.now()-lastRefresh<1000)return

      lastRefresh=Date.now();setRetry(v=>v+1)

    }

    window.addEventListener('online',resume);window.addEventListener('pageshow',resume)

    document.addEventListener('visibilitychange',resume)

    return()=>{window.removeEventListener('online',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}

  },[opened,leagueId])



  useEffect(()=>{

    if(!metricsOpened)return

    const controller=new AbortController();let disposed=false

    setMetrics(null)

    const timeout=setTimeout(()=>controller.abort(),15000)

    fetch(`/api/core/team-alerts?league=${encodeURIComponent(leagueId)}&metrics=1`,{cache:'no-store',signal:controller.signal})

      .then(r=>{if(!r.ok)throw new Error();return r.json()})

      .then(body=>{if(!disposed)setMetrics(body)})

      .catch(()=>{if(!disposed)setMetricsFailed(true)})

      .finally(()=>clearTimeout(timeout))

    return()=>{disposed=true;clearTimeout(timeout);controller.abort()}

  },[leagueId,metricsOpened])

  return <details className="af-tw-panel" onToggle={e=>setOpened(e.currentTarget.open)}><summary>{t('League injury and deadline alerts','Alertas de lesión y plazos de la liga')}</summary><p>{t('Alerts use saved league evidence. Delivery follows your channel preferences and quiet hours.','Las alertas usan datos guardados de la liga. La entrega respeta tus canales y horas de silencio.')}</p><Link href="/settings?tab=notifications">{t('Notification preferences','Preferencias de notificación')}</Link>

    {failed||state?.available===false?<p role="status">{t('Alert evidence is unavailable. Refresh before making a lineup decision.','Los datos de alertas no están disponibles. Actualiza antes de decidir sobre tu alineación.')}</p>:!state?<p role="status">{t('Loading league alerts…','Cargando alertas de liga…')}</p>:!state.alerts.length?<p>{t('No upcoming alerts were identified in the readable evidence. Missing news or schedules may hide issues.','No se identificaron alertas próximas en los datos legibles. Las noticias o calendarios faltantes pueden ocultar problemas.')}</p>:<ul>{state.alerts.map(a=><li key={a.key}><strong>{a.playerName??teamWorkspaceCopy(a.label,language)} · {a.leagueName}</strong><p>{t('Deadline','Plazo')}: <LocalDateTime value={a.deadline}/></p>{a.kind==='injury'&&<p>{t('Eligible bench alternative','Alternativa elegible de banca')}: {a.alternative??t('None verified','Ninguna verificada')}</p>}<p>{t('Source','Fuente')}: {a.source} · {a.observedAt?<LocalDateTime value={a.observedAt}/>:t('Freshness unavailable','Actualización no disponible')}{!a.fresh&&` · ${t('Review stale or uncertain evidence','Revisar datos antiguos o inciertos')}`}</p><Link href={measuredAlertHref(a.href,a.measurement)} onClick={()=>measureAlert(leagueId,a.measurement,'opened')}>{a.kind==='injury'?t('Review this player and backups','Revisar este jugador y sus reservas'):t('Review this deadline','Revisar este plazo')}</Link>{a.measurement&&<button type="button" className="af-btn" disabled={feedback.includes(a.key)} onClick={()=>{setFeedback(v=>[...v,a.key]);void measureAlert(leagueId,a.measurement,'not_useful').then(ok=>{if(!ok)setFeedback(v=>v.filter(key=>key!==a.key))})}}>{feedback.includes(a.key)?t('Feedback noted','Opinión registrada'):t('This alert was not useful','Esta alerta no fue útil')}</button>}{a.measurement&&<button type="button" className="af-btn" disabled={feedback.includes(a.key+':repeat')} onClick={()=>{setFeedback(v=>[...v,a.key+':repeat']);void measureAlert(leagueId,a.measurement,'repeat').then(ok=>{if(!ok)setFeedback(v=>v.filter(key=>key!==a.key+':repeat'))})}}>{t('Already saw this alert','Ya vi esta alerta')}</button>}</li>)}</ul>}

    {metricsOpened&&metricsFailed&&<p role="status">{t('Alert activity is unavailable. Try again.','La actividad de alertas no está disponible. Inténtalo de nuevo.')}</p>}
    {metricsOpened&&metrics&&<p role="status">{t('Your alert activity over 30 days','Tu actividad de alertas en 30 días')}: {t('Opened','Abiertas')} {metrics.counts.opened} · {t('Reviewed','Revisadas')} {metrics.counts.reviewed} · {t('Stale on review','Antiguas al revisar')} {metrics.counts.stale} · {t('Not useful','No útiles')} {metrics.counts.not_useful} · {t('Unwanted repeats','Repetidas no deseadas')} {metrics.counts.repeat}</p>}

    <button type="button" className="af-btn" onClick={()=>setMetricsOpened(v=>!v)}>{t('View alert usefulness','Ver utilidad de alertas')}</button>

    {state&&<TeamDeliveryHistory rows={state.delivery??[]}/>}

    <button type="button" className="af-btn" onClick={()=>setRetry(v=>v+1)}>{t('Refresh alerts','Actualizar alertas')}</button>

  </details>

}
