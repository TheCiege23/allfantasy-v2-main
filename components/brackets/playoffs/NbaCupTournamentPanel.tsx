"use client"

import { useEffect, useMemo, useState } from "react"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { cupGameDetails, cupTeamName, nbaCupGroupStandings, type CupScorer } from "@/lib/playoffs/nbaCupProgress"

export const cupScorerText = (leaders: CupScorer[] | undefined) => leaders?.length
  ? leaders.map((leader) => `${leader.name} · ${leader.points} pts`).join(" / ") : "Scorer data pending"

export function NbaCupGameSummary({ game, records = {} }: { game: PlayoffSeriesView; records?: Record<string, string> }) {
  const details = cupGameDetails(game)
  const active = game.status === "in_progress", final = game.status === "final"
  return <article className="rounded-2xl border border-white/15 bg-slate-900 p-4 text-white" aria-label={`${game.homeTeamName} versus ${game.awayTeamName} ${final ? "final" : "live"} score`}>
    <p className={`text-xs font-black uppercase tracking-wide ${active ? "text-emerald-300" : "text-slate-300"}`}>
      {final ? "Final" : active ? `Live · ${game.liveStatus || details.clock || "In progress"}` : "Scheduled"}
    </p>
    {[{ name: game.homeTeamName, score: game.liveHomeScore, leaders: details.homeLeaders }, { name: game.awayTeamName, score: game.liveAwayScore, leaders: details.awayLeaders }].map((team) => <div key={team.name} className="mt-3">
      <div className="flex items-center justify-between gap-3 font-bold"><span className="min-w-0 break-words">{team.name}</span><strong className="text-2xl tabular-nums">{team.score ?? "—"}</strong></div>
      <p className="text-xs text-teal-200">Cup group record: {records[cupTeamName(team.name)] ?? "Pending"}</p>
      {(final || active) && <p className="mt-1 text-xs text-slate-300">{final ? "Top scorer" : "Scoring leader"}: {cupScorerText(team.leaders)}</p>}
    </div>)}
  </article>
}

export default function NbaCupTournamentPanel({ series, season, syncedAt, showGames = true }: {
  series: PlayoffSeriesView[]; season: number; syncedAt?: string | null; showGames?: boolean
}) {
  const groups = useMemo(() => nbaCupGroupStandings(series, season), [series, season])
  const teams = groups.flatMap((group) => group.teams.map((team) => ({ ...team, group: group.name })))
  const [selected, setSelected] = useState("")
  const [allFinals, setAllFinals] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer) }, [])
  const team = teams.find((row) => row.team === selected) ?? teams[0]
  const records = Object.fromEntries(teams.map((row) => [row.team, `${row.wins}–${row.losses}`]))
  const live = series.filter((game) => game.status === "in_progress")
  const finals = series.filter((game) => game.status === "final").sort((a, b) => Date.parse(b.startsAt ?? "") - Date.parse(a.startsAt ?? ""))
  const syncTime = syncedAt ? Date.parse(syncedAt) : NaN
  const stale = live.length > 0 && (!Number.isFinite(syncTime) || now - syncTime > 120_000)
  return <section className="rounded-3xl border border-teal-300/25 bg-slate-950 p-4 text-white sm:p-6" aria-label="NBA Cup live scores and qualification">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-black">NBA Cup · live games &amp; road to the bracket</h2>
        <p className="mt-2 text-sm text-slate-300">Game scores refresh automatically. Pick points are awarded after the official final.</p></div>
      <p className={`max-w-xs text-xs ${stale ? "text-amber-200" : "text-teal-200"}`} role="status">
        {stale ? "Live feed delayed — showing last verified scores. " : ""}
        {Number.isFinite(syncTime) ? `Last verified sync: ${new Date(syncTime).toLocaleTimeString()}` : "Waiting for the first verified update."}
      </p>
    </div>
    {showGames && <div className="mt-5">
      <h3 className="font-bold">Games in progress</h3>
      {live.length ? <div className="mt-3 grid gap-3 md:grid-cols-2">{live.map((game) => <NbaCupGameSummary key={game.id} game={game} records={records} />)}</div>
        : <p className="mt-2 text-sm text-slate-400">No NBA Cup games are in progress right now.</p>}
      <h3 className="mt-5 font-bold">Final scores &amp; team scoring leaders</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{(allFinals ? finals : finals.slice(0, 4)).map((game) => <NbaCupGameSummary key={game.id} game={game} records={records} />)}</div>
      {!finals.length && <p className="mt-2 text-sm text-slate-400">Completed Cup games will appear here with each team&apos;s leading scorer.</p>}
      {finals.length > 4 && <button type="button" className="mt-3 rounded-lg border border-white/25 px-3 py-2 text-sm" onClick={() => setAllFinals(!allFinals)}>{allFinals ? "Show recent finals" : `Show all ${finals.length} finals`}</button>}
    </div>}
    <div className="mt-6 rounded-2xl border border-teal-300/25 bg-teal-400/5 p-4">
      <h3 className="text-lg font-black">Road to the knockout bracket</h3>
      <p className="mt-2 text-sm text-slate-300">Win a group, or finish second and earn your conference&apos;s wild card. Then win three knockout games to become champion.</p>
      {team ? <>
        <label className="mt-4 block text-xs font-bold" htmlFor={`cup-road-${showGames ? "pool" : "bracket"}`}>Follow a team&apos;s qualification path</label>
        <select id={`cup-road-${showGames ? "pool" : "bracket"}`} className="mt-2 w-full rounded-xl border border-white/25 bg-slate-900 p-3 text-sm sm:max-w-md" value={team.team} onChange={(event) => setSelected(event.target.value)}>
          {teams.map((row) => <option key={row.team} value={row.team}>{row.team}</option>)}
        </select>
        <p className="mt-4 font-bold text-teal-200">{team.group} · {team.wins}–{team.losses} · {team.status}</p>
        <p className="mt-2 text-sm leading-relaxed">{team.road}</p>
      </> : <p className="mt-3 text-sm">This season&apos;s group draw has not been verified yet.</p>}
      <p className="mt-3 text-xs leading-relaxed text-slate-400">Paths follow completed Cup results. Tied records await NBA tiebreakers; qualification is confirmed after final results. Quarterfinal opponents appear when confirmed.</p>
      <a className="mt-2 inline-block text-xs font-semibold text-teal-200 underline" href="https://www.nba.com/news/nba-cup-101" target="_blank" rel="noreferrer">Official NBA Cup qualification rules</a>
    </div>
    <details className="mt-5">
      <summary className="cursor-pointer text-sm font-bold">Cup group records &amp; qualification positions</summary>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">{groups.map((group) => <section key={group.name} className="min-w-0 rounded-xl border border-white/15 p-3" aria-label={group.name}>
        <h4 className="font-black">{group.name}</h4>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="py-2">Pos</th><th>Team</th><th>W–L</th><th>Left</th><th>Diff</th></tr></thead>
          <tbody>{group.teams.map((row) => <tr key={row.team} className="border-t border-white/10"><td className="py-3 pr-2">{row.tied ? "T" : ""}{row.rank}</td><td className="pr-2"><button type="button" onClick={() => setSelected(row.team)} className="text-left font-semibold text-teal-100 underline">{row.team}</button><span className="mt-1 block text-[11px] text-slate-400">{row.status}</span></td><td className="whitespace-nowrap pr-3">{row.wins}–{row.losses}</td><td>{row.remaining}</td><td>{row.differential == null ? "—" : row.differential > 0 ? `+${row.differential}` : row.differential}</td></tr>)}</tbody>
        </table></div>
      </section>)}</div>
      <p className="mt-3 text-xs text-slate-400">Group-game records only. Equal win totals share a displayed position until official tiebreakers resolve. Overtime games contribute zero to Cup point differential; unavailable period data stays pending.</p>
    </details>
  </section>
}
