"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import { buildBracketCoach, qualificationScenarios, type BracketCoach, type CoachGame } from "@/lib/playoffs/bracketCoach"
import { nbaCupGroupStandings } from "@/lib/playoffs/nbaCupProgress"
import ChimmyMatchupAdvice from "./ChimmyMatchupAdvice"
import "./bracket-coach.css"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import BracketExperiencePanel, { BracketEntryChecklist } from "./BracketExperiencePanel"
import { bracketCompanionCopy, bracketCompanionLocale } from "@/lib/brackets/bracketCompanionCopy"
import { bracketCoachCopy } from "@/lib/brackets/bracketCoachCopy"

export function bracketGameCalendar(game: CoachGame, url: string, language = "en"): string | null {
  const c = bracketCompanionCopy(language)
  if (!game.startsAt || !Number.isFinite(Date.parse(game.startsAt))) return null
  const date = (time: number) => new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&")
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AllFantasy//Bracket reminders//EN", "BEGIN:VEVENT",
    `UID:${escape(game.id)}@allfantasy.ai`, `DTSTAMP:${date(Date.now())}`, `DTSTART:${date(Date.parse(game.startsAt))}`,
    `DTEND:${date(Date.parse(game.startsAt) + 3 * 3600000)}`, `SUMMARY:${escape(`${game.away} at ${game.home}`)}`,
    `DESCRIPTION:${escape(c.calendarBody + " " + url)}`, "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", `DESCRIPTION:${escape(c.calendarAlarm)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n")
}

export default function BracketCoachPanel({ view }: { view: PlayoffChallengeView }) {
  const { language } = useOptionalLanguage()
  const copy = bracketCoachCopy(language), c = bracketCompanionCopy(language), locale = bracketCompanionLocale(language)
  const [coach, setCoach] = useState<BracketCoach | null>(null)
  const [rivalId, setRivalId] = useState("")
  const [tab, setTab] = useState("tonight")
  const [team, setTeam] = useState("")
  const [analysisGame, setAnalysisGame] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [showAllGames, setShowAllGames] = useState(false)
  const entryId = view.activeEntry?.id ?? ""
  // Sandbox brackets are locally projected fixtures. Do not poll the live/private feed for them.
  const testCoach = useMemo(() => view.challenge.isTestMode ? buildBracketCoach(view,null,Date.now(),Intl.DateTimeFormat().resolvedOptions().timeZone) : null, [view])
  useEffect(() => {
    setCoach(null); setError(null)
    if (!view.viewerUserId) return
    if (testCoach) { setCoach(testCoach); return }
    let stopped = false, pending = false
    const controller = new AbortController()
    const refresh = async () => {
      if (stopped || pending || document.visibilityState === "hidden") return
      pending = true
      try {
        const query = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
        if (entryId) query.set("entryId", entryId)
        if (rivalId) query.set("rivalId", rivalId)
        const response = await fetch(`/api/brackets/playoffs/${encodeURIComponent(view.challenge.id)}/coach?${query}`, { cache: "no-store", signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? c.refreshError)
        if (![data.tonight, data.nextLocks, data.rivals, data.comparisons, data.rooting, data.recap?.games, data.recap?.rounds].every(Array.isArray)) throw new Error(c.delayed)
        if (!stopped) { setCoach(data); setError(null) }
      } catch (error) { if (!stopped) setError(c.delayed) }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    document.addEventListener("visibilitychange", refresh)
    return () => { stopped = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [view.challenge.id, view.viewerUserId, entryId, rivalId, language, testCoach])
  const groups = useMemo(() => view.challenge.sport === "nba_cup" ? nbaCupGroupStandings(view.series, view.challenge.seasonYear) : [], [view.challenge.sport, view.challenge.seasonYear, view.series])
  const selectedTeam = team || groups[0]?.teams[0]?.team || ""
  const scenarios = useMemo(() => qualificationScenarios(view.series, view.challenge.seasonYear, selectedTeam, language), [view.series, view.challenge.seasonYear, selectedTeam, language])
  const entryHref = entryId ? `/brackets/leagues/${view.challenge.id}/entries/${entryId}` : `/brackets/leagues/${view.challenge.id}`
  const fmt = (time: string | null) => time ? new Date(time).toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : c.timePending
  function remind(game: CoachGame) {
    const text = bracketGameCalendar(game, `${window.location.origin}${entryHref}`, language)
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url; link.download = "allfantasy-game-reminder.ics"; link.click(); URL.revokeObjectURL(url)
    setMessage(c.calendarDone)
  }
  async function copyRecap() {
    if (!coach) return
    try { await navigator.clipboard.writeText(`${c.recapText(coach.entry?.name ?? c.myBracket, coach.recap.pointsEarned, coach.entry?.score ?? 0)} ${window.location.origin}${entryHref}`); setMessage(c.recapCopied) }
    catch { setMessage(c.clipboardFailed) }
  }
  const tabs = [{ id: "tonight", label: copy.tonight }, { id: "rooting", label: copy.rooting }, { id: "compare", label: copy.compare }, { id: "recap", label: copy.recap }, ...(groups.length ? [{ id: "paths", label: copy.paths }] : []), ...(coach?.experience ? [{ id: "ledger", label: c.ledger },{ id: "standings", label: c.standings },...(coach.experience.scheduledTracking === false ? [] : [{ id: "alerts", label: c.alerts }])] : [])]
  return <section className="af-coach" aria-label={c.companion}>
    <header><div><p className="af-coach-eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2></div>
      {coach && <span className="af-coach-faint">{c.updated} {new Date(coach.generatedAt).toLocaleTimeString(locale)}</span>}</header>
    {view.challenge.isTestMode && <p className="af-coach-faint">{c.testMode}</p>}
    {coach?.experience && <BracketEntryChecklist experience={coach.experience} challengeId={view.challenge.id} entryId={entryId} />}
    <nav aria-label={c.views}>{tabs.map((item) => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {!view.viewerUserId ? <p><Link href={`/login?callbackUrl=${encodeURIComponent(entryHref)}`}>{copy.signin}</Link> {copy.signinBody}</p> : <>
      {error && <p role="alert">{error}{coach ? ` · ${c.lastSnapshot}` : ""}</p>}
      {!coach && !error && <p role="status">{c.loading}</p>}
      {coach && <>
        {!coach.entry && <p>{c.firstEntry}</p>}
        {coach.entry && !coach.entry.finalized && <p className="af-coach-warning">{copy.draft}</p>}
        {tab === "tonight" && <>
          <p>{c.upcoming(coach.missingPicks,coach.timeZone)}</p>
          <div className="af-coach-grid">{(showAllGames ? coach.tonight : coach.tonight.slice(0, 4)).map((game) => <article key={game.id}>
            <strong>{c.at(game.away,game.home)}</strong><p>{game.status === "in_progress" ? `${c.live} · ${game.awayScore ?? "—"} – ${game.homeScore ?? "—"}` : game.status === "final" ? `${c.final} · ${game.awayScore ?? "—"} – ${game.homeScore ?? "—"}` : fmt(game.startsAt)}</p>
            <p>{c.myPick(game.pick ?? c.noPick,game.points)}</p>
            <p>{game.locked ? c.locked : c.open}{game.pick && !game.eligible ? ` · ${c.notFinalized}` : ""}</p>
            {!game.locked && <Link href={`${entryHref}#playoff-series-${game.id}`}>{copy.review}</Link>}
            <button type="button" onClick={() => setAnalysisGame(game.id)}>{copy.matchup}</button>
          </article>)}</div>
          {coach.tonight.length > 4 && <button type="button" onClick={() => setShowAllGames(!showAllGames)}>{showAllGames ? copy.fewer : copy.fullSlate(coach.tonight.length)}</button>}
          {!coach.tonight.length && <p>{c.noGames}</p>}
          <h3>{copy.nextLocks}</h3><ul>{coach.nextLocks.map((game) => <li key={game.id}><span>{c.at(game.away,game.home)} · {fmt(game.startsAt)}{!game.pick ? ` · ${c.needed}` : ""}</span><button type="button" onClick={() => remind(game)}>{copy.calendar}</button></li>)}</ul>
        </>}
        {(tab === "rooting" || tab === "compare") && <>
          <label htmlFor={`coach-rival-${view.challenge.id}`}>{c.compare}</label>
          <select id={`coach-rival-${view.challenge.id}`} value={rivalId || coach.rival?.id || ""} onChange={(event) => setRivalId(event.target.value)}>{!coach.rivals.length && <option value="">{c.noRivals}</option>}{coach.rivals.map((rival) => <option key={rival.id} value={rival.id}>{rival.name} · {rival.totalScore} {c.pts}</option>)}</select>
          <p className="af-coach-faint">{copy.privacy}</p>
          {tab === "rooting" ? <div className="af-coach-grid">{coach.rooting.map((game) => <article key={game.id}><strong>{c.root(game.rootFor)}</strong><p>{c.at(game.away,game.home)}</p><p>{c.gap(coach.rival?.name ?? c.rival,game.gapNow,game.home,game.gapIfHomeWins,game.away,game.gapIfAwayWins)}</p><p className="af-coach-faint">{c.scenarioHelp}</p></article>)}{!coach.rooting.length && <p>{c.noRoot}</p>}</div>
            : <div className="af-coach-table"><table><caption>{c.revealed(coach.rival?.name ?? c.rival)}</caption><thead><tr><th>{c.match}</th><th>{c.myEligible}</th><th>{c.theirEligible}</th><th>{c.result}</th></tr></thead><tbody>{coach.comparisons.map((game) => <tr key={game.id}><td>{c.at(game.away,game.home)}</td><td>{game.myPick ?? "—"}</td><td>{game.theirPick ?? "—"}</td><td>{game.winner ?? c.pending}</td></tr>)}</tbody></table>{!coach.comparisons.length && <p>{c.noComparison}</p>}</div>}
        </>}
        {tab === "recap" && <>
          <h3>{c.recent}</h3><p>{c.recapSummary(coach.recap.pointsEarned,coach.recap.pointsMissed,coach.entry?.score ?? 0)}</p>
          <p className="af-coach-faint">{c.recapHelp}</p>
          <ul>{coach.recap.rounds.map((round) => <li key={round.round}>{c.rounds[round.round]}: +{round.points}</li>)}</ul>
          <ul>{coach.recap.games.map((game) => <li key={game.id}><span>{c.at(game.away,game.home)} · {game.winner ?? c.officialPending} · {c.selected}: {game.pick ?? c.none} · +{game.earned}</span></li>)}</ul>
          {!coach.recap.games.length && <p>{c.noRecap}</p>}
          <button type="button" onClick={() => void copyRecap()}>{copy.copy}</button>
        </>}
      </>}
    </>}
    {tab === "paths" && groups.length > 0 && <>
      <label htmlFor={`coach-team-${view.challenge.id}`}>{c.followTeam}</label><select id={`coach-team-${view.challenge.id}`} value={selectedTeam} onChange={(event) => setTeam(event.target.value)}>{groups.flatMap((group) => group.teams.map((row) => <option value={row.team} key={row.team}>{row.team}</option>))}</select>
      <p>{c.pathsHelp(selectedTeam)}</p>
      <div className="af-coach-grid">{scenarios.map((game) => <article key={game.id}><strong>{c.at(game.away,game.home)}</strong><p>{c.ifWins(game.home)}: {selectedTeam} {game.ifHomeWins.wins}–{game.ifHomeWins.losses} · {c.statuses[game.ifHomeWins.status]}</p><p>{game.ifHomeWins.road}</p><p>{c.ifWins(game.away)}: {selectedTeam} {game.ifAwayWins.wins}–{game.ifAwayWins.losses} · {c.statuses[game.ifAwayWins.status]}</p><p>{game.ifAwayWins.road}</p></article>)}</div>
      {!scenarios.length && <p>{c.noPaths}</p>}
    </>}
    {coach?.experience && ["ledger","standings","alerts"].includes(tab) && <BracketExperiencePanel activeTab={tab} hideChecklist key={`${view.challenge.id}:${entryId}`} experience={coach.experience} challengeId={view.challenge.id} entryId={entryId} />}
    {analysisGame && <div className="af-coach-analysis"><button type="button" onClick={() => setAnalysisGame(null)}>{copy.close}</button><ChimmyMatchupAdvice key={analysisGame} challengeId={view.challenge.id} seriesId={analysisGame} canPick={false} onPick={() => {}} /></div>}
    {message && <p role="status">{message}</p>}
  </section>
}
