"use client"
import {measureAlert} from '@/lib/core-app/teamAlertClientMetrics'
import {useEffect,useMemo,useState} from 'react'
import {parseDeadlineAlertTarget,deadlineAlertDecision} from '@/lib/core-app/teamAlertTarget'
import {useOptionalLanguage} from '@/components/i18n/LanguageProviderClient'
import type {LeagueCalendarEvent} from '@/lib/core-app/leagueCalendar'
import LocalDateTime from './LocalDateTime'
import {teamWorkspaceCopy} from '@/lib/core-app/teamWorkspaceCopy'
export default function TeamDeadlineAlertTarget({leagueId,events,query}:{leagueId:string;events:LeagueCalendarEvent[];query:string}){
 const {language}=useOptionalLanguage(),es=language==='es',t=(en:string,sp:string)=>es?sp:en
 const target=useMemo(()=>parseDeadlineAlertTarget(new URLSearchParams(query),leagueId),[query,leagueId]),[now,setNow]=useState(0)
 useEffect(()=>{const refresh=()=>setNow(Date.now());refresh();const timer=setInterval(refresh,30000);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',refresh)}},[])
 useEffect(()=>{if(target&&now>0){const panel=document.getElementById('af-team-deadline-alert');panel?.focus({preventScroll:true});panel?.scrollIntoView({block:'center'})}},[target,now>0])
 const decision=target&&now?deadlineAlertDecision(events,target,now):null
 useEffect(()=>{if(!target||!decision)return;measureAlert(leagueId,new URLSearchParams(query).get('alertMeasure'),decision.state==='current'?'reviewed':'stale')},[target,decision?.state,query,leagueId])
 if(!target||!decision)return null
 const reasons={current:t('This is the recorded deadline from your alert. Review the league rules before acting.','Este es el plazo registrado de tu alerta. Revisa las reglas antes de actuar.'),changed:t('The recorded deadline changed after this alert. Use the current calendar below.','El plazo registrado cambió tras esta alerta. Usa el calendario actual de abajo.'),expired:t('This alert deadline has passed. Review the current calendar and league rules.','El plazo de esta alerta ya pasó. Revisa el calendario actual y las reglas.'),missing:t('This deadline is no longer recorded in the league calendar. Verify it with your commissioner.','Este plazo ya no figura en el calendario de la liga. Verifícalo con tu comisionado.')}
 return <section id="af-team-deadline-alert" tabIndex={-1} className="af-tw-panel" aria-labelledby="af-team-deadline-title"><h2 id="af-team-deadline-title">{t('Review this deadline alert','Revisar esta alerta de plazo')}</h2><p role="status">{reasons[decision.state]}</p><p>{t('Original alert deadline','Plazo de la alerta original')}: <LocalDateTime value={target.deadline}/></p>{decision.event&&<p>{t('Current calendar entry','Entrada actual del calendario')}: {teamWorkspaceCopy(decision.event.label,language)} · <LocalDateTime value={decision.event.at}/></p>}</section>
}
