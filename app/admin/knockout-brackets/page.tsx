"use client"

import { useState } from "react"
import Link from "next/link"

export default function KnockoutBracketAdminPage() {
  const [season, setSeason] = useState(new Date().getUTCFullYear())
  const [east, setEast] = useState<string[]>(["", "", "", ""])
  const [west, setWest] = useState<string[]>(["", "", "", ""])
  const [scheduleSport, setScheduleSport] = useState<"ncaaf" | "nba_cup">("nba_cup")
  const [scheduleGames, setScheduleGames] = useState<Array<{ startsAt: string; label: string; venue: string; location: string }>>(Array.from({ length: 7 }, () => ({ startsAt: "", label: "", venue: "", location: "" })))
  const [scheduleMessage, setScheduleMessage] = useState("")
  const [eventIds, setEventIds] = useState<string[]>(Array.from({ length: 7 }, () => ""))
  const [eventMessage, setEventMessage] = useState("")
  const [seriesNumber, setSeriesNumber] = useState(1)
  const [homeScore, setHomeScore] = useState("")
  const [awayScore, setAwayScore] = useState("")
  const [fieldMessage, setFieldMessage] = useState("")
  const [resultMessage, setResultMessage] = useState("")
  const [busy, setBusy] = useState(false)

  async function loadField() {
    setFieldMessage("")
    const res = await fetch(`/api/admin/brackets/nba-cup-field?season=${season}`, { cache: "no-store" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setFieldMessage(String(data.error ?? "Could not load Cup field."))
    if (data.field) {
      setEast(data.field.east)
      setWest(data.field.west)
      setFieldMessage("Saved field loaded.")
    } else setFieldMessage("No field published for this season.")
  }

  async function saveField() {
    setBusy(true)
    setFieldMessage("")
    try {
      const res = await fetch("/api/admin/brackets/nba-cup-field", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ season, east, west }),
      })
      const data = await res.json().catch(() => ({}))
      setFieldMessage(res.ok
        ? `Published field and seeded ${data.sweep?.challengesSeeded ?? 0} pools.`
        : String(data.errors?.join(" ") ?? data.error ?? "Could not save field."))
    } finally { setBusy(false) }
  }

  async function loadSchedule() {
    setScheduleMessage("")
    const res = await fetch(`/api/admin/brackets/single-game-schedule?sport=${scheduleSport}&season=${season}`, { cache: "no-store" })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setScheduleMessage(String(data.error ?? "Could not load schedule."))
    if (data.schedule) {
      setScheduleGames(data.schedule.games.map((game: { startsAt: string; label?: string; venue?: string; location?: string }) => ({ startsAt: game.startsAt, label: game.label ?? "", venue: game.venue ?? "", location: game.location ?? "" })))
      const eventRes = await fetch(`/api/admin/brackets/event-mapping?sport=${scheduleSport}&season=${season}`, { cache: "no-store" })
      const eventData = await eventRes.json().catch(() => ({}))
      const mapped = new Map<number, string>((eventData.mapping?.games ?? []).map((game: { seriesNumber: number; eventId: string }) => [game.seriesNumber, game.eventId]))
      setEventIds(data.schedule.games.map((game: { seriesNumber: number }) => mapped.get(game.seriesNumber) ?? ""))
      setScheduleMessage("Saved schedule loaded.")
    } else setScheduleMessage("No schedule published for this season.")
  }

  async function saveSchedule() {
    setBusy(true)
    setScheduleMessage("")
    try {
      const res = await fetch("/api/admin/brackets/single-game-schedule", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sport: scheduleSport, season,
          games: scheduleGames.map((game, index) => ({ seriesNumber: index + 1, ...game })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      setScheduleMessage(res.ok
        ? `Published start times for ${data.pools ?? 0} pools.`
        : String(data.errors?.join(" ") ?? data.error ?? "Could not save schedule."))
    } finally { setBusy(false) }
  }

  async function saveEventIds() {
    setBusy(true)
    setEventMessage("")
    try {
      const res = await fetch("/api/admin/brackets/event-mapping", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sport: scheduleSport, season,
          games: eventIds.map((eventId, index) => ({ seriesNumber: index + 1, eventId: eventId.trim() })).filter((game) => game.eventId),
        }),
      })
      const data = await res.json().catch(() => ({}))
      setEventMessage(res.ok
        ? `Saved ${data.mapping?.games?.length ?? 0} ESPN event IDs. Unmapped games remain manual.`
        : String(data.errors?.join(" ") ?? data.error ?? "Could not save event IDs."))
    } finally { setBusy(false) }
  }

  async function saveResult() {
    setBusy(true)
    setResultMessage("")
    try {
      const res = await fetch("/api/admin/brackets/season-result", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sport: scheduleSport, season, seriesNumber, homeScore, awayScore }),
      })
      const data = await res.json().catch(() => ({}))
      setResultMessage(res.ok
        ? `Published game ${seriesNumber} to ${data.updatedPools ?? 0} leagues: ${data.winner} won.`
        : String(data.error ?? "Could not save result."))
    } finally { setBusy(false) }
  }

  const inputClass = "w-full rounded-xl border border-white/20 bg-slate-950 px-3 py-2 text-white"
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-teal-300">AllFantasy admin</p>
          <h1 className="mt-2 text-3xl font-bold">Single-game brackets</h1>
          <p className="mt-2 text-slate-300">Publish the NBA Cup knockout field and enter final scores for NBA Cup or CFP pools. Every write is admin gated and audited.</p>
          <Link className="mt-3 inline-block text-teal-300 underline" href="/admin/cfp-seeding">Manage CFP seeds</Link>
        </header>
        <section className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <h2 className="text-xl font-bold">NBA Cup knockout field</h2>
          <p className="mt-1 text-sm text-slate-300">Enter each conference's four qualified teams in official seed order. Publish after group play is final.</p>
          <label className="mt-4 block text-sm" htmlFor="season">Tournament season</label>
          <input id="season" className={inputClass} type="number" min={2024} max={2100} value={season} onChange={(e) => setSeason(Number(e.target.value))} />
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            {(["east", "west"] as const).map((side) => {
              const values = side === "east" ? east : west
              const setter = side === "east" ? setEast : setWest
              return <fieldset key={side}><legend className="mb-2 font-bold capitalize">{side}</legend>
                {values.map((value, index) => <label key={index} className="mb-2 block text-sm">Seed {index + 1}
                  <input className={inputClass} value={value} maxLength={60} onChange={(e) => setter(values.map((item, i) => i === index ? e.target.value : item))} />
                </label>)}
              </fieldset>
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="rounded-xl border border-white/25 px-4 py-2" onClick={loadField} disabled={busy}>Load saved field</button>
            <button className="rounded-xl bg-teal-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-50" onClick={saveField} disabled={busy}>Publish field</button>
          </div>
          {fieldMessage && <p role="status" className="mt-3 text-sm text-teal-200">{fieldMessage}</p>}
        </section>
        <section className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <h2 className="text-xl font-bold">Game schedule and pick locks</h2>
          <p className="mt-1 text-sm text-slate-300">Publish every start time before picks open. Enter timezone-qualified times, each bowl or game name, venue, and location. All three details are required for each game so player matchup views stay complete.</p>
          <label className="mt-4 block text-sm">Tournament
            <select className={inputClass} value={scheduleSport} onChange={(e) => {
              const next = e.target.value as "ncaaf" | "nba_cup"
              setScheduleSport(next)
              setScheduleGames(Array.from({ length: next === "ncaaf" ? 11 : 7 }, () => ({ startsAt: "", label: "", venue: "", location: "" })))
              setEventIds(Array.from({ length: next === "ncaaf" ? 11 : 7 }, () => ""))
              setEventMessage("")
            }}>
              <option value="nba_cup">NBA Cup</option>
              <option value="ncaaf">College Football Playoff</option>
            </select>
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {scheduleGames.map((game, index) => <div className="rounded-xl border border-white/10 p-3" key={index}>
              <p className="mb-2 text-sm font-bold">Game {index + 1}</p>
              {(["startsAt", "label", "venue", "location"] as const).map((field) =>
                <label className="mb-2 block text-xs" key={field}>
                  {field === "startsAt" ? "Start time (ISO with timezone)" : field === "label" ? "Bowl or game name" : field === "venue" ? "Venue name" : "City and state"}
                  <input className={inputClass} value={game[field]}
                    placeholder={field === "startsAt" ? "2026-12-04T19:00:00-05:00" : field === "label" && scheduleSport === "ncaaf" ? "Rose Bowl" : ""}
                    onChange={(e) => setScheduleGames(scheduleGames.map((item, i) => i === index ? { ...item, [field]: e.target.value } : item))} />
                </label>)}
            </div>)}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="rounded-xl border border-white/25 px-4 py-2" onClick={loadSchedule} disabled={busy}>Load saved schedule</button>
            <button className="rounded-xl bg-teal-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-50" onClick={saveSchedule} disabled={busy}>Publish schedule</button>
          </div>
          {scheduleMessage && <p role="status" className="mt-3 text-sm text-teal-200">{scheduleMessage}</p>}
        </section>
        <section className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <h2 className="text-xl font-bold">Connect game IDs</h2>
          <p className="mt-1 text-sm text-slate-300">Copy each ESPN game ID from its game URL. Save IDs as official matchups become known, including after earlier rounds begin. The sync checks the event ID, teams, start time, and final status before scoring any league. A missing or mismatched ID leaves that game for manual review.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {eventIds.map((eventId, index) => <label className="block text-sm" key={index}>
              Game {index + 1} ESPN event ID
              <input className={inputClass} inputMode="numeric" pattern="[0-9]*" value={eventId}
                placeholder="ESPN event ID"
                onChange={(e) => setEventIds(eventIds.map((item, i) => i === index ? e.target.value : item))} />
            </label>)}
          </div>
          <button className="mt-4 rounded-xl bg-teal-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-50" onClick={saveEventIds} disabled={busy}>Save game IDs</button>
          {eventMessage && <p role="status" className="mt-3 text-sm text-teal-200">{eventMessage}</p>}
        </section>
        <section className="rounded-2xl border border-white/15 bg-white/5 p-5">
          <h2 className="text-xl font-bold">Record a final result</h2>
          <p className="mt-1 text-sm text-slate-300">Publish one verified final to every league for the selected tournament and season. Later rounds require prior winners; conflicting finals are rejected.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Game number<input className={inputClass} type="number" min={1} value={seriesNumber} onChange={(e) => setSeriesNumber(Number(e.target.value))} /></label>
            <div />
            <label className="text-sm">Home score<input className={inputClass} type="number" min={0} value={homeScore} onChange={(e) => setHomeScore(e.target.value)} /></label>
            <label className="text-sm">Away score<input className={inputClass} type="number" min={0} value={awayScore} onChange={(e) => setAwayScore(e.target.value)} /></label>
          </div>
          <button className="mt-4 rounded-xl bg-teal-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-50" onClick={saveResult} disabled={busy}>Publish final to all leagues</button>
          {resultMessage && <p role="status" className="mt-3 text-sm text-teal-200">{resultMessage}</p>}
        </section>
      </div>
    </main>
  )
}
