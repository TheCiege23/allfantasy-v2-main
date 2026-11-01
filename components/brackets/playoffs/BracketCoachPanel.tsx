"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import { qualificationScenarios, type BracketCoach, type CoachGame } from "@/lib/playoffs/bracketCoach"
import { nbaCupGroupStandings } from "@/lib/playoffs/nbaCupProgress"
import ChimmyMatchupAdvice from "./ChimmyMatchupAdvice"
import { roundLabel } from "@/lib/playoffs/playoffBracketGraph"
import "./bracket-coach.css"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { bracketCoachCopy } from "@/lib/brackets/bracketCoachCopy"

export function bracketGameCalendar(game: CoachGame, url: string): string | null {
  if (!game.startsAt || !Number.isFinite(Date.parse(game.startsAt))) return null
  const date = (time: number) => new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&")
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AllFantasy//Bracket reminders//EN", "BEGIN:VEVENT",
    `UID:${escape(game.id)}@allfantasy.ai`, `DTSTAMP:${date(Date.now())}`, `DTSTART:${date(Date.parse(game.startsAt))}`,
    `DTEND:${date(Date.parse(game.startsAt) + 3 * 3600000)}`, `SUMMARY:${escape(`${game.away} at ${game.home}`)}`,
    `DESCRIPTION:${escape("Review your bracket before tipoff. " + url)}`, "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", "DESCRIPTION:Review your bracket picks", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n")
}

export default function BracketCoachPanel({ view }: { view: PlayoffChallengeView }) {
  const { language } = useOptionalLanguage()
  const copy = bracketCoachCopy(language)
  const [coach, setCoach] = useState<BracketCoach | null>(null)
  const [rivalId, setRivalId] = useState("")
  const [tab, setTab] = useState("tonight")
  const [team, setTeam] = useState("")
  const [analysisGame, setAnalysisGame] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [showAllGames, setShowAllGames] = useState(false)
  const entryId = view.activeEntry?.id ?? ""
  useEffect(() => {
    setCoach(null); setError(null)
    if (!view.viewerUserId) return
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
        if (!response.ok) throw new Error(data.error ?? "Could not refresh bracket coach")
        if (![data.tonight, data.nextLocks, data.rivals, data.comparisons, data.rooting, data.recap?.games, data.recap?.rounds].every(Array.isArray)) throw new Error("Coach feed is delayed. Your picks are unchanged.")
        if (!stopped) { setCoach(data); setError(null) }
      } catch (error) { if (!stopped) setError(error instanceof Error ? error.message : "Coach feed delayed") }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    document.addEventListener("visibilitychange", refresh)
    return () => { stopped = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh) }
  }, [view.challenge.id, view.viewerUserId, entryId, rivalId])
  const groups = useMemo(() => view.challenge.sport === "nba_cup" ? nbaCupGroupStandings(view.series, view.challenge.seasonYear) : [], [view.challenge.sport, view.challenge.seasonYear, view.series])
  const selectedTeam = team || groups[0]?.teams[0]?.team || ""
  const scenarios = useMemo(() => qualificationScenarios(view.series, view.challenge.seasonYear, selectedTeam), [view.series, view.challenge.seasonYear, selectedTeam])
  const entryHref = entryId ? `/brackets/leagues/${view.challenge.id}/entries/${entryId}` : `/brackets/leagues/${view.challenge.id}`
  const fmt = (time: string | null) => time ? new Date(time).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "Time pending"
  function remind(game: CoachGame) {
    const text = bracketGameCalendar(game, `${window.location.origin}${entryHref}`)
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url; link.download = "allfantasy-game-reminder.ics"; link.click(); URL.revokeObjectURL(url)
    setMessage("Calendar reminder downloaded. Import it into your calendar to enable its alert.")
  }
  async function copyRecap() {
    if (!coach) return
    try { await navigator.clipboard.writeText(`${coach.entry?.name ?? "My bracket"}: ${coach.recap.pointsEarned} points from recent finals; ${coach.entry?.score ?? 0} total. ${window.location.origin}${entryHref}`); setMessage("Your recap was copied. No rival picks were included.") }
    catch { setMessage("Clipboard is unavailable. Your recap remains below.") }
  }
  const tabs = [{ id: "tonight", label: copy.tonight }, { id: "rooting", label: copy.rooting }, { id: "compare", label: copy.compare }, { id: "recap", label: copy.recap }, ...(groups.length ? [{ id: "paths", label: copy.paths }] : [])]
  return <section className="af-coach" aria-label="Your bracket coach">
    <header><div><p className="af-coach-eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2></div>
      {coach && <span className="af-coach-faint">Updated {new Date(coach.generatedAt).toLocaleTimeString()}</span>}</header>
    <nav aria-label="Bracket coach views">{tabs.map((item) => <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {!view.viewerUserId ? <p><Link href={`/login?callbackUrl=${encodeURIComponent(entryHref)}`}>{copy.signin}</Link> {copy.signinBody}</p> : <>
      {error && <p role="alert">{error}{coach ? " · Showing the last verified snapshot." : ""}</p>}
      {!coach && !error && <p role="status">Loading your bracket coach…</p>}
      {coach && <>
        {!coach.entry && <p>Create your first bracket from the pool dashboard to unlock personalized picks and recaps.</p>}
        {coach.entry && !coach.entry.finalized && <p className="af-coach-warning">{copy.draft}</p>}
        {tab === "tonight" && <>
          <p>{coach.missingPicks} upcoming matchups still need your pick. Games use your timezone: {coach.timeZone}.</p>
          <div className="af-coach-grid">{(showAllGames ? coach.tonight : coach.tonight.slice(0, 4)).map((game) => <article key={game.id}>
            <strong>{game.away} at {game.home}</strong><p>{game.status === "in_progress" ? `LIVE · ${game.awayScore ?? "—"} – ${game.homeScore ?? "—"}` : game.status === "final" ? `Final · ${game.awayScore ?? "—"} – ${game.homeScore ?? "—"}` : fmt(game.startsAt)}</p>
            <p>Your pick: {game.pick ?? "No pick"} · {game.points} {game.points === 1 ? "point" : "points"} available</p>
            <p>{game.locked ? "Locked" : "Open until tipoff"}{game.pick && !game.eligible ? " · not finalized for scoring" : ""}</p>
            {!game.locked && <Link href={`${entryHref}#playoff-series-${game.id}`}>{copy.review}</Link>}
            <button type="button" onClick={() => setAnalysisGame(game.id)}>{copy.matchup}</button>
          </article>)}</div>
          {coach.tonight.length > 4 && <button type="button" onClick={() => setShowAllGames(!showAllGames)}>{showAllGames ? copy.fewer : copy.fullSlate(coach.tonight.length)}</button>}
          {!coach.tonight.length && <p>No games scheduled for your bracket today.</p>}
          <h3>{copy.nextLocks}</h3><ul>{coach.nextLocks.map((game) => <li key={game.id}><span>{game.away} at {game.home} · {fmt(game.startsAt)}{!game.pick ? " · Pick needed" : ""}</span><button type="button" onClick={() => remind(game)}>{copy.calendar}</button></li>)}</ul>
        </>}
        {(tab === "rooting" || tab === "compare") && <>
          <label htmlFor={`coach-rival-${view.challenge.id}`}>Compare with a finalized bracket</label>
          <select id={`coach-rival-${view.challenge.id}`} value={rivalId || coach.rival?.id || ""} onChange={(event) => setRivalId(event.target.value)}>{!coach.rivals.length && <option value="">No finalized rivals yet</option>}{coach.rivals.map((rival) => <option key={rival.id} value={rival.id}>{rival.name} · {rival.totalScore} pts</option>)}</select>
          <p className="af-coach-faint">{copy.privacy}</p>
          {tab === "rooting" ? <div className="af-coach-grid">{coach.rooting.map((game) => <article key={game.id}><strong>Root for {game.rootFor}</strong><p>{game.away} at {game.home}</p><p>Point gap vs {coach.rival?.name}: {game.gapNow}. A {game.home} win makes it {game.gapIfHomeWins}; a {game.away} win makes it {game.gapIfAwayWins}.</p><p className="af-coach-faint">One-game scenario, with other results held fixed. Tiebreakers can still affect rank.</p></article>)}{!coach.rooting.length && <p>No unlocked information or live pick differences to use yet. Rooting scenarios appear when eligible differing picks lock.</p>}</div>
            : <div className="af-coach-table"><table><caption>Your revealed picks against {coach.rival?.name ?? "a rival"}</caption><thead><tr><th>Matchup</th><th>Your eligible pick</th><th>Rival eligible pick</th><th>Result</th></tr></thead><tbody>{coach.comparisons.map((game) => <tr key={game.id}><td>{game.away} at {game.home}</td><td>{game.myPick ?? "—"}</td><td>{game.theirPick ?? "—"}</td><td>{game.winner ?? "Pending"}</td></tr>)}</tbody></table>{!coach.comparisons.length && <p>No locked, finalized picks available to compare yet.</p>}</div>}
        </>}
        {tab === "recap" && <>
          <h3>Your recent results</h3><p>+{coach.recap.pointsEarned} earned · {coach.recap.pointsMissed} missed · {coach.entry?.score ?? 0} total points</p>
          <p className="af-coach-faint">Completed games that started in the past 24 hours. Draft or late-finalized picks earn no points.</p>
          <ul>{coach.recap.rounds.map((round) => <li key={round.round}>{roundLabel(view.challenge.sport, round.round)}: +{round.points}</li>)}</ul>
          <ul>{coach.recap.games.map((game) => <li key={game.id}><span>{game.away} at {game.home} · {game.winner ?? "Official result pending"} · Your pick: {game.pick ?? "none"} · +{game.earned}</span></li>)}</ul>
          {!coach.recap.games.length && <p>Your recap will appear after verified finals.</p>}
          <button type="button" onClick={() => void copyRecap()}>{copy.copy}</button>
        </>}
      </>}
    </>}
    {tab === "paths" && groups.length > 0 && <>
      <label htmlFor={`coach-team-${view.challenge.id}`}>Follow a team's qualification scenarios</label><select id={`coach-team-${view.challenge.id}`} value={selectedTeam} onChange={(event) => setTeam(event.target.value)}>{groups.flatMap((group) => group.teams.map((row) => <option value={row.team} key={row.team}>{row.team}</option>))}</select>
      <p>Explore up to 12 remaining group and conference wild-card matchups for {selectedTeam}, with your team's games first. Tied records await official tiebreakers; hypothetical games never assign scores or qualifiers.</p>
      <div className="af-coach-grid">{scenarios.map((game) => <article key={game.id}><strong>{game.away} at {game.home}</strong><p>If {game.home} wins: {selectedTeam} {game.ifHomeWins.wins}–{game.ifHomeWins.losses} · {game.ifHomeWins.status}</p><p>{game.ifHomeWins.road}</p><p>If {game.away} wins: {selectedTeam} {game.ifAwayWins.wins}–{game.ifAwayWins.losses} · {game.ifAwayWins.status}</p><p>{game.ifAwayWins.road}</p></article>)}</div>
      {!scenarios.length && <p>No remaining verified group matchups to simulate. Check confirmed knockout slots when published.</p>}
    </>}
    {analysisGame && <div className="af-coach-analysis"><button type="button" onClick={() => setAnalysisGame(null)}>{copy.close}</button><ChimmyMatchupAdvice key={analysisGame} challengeId={view.challenge.id} seriesId={analysisGame} canPick={false} onPick={() => {}} /></div>}
    {message && <p role="status">{message}</p>}
  </section>
}
