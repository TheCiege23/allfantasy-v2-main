'use client'
import { useState } from 'react'
import { weeklySchedulePrompt, weeklyScheduleCount, type WeeklyScheduleForecast } from '@/lib/core-app/weeklyScheduleForecast'
import { COMMS_OPEN_EVENT } from './comms/commsEvents'
export function WeeklyScheduleForecasts({forecasts,es=false}:{forecasts?:WeeklyScheduleForecast[];es?:boolean}) {
 if(!forecasts?.length)return null
 return <details className="af-wbp-sports"><summary>{es?'Oportunidades del calendario: próximos 7 días':'Schedule opportunities: next 7 days'}</summary>
 <p>{es?'Partidos de los equipos de tus jugadores encontrados en el calendario regular almacenado. Es un mínimo de datos disponibles; no confirma participación, formato ni partidos que cuentan.':'Your players’ team games found in the stored regular-season schedule. Counts are a lower bound of available data; they do not confirm appearances, format, or how many games count.'}</p>
 {forecasts.map(f=><ForecastLeague key={f.leagueId} f={f} es={es}/>)}
 </details>
}
function ForecastLeague({f,es}:{f:WeeklyScheduleForecast;es:boolean}) {
 const [open,setOpen]=useState(false)
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{f.leagueName} · {f.sport}</summary>{open?<>
 <p><small>{f.from.slice(0,10)} → {f.through.slice(0,10)} UTC · {es?'Ventana móvil; puede diferir del período de puntuación.':'Rolling window; may differ from the scoring period.'}</small></p>
 {f.players.length?<ul>{f.players.map(p=><li key={p.id}><strong>{p.name}</strong> · {p.starter?(es?'titular':'starter'):(es?'suplente':'bench')} · {weeklyScheduleCount(p.games,es)}
 {p.backToBackDays? <span> · {p.backToBackDays} {es?'pares de días consecutivos (UTC)':'consecutive-day pairs (UTC)'}</span>:null}
 {p.role!=='other'?<p>{es?'Los partidos del equipo no confirman aperturas.':'Team games do not confirm starts.'}</p>:null}
 {p.dates.length?<details><summary>{es?'Fechas almacenadas (UTC)':'Stored dates (UTC)'}</summary><ul>{p.dates.map(d=><li key={d}><time dateTime={d}>{d.replace('T',' ').replace('.000Z',' UTC')}</time></li>)}</ul></details>:null}</li>)}</ul>:<p>{es?'Datos insuficientes para este equipo.':'Insufficient data for this team.'}</p>}
 <p>{es?'Por confirmar: integridad del calendario, formato y límites de alineación. Las variaciones por categorías y las aperturas no están disponibles sin entradas verificadas.':'Still to confirm: schedule completeness, scoring format and lineup limits. Category swings and individual starts are unavailable without verified inputs.'}</p>
 <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT,{detail:{tab:'chimmy',leagueId:f.leagueId,prefill:weeklySchedulePrompt(f,es)}}))}>{es?'Revisar con Chimmy':'Review with Chimmy'}</button></>:null}</details>
}
