"use client"

import { useState } from "react"
import Link from "next/link"

export default function KnockoutBracketAdminPage() {
  const [season, setSeason] = useState(new Date().getUTCFullYear())
  const [east, setEast] = useState<string[]>(["", "", "", ""])
  const [west, setWest] = useState<string[]>(["", "", "", ""])
  const [challengeId, setChallengeId] = useState("")
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

  async function saveResult() {
    setBusy(true)
    setResultMessage("")
    try {
      const res = await fetch("/api/admin/brackets/single-game-result", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challengeId.trim(), seriesNumber, homeScore, awayScore }),
      })
      const data = await res.json().catch(() => ({}))
      setResultMessage(res.ok
        ? `Saved game ${seriesNumber}: ${data.winner} won.`
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
          <label className="mt-4 block text-sm" htmlFor="season">Cup season</label>
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
          <h2 className="text-xl font-bold">Record a final result</h2>
          <p className="mt-1 text-sm text-slate-300">Use the challenge ID from the pool URL. Later rounds require prior winners. Existing finals cannot be overwritten here.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">Challenge ID<input className={inputClass} value={challengeId} onChange={(e) => setChallengeId(e.target.value)} /></label>
            <label className="text-sm">Game number<input className={inputClass} type="number" min={1} value={seriesNumber} onChange={(e) => setSeriesNumber(Number(e.target.value))} /></label>
            <div />
            <label className="text-sm">Home score<input className={inputClass} type="number" min={0} value={homeScore} onChange={(e) => setHomeScore(e.target.value)} /></label>
            <label className="text-sm">Away score<input className={inputClass} type="number" min={0} value={awayScore} onChange={(e) => setAwayScore(e.target.value)} /></label>
          </div>
          <button className="mt-4 rounded-xl bg-teal-300 px-4 py-2 font-bold text-slate-950 disabled:opacity-50" onClick={saveResult} disabled={busy}>Save final</button>
          {resultMessage && <p role="status" className="mt-3 text-sm text-teal-200">{resultMessage}</p>}
        </section>
      </div>
    </main>
  )
}
