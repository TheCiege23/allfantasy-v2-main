'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { messagesFor } from '@/lib/i18n/messages'
import { weeklyBlueprintMessages } from '@/lib/core-app/messages/weeklyBlueprint'
import { COMMS_OPEN_EVENT, type CommsOpenDetail } from './comms/commsEvents'
import { weeklyBrief, weeklyActionText, weeklyActionReason, weeklyActionPrompt, type WeeklyBlueprint as Blueprint, type WeeklyAction } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'
import { formatPct1, pct1 } from '@/lib/core-app/weeklyPercent'
import '@/components/core-app/af-week-blueprint.css'
import { WeeklySharing } from './WeeklySharing'
import { WeeklyCalendar } from './WeeklyCalendar'
import { WeeklyScheduleForecasts } from './WeeklyScheduleForecasts'
import { buildWeeklySwings, sportWeekAdvice } from '@/lib/core-app/weeklySportPlan'
import { playoffInputChanges } from '@/lib/core-app/weeklyPlayoffMovement'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

/**
 * The weekly builders (weeklyBrief, buildWeeklySwings, playoffInputChanges, WeeklyScheduleForecasts …)
 * still take a Spanish flag rather than a language, and turn it back into a code for their own
 * catalogs. Bridged once here instead of widening every builder's signature.
 */
const SPANISH = 'es'
const spanishFlag = (language: string): boolean => language === SPANISH

export function WeeklyBlueprint({ data, path }: { data: Blueprint; path?: WeeklyPlayoffPath | null }) {
  const { language } = useOptionalLanguage(); const es = spanishFlag(language)
  const m = useMessages(weeklyBlueprintMessages)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const brief = weeklyBrief(data, es)
  const swings = buildWeeklySwings(data,es)
  const ask = () => {
    const detail: CommsOpenDetail = { tab: 'chimmy', prefill: `${brief}\n${m.askPrefill}`, ...(data.focusLeagueId ? { leagueId: data.focusLeagueId } : {}) }
    window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail }))
  }
  const askAction = (action: WeeklyAction) => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, {detail:{tab:'chimmy',leagueId:action.leagueId,prefill:swings.find(s=>s.id===action.id)?.prompt ?? weeklyActionPrompt(action,es)} satisfies CommsOpenDetail}))
  async function copyBrief() { try { await navigator.clipboard.writeText(brief); setCopyState('copied') } catch { setCopyState('manual') } }
  return <section className="af-wbp" aria-label={m.sectionLabel}>
    <header><p className="af-label">{m.kicker}</p>
      <h2>{data.name ? `${data.name}, ` : ''}{m.yourFantasyWeek}</h2>
      <p>{brief}</p>
      <div className="af-wbp-buttons"><button type="button" onClick={ask}>{m.askChimmy}</button><button type="button" onClick={copyBrief}>{m.copyMyBrief}</button></div>
      <span role="status">{copyState === 'copied' ? m.briefCopied : copyState === 'manual' ? m.selectToCopy : ''}</span>
      {copyState === 'manual' ? <textarea aria-label={m.briefToCopy} readOnly value={brief} onFocus={e => e.target.select()} /> : null}
    </header>
    <div className="af-wbp-grid"><section><h3>{m.nextPriorities}</h3>
      <p>{m.prioritiesBlurb}</p>
      {data.actions.length ? <ol className="af-wbp-actions">{data.actions.map(a => <li key={a.id} id={`weekly-issue-${a.id}`}>
        <span className="af-wbp-action-tag">{a.kind === 'monitor' ? m.tagMonitor : a.kind === 'sync' ? m.tagSync : a.kind === 'lineup' ? m.tagLineup : m.tagPlan}</span>
        <Link href={a.href}><strong>{weeklyActionText(a, es)}</strong><span>{a.leagueName}</span></Link>
        <p>{swings.find(s=>s.id===a.id)?.detail ?? weeklyActionReason(a,es)}</p>
        {a.gameAt ? <small>{a.kind === 'deadline' ? m.deadline : m.nextGame}<LocalGameTime iso={a.gameAt} language={language} />. {m.confirmLock}</small> : <small>{m.checkRules}</small>}
        <button type="button" onClick={()=>askAction(a)} aria-label={m.compareOptionsAria(a.leagueName)}>{m.compareWithChimmy}</button>
      </li>)}</ol> : <p>{m.connectLeague}</p>}
      {data.actionCount > 3 ? <p>{m.firstThree}</p> : null}
      {data.lineupReadFailed ? <p role="status">{m.lineupReadFailed}</p> : null}
      <Link href={data.focusLeagueId ? `/core/my-team?league=${encodeURIComponent(data.focusLeagueId)}` : '/core/my-team'}>{m.openMyTeam} →</Link>
    </section>{path ? <PlayoffPath path={path} /> : <section><h3>{m.lineupCoverage}</h3>
      <p>{m.coverageBlurb}</p>
      <ul>{data.coverage.slice(0, 5).map(c => <li key={c.leagueId}><Link href={`/core/my-team?league=${encodeURIComponent(c.leagueId)}`}>{c.leagueName}</Link>: {c.af ? 'AF' : ''}{c.af && c.provider ? ' + ' : ''}{c.provider ? m.provider : ''}{!c.af && !c.provider ? m.forecastUnavailable : ''}{c.partial ? m.partial : ''}</li>)}</ul>
    </section>}</div>
    {data.sportPlans?.length ? <details className="af-wbp-sports"><summary>{m.sportPlanSummary}</summary><p>{m.sportPlanBlurb}</p><ul>{[...new Set(data.sportPlans.map(s=>s.sport))].map(sport=><li key={sport}><strong>{sport}</strong><p>{sportWeekAdvice(sport,es)}</p><div>{data.sportPlans!.filter(s=>s.sport===sport).map(l=><Link key={l.leagueId} href={`/core/my-team?league=${encodeURIComponent(l.leagueId)}`}>{l.leagueName} → </Link>)}</div></li>)}</ul></details> : null}
    <WeeklyScheduleForecasts forecasts={data.scheduleForecasts} es={es}/>
    <WeeklyCalendar data={data.calendar} />
    <WeeklySharing data={data} path={path} />
  </section>
}
function LocalGameTime({ iso, language }: { iso: string; language: string }) {
  // Browser timezone only after hydration; server and first client render agree.
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { setText(new Intl.DateTimeFormat(messagesFor(weeklyBlueprintMessages, language).timeLocale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))) }, [iso, language])
  return <time dateTime={iso}>{text ?? iso}</time>
}
function LocalCalculatedTime({ iso, language }: { iso: string; language: string }) {
  const m = useMessages(weeklyBlueprintMessages)
  const [text,setText] = useState<string | null>(null)
  useEffect(() => {
    const date = new Date(iso)
    if (Number.isFinite(date.getTime())) setText(new Intl.DateTimeFormat(messagesFor(weeklyBlueprintMessages, language).timeLocale, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date))
  },[iso,language])
  return <time dateTime={iso}>{text ?? m.loadingLocalTime}</time>
}
export function PlayoffPath({ path }: { path: WeeklyPlayoffPath }) {
  const { language } = useOptionalLanguage(); const es = spanishFlag(language)
  const m = useMessages(weeklyBlueprintMessages)
  const league = path.league, you = league?.you
  const valid = you?.modelled && league?.season === path.season && league?.period === path.period && Number.isFinite(you.playoffPct) && you.playoffPct >= 0 && you.playoffPct <= 100
  const previous = path.points.filter(p => p.period < path.period).at(-1)
  const delta = valid && previous ? you!.playoffPct - previous.probability : null
  const swing = path.swing
  const inputChanges = playoffInputChanges(previous,path.points.find(p=>p.period===path.period),es)
  return <section className="af-wbp-path"><h3>{m.playoffPath}</h3>
    {valid ? <>
      <p><strong className="af-wbp-prob">{you!.playoffPct > 0 && you!.playoffPct < 1 ? '<1' : you!.playoffPct > 99 && you!.playoffPct < 100 ? '>99' : you!.playoffPct.toFixed(0)}%</strong> {m.estimatedProbability}</p>
      <p>{you!.status === 'clinched' ? m.statusClinched : you!.status === 'eliminated' ? m.statusEliminated : you!.playoffPct < 5 ? m.statusLongShot : you!.playoffPct >= 99 ? m.statusLikely : m.statusOpen}</p>
      {delta != null ? <p>{pct1(delta) >= 0 ? '+' : ''}{formatPct1(delta)} {m.pointsVersusPeriod(previous!.period)}.</p> : <p>{m.trendStarts}</p>}
      {inputChanges.length ? <details><summary>{m.inputsChanged}</summary><ul>{inputChanges.map(change=><li key={change}>{change}</li>)}</ul></details> : previous ? <p>{m.noInputChanges}</p> : null}
      {path.points.length > 1 ? <><svg viewBox="0 0 300 100" role="img" aria-label={m.trendAria}><polyline fill="none" stroke="currentColor" strokeWidth="3" points={path.points.map((p,i) => `${10 + i * 280 / (path.points.length - 1)},${90 - p.probability * .8}`).join(' ')} /></svg><details><summary>{m.trendData}</summary><table><thead><tr><th>{m.period}</th><th>%</th></tr></thead><tbody>{path.points.map(p => <tr key={p.period}><td>{p.period}</td><td>{formatPct1(p.probability)}%</td></tr>)}</tbody></table></details></> : null}
      {swing && swing.week >= path.period ? <div className="af-wbp-branches"><h4>{m.scenariosTitle(swing.week)}</h4>{[{ title: m.ifWin, value: swing.ifWin }, { title: m.ifLose, value: swing.ifLose }].map(b => <div key={b.title}><span>{b.title}: {formatPct1(b.value)}%</span><span className="af-wbp-bar" aria-hidden><i style={{ width: `${Math.max(0, Math.min(100,b.value))}%` }} /></span></div>)}</div> : <p>{m.noScenario}</p>}
      {league!.whatDecidesIt ? <p>{coreUiCopy(league!.whatDecidesIt,language)}</p> : null}
      {delta != null ? <p>{m.movementNote}</p> : null}
      {swing?.week === path.period && swing.helpIfLose?.length ? <p>{m.helpIfLose}{swing.helpIfLose.join(', ')}. {m.conditionalEvidence}</p> : null}
      <details><summary>{m.howCalculated}</summary><p>{m.howCalculatedBody}</p><p>{league!.assumptions.iterations.toLocaleString(getAppIntlLocale())} {m.simulations} · {m.lastCalculated}: <LocalCalculatedTime iso={league!.assumptions.computedAt} language={language}/></p><ul>{league!.assumptions.missing.map(m => <li key={m}>{coreUiCopy(m, language)}</li>)}</ul></details>
    </> : <p>{m.modelUnavailable}</p>}
    {path.historyUnavailable ? <p role="status">{m.historyUnavailable}</p> : null}
    <Link href={`/core/season-outlook?league=${encodeURIComponent(path.leagueId ?? league?.leagueId ?? '')}`}>{m.viewFullScenarios} →</Link>
  </section>
}
