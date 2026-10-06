'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'
import { weeklyBrief, weeklyActionText, weeklyActionReason, weeklyActionPrompt, type WeeklyBlueprint as Blueprint, type WeeklyAction } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'
import { formatPct1, pct1 } from '@/lib/core-app/weeklyPercent'
import '@/components/core-app/af-week-blueprint.css'
import { WeeklySharing } from './WeeklySharing'

export function WeeklyBlueprint({ data, path }: { data: Blueprint; path?: WeeklyPlayoffPath | null }) {
  const { language } = useOptionalLanguage(); const es = language === 'es'
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const brief = weeklyBrief(data, es)
  const ask = () => {
    const detail: CommsOpenDetail = { tab: 'chimmy', prefill: `${brief}\n${es ? 'Explica los riesgos y las opciones de esta semana. Verifica las reglas y los plazos; no supongas datos que falten.' : 'Explain this week’s risks and options. Verify the rules and deadlines; do not assume missing data.'}`, ...(data.focusLeagueId ? { leagueId: data.focusLeagueId } : {}) }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }
  const askAction = (action: WeeklyAction) => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, {detail:{tab:'chimmy',leagueId:action.leagueId,prefill:weeklyActionPrompt(action,es)} satisfies CommsOpenDetail}))
  async function copyBrief() { try { await navigator.clipboard.writeText(brief); setCopyState('copied') } catch { setCopyState('manual') } }
  return <section className="af-wbp" aria-label={es ? 'Tu plan semanal' : 'Your weekly blueprint'}>
    <header><p className="af-label">{es ? 'AllFantasy · Tu plan' : 'AllFantasy · Your blueprint'}</p>
      <h2>{data.name ? `${data.name}, ` : ''}{es ? 'tu semana de fantasy' : 'your fantasy week'}</h2>
      <p>{brief}</p>
      <div className="af-wbp-buttons"><button type="button" onClick={ask}>{es ? 'Preguntar a Chimmy' : 'Ask Chimmy'}</button><button type="button" onClick={copyBrief}>{es ? 'Copiar mi resumen' : 'Copy my brief'}</button></div>
      <span role="status">{copyState === 'copied' ? es ? 'Resumen copiado.' : 'Brief copied.' : copyState === 'manual' ? es ? 'Selecciona el texto de abajo para copiarlo.' : 'Select the text below to copy it.' : ''}</span>
      {copyState === 'manual' ? <textarea aria-label={es ? 'Resumen para copiar' : 'Brief to copy'} readOnly value={brief} onFocus={e => e.target.select()} /> : null}
    </header>
    <div className="af-wbp-grid"><section><h3>{es ? 'Tus próximas prioridades' : 'Your next priorities'}</h3>
      <p>{es ? 'Empieza por una decisión. Abre su liga o compara las opciones con Chimmy.' : 'Start with one decision. Open its league or compare options with Chimmy.'}</p>
      {data.actions.length ? <ol className="af-wbp-actions">{data.actions.map(a => <li key={a.id}>
        <span className="af-wbp-action-tag">{a.kind === 'monitor' ? es ? 'Vigilar' : 'Watchlist' : a.kind === 'sync' ? es ? 'Datos pendientes' : 'Data check' : a.kind === 'lineup' ? es ? 'Revisar alineación' : 'Lineup review' : es ? 'Planificar' : 'Plan ahead'}</span>
        <Link href={a.href}><strong>{weeklyActionText(a, es)}</strong><span>{a.leagueName}</span></Link>
        <p>{weeklyActionReason(a,es)}</p>
        {a.gameAt ? <small>{es ? 'Próximo partido: ' : 'Next game: '}<LocalGameTime iso={a.gameAt} language={language} />. {es ? 'Confirma el bloqueo en tu liga.' : 'Confirm your league’s lineup lock.'}</small> : <small>{es ? 'Comprueba las reglas y el horario de tu liga.' : 'Check your league’s rules and timing.'}</small>}
        <button type="button" onClick={()=>askAction(a)} aria-label={es ? `Comparar opciones con Chimmy: ${a.leagueName}` : `Compare options with Chimmy: ${a.leagueName}`}>{es ? 'Comparar con Chimmy' : 'Compare with Chimmy'}</button>
      </li>)}</ol> : <p>{es ? 'Conecta una liga para preparar tu semana.' : 'Connect a league to build your week.'}</p>}
      {data.actionCount > 3 ? <p>{es ? 'Estas son tus tres primeras prioridades.' : 'These are your first three priorities.'}</p> : null}
      {data.lineupReadFailed ? <p role="status">{es ? 'No pudimos comprobar las alineaciones. Revisa tu equipo antes de decidir.' : 'Lineup checks are unavailable. Review your team before deciding.'}</p> : null}
      <Link href={data.focusLeagueId ? `/core/my-team?league=${encodeURIComponent(data.focusLeagueId)}` : '/core/my-team'}>{es ? 'Abrir Mi equipo' : 'Open My Team'} →</Link>
    </section>{path ? <PlayoffPath path={path} /> : <section><h3>{es ? 'Cobertura de alineaciones' : 'Lineup coverage'}</h3>
      <p>{es ? 'Las estimaciones históricas se muestran aparte de los pronósticos de tu alineación actual.' : 'Historical scoring estimates are shown separately from current lineup forecasts.'}</p>
      <ul>{data.coverage.slice(0, 5).map(c => <li key={c.leagueId}><Link href={`/core/my-team?league=${encodeURIComponent(c.leagueId)}`}>{c.leagueName}</Link>: {c.af ? 'AF' : ''}{c.af && c.provider ? ' + ' : ''}{c.provider ? es ? 'proveedor' : 'provider' : ''}{!c.af && !c.provider ? es ? 'pronóstico actual no disponible' : 'current forecast unavailable' : ''}{c.partial ? es ? ' · parcial' : ' · partial' : ''}</li>)}</ul>
    </section>}</div>
    <WeeklySharing data={data} path={path} />
  </section>
}
function LocalGameTime({ iso, language }: { iso: string; language: string }) {
  // Browser timezone only after hydration; server and first client render agree.
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { setText(new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))) }, [iso, language])
  return <time dateTime={iso}>{text ?? iso}</time>
}
function LocalCalculatedTime({ iso, language }: { iso: string; language: string }) {
  const [text,setText] = useState<string | null>(null)
  useEffect(() => {
    const date = new Date(iso)
    if (Number.isFinite(date.getTime())) setText(new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date))
  },[iso,language])
  return <time dateTime={iso}>{text ?? (language === 'es' ? 'Cargando hora local…' : 'Loading local time…')}</time>
}
export function PlayoffPath({ path }: { path: WeeklyPlayoffPath }) {
  const { language } = useOptionalLanguage(); const es = language === 'es'
  const league = path.league, you = league?.you
  const valid = you?.modelled && league?.season === path.season && league?.period === path.period && Number.isFinite(you.playoffPct) && you.playoffPct >= 0 && you.playoffPct <= 100
  const previous = path.points.filter(p => p.period < path.period).at(-1)
  const delta = valid && previous ? you!.playoffPct - previous.probability : null
  const swing = path.swing
  return <section className="af-wbp-path"><h3>{es ? 'Tu camino a los playoffs' : 'Your playoff path'}</h3>
    {valid ? <>
      <p><strong className="af-wbp-prob">{you!.playoffPct > 0 && you!.playoffPct < 1 ? '<1' : you!.playoffPct > 99 && you!.playoffPct < 100 ? '>99' : you!.playoffPct.toFixed(0)}%</strong> {es ? 'probabilidad estimada' : 'estimated probability'}</p>
      <p>{you!.status === 'clinched' ? es ? 'Clasificación asegurada según las reglas modeladas.' : 'Clinched under the modeled rules.' : you!.status === 'eliminated' ? es ? 'Eliminado según las reglas modeladas; aún puedes competir por objetivos semanales.' : 'Eliminated under the modeled rules; weekly goals still matter.' : you!.playoffPct < 5 ? es ? 'Pocas probabilidades; no es una eliminación matemática.' : 'Long shot; this is not mathematical elimination.' : you!.playoffPct >= 99 ? es ? 'Clasificación muy probable; aún no está asegurada matemáticamente.' : 'Likely in; not mathematically clinched.' : es ? 'El resultado sigue abierto.' : 'The outcome is still open.'}</p>
      {delta != null ? <p>{pct1(delta) >= 0 ? '+' : ''}{formatPct1(delta)} {es ? `puntos porcentuales frente al período ${previous!.period}` : `percentage points versus period ${previous!.period}`}.</p> : <p>{es ? 'La tendencia comienza con tu primer resumen guardado.' : 'Your trend starts with the first saved snapshot.'}</p>}
      {path.points.length > 1 ? <><svg viewBox="0 0 300 100" role="img" aria-label={es ? 'Tendencia de probabilidades; valores en la tabla' : 'Playoff probability trend; values in the table'}><polyline fill="none" stroke="currentColor" strokeWidth="3" points={path.points.map((p,i) => `${10 + i * 280 / (path.points.length - 1)},${90 - p.probability * .8}`).join(' ')} /></svg><details><summary>{es ? 'Datos de la tendencia' : 'Trend data'}</summary><table><thead><tr><th>{es ? 'Período' : 'Period'}</th><th>%</th></tr></thead><tbody>{path.points.map(p => <tr key={p.period}><td>{p.period}</td><td>{formatPct1(p.probability)}%</td></tr>)}</tbody></table></details></> : null}
      {swing && swing.week >= path.period ? <div className="af-wbp-branches"><h4>{es ? `Escenarios del período ${swing.week}` : `Period ${swing.week} scenarios`}</h4>{[{ title: es ? 'Si ganas' : 'If you win', value: swing.ifWin }, { title: es ? 'Si pierdes' : 'If you lose', value: swing.ifLose }].map(b => <div key={b.title}><span>{b.title}: {formatPct1(b.value)}%</span><span className="af-wbp-bar" aria-hidden><i style={{ width: `${Math.max(0, Math.min(100,b.value))}%` }} /></span></div>)}</div> : <p>{es ? 'No hay un escenario pendiente de victoria/derrota para este período.' : 'No pending win/loss scenario is available for this period.'}</p>}
      <details><summary>{es ? 'Cómo se calcula' : 'How this is calculated'}</summary><p>{es ? 'Simulación del calendario restante con el historial de puntuación. No es una garantía.' : 'Remaining-schedule simulation using scoring history. This is not a guarantee.'}</p><p>{league!.assumptions.iterations.toLocaleString()} {es ? 'simulaciones' : 'simulations'} · {es ? 'Último cálculo' : 'Last calculated'}: <LocalCalculatedTime iso={league!.assumptions.computedAt} language={language}/></p><ul>{league!.assumptions.missing.map(m => <li key={m}>{coreUiCopy(m, language)}</li>)}</ul></details>
    </> : <p>{es ? 'El modelo de playoffs no está disponible para este formato o estos datos. Revisa la clasificación y las reglas de tu liga.' : 'Playoff modeling is unavailable for this format or data. Review your league standings and rules.'}</p>}
    {path.historyUnavailable ? <p role="status">{es ? 'El historial de probabilidades no está disponible; el cálculo actual sigue visible.' : 'Probability history is unavailable; the current calculation remains visible.'}</p> : null}
    <Link href={`/core/season-outlook?league=${encodeURIComponent(path.leagueId ?? league?.leagueId ?? '')}`}>{es ? 'Ver los escenarios completos' : 'View full scenarios'} →</Link>
  </section>
}
