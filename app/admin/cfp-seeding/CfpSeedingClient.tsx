"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

/**
 * The twelve-seed form, with a live preview of the matchups those seeds make.
 *
 * The preview is the safety feature: a swapped seed or a team in the wrong slot
 * is easy to miss in a list of twelve names and obvious in "#5 Texas vs #12
 * Clemson". It mirrors buildCfpTemplate's fixed bracket exactly — 8v9, 5v12,
 * 7v10, 6v11, then #1 v W(8/9), #4 v W(5/12), #2 v W(7/10), #3 v W(6/11).
 */

const FIELD_SIZE = 12
const FIRST_ROUND: Array<[number, number]> = [
  [8, 9],
  [5, 12],
  [7, 10],
  [6, 11],
]
const QUARTERFINALS: Array<[number, [number, number]]> = [
  [1, [8, 9]],
  [4, [5, 12]],
  [2, [7, 10]],
  [3, [6, 11]],
]

/** The college football season a December–January playoff belongs to: Jan–Jul belongs to last year's. */
function currentCfbSeason(now = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
}

type SaveSummary = {
  pools: number
  corrections: Array<{ seed: number; from: string; to: string }>
  corrected: { slotsRenamed: number; picksRenamed: number }
  sweep: { challengesSeeded: number; slotsFilled: number; picksMigrated: number; slotsUnresolved: number; errors: string[] }
}

export default function CfpSeedingClient() {
  const [season, setSeason] = useState<number>(currentCfbSeason())
  const [seeds, setSeeds] = useState<string[]>(() => Array(FIELD_SIZE).fill(""))
  const [saved, setSaved] = useState<{ seeds: string[]; enteredAt: string } | null>(null)
  const [pools, setPools] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [summary, setSummary] = useState<SaveSummary | null>(null)

  const load = useCallback(async (forSeason: number) => {
    setLoading(true)
    setErrors([])
    setSummary(null)
    setConfirmed(false)
    try {
      const res = await fetch(`/api/admin/brackets/cfp-seeds?season=${forSeason}`, { cache: "no-store" })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setErrors([json?.error ?? `Could not load seeds (HTTP ${res.status}).`])
        return
      }
      setPools(typeof json.pools === "number" ? json.pools : null)
      if (json.record?.seeds) {
        setSaved({ seeds: json.record.seeds, enteredAt: json.record.enteredAt })
        setSeeds(json.record.seeds)
      } else {
        setSaved(null)
        setSeeds(Array(FIELD_SIZE).fill(""))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(season)
  }, [load, season])

  const name = (seed: number) => seeds[seed - 1]?.trim() || `Seed ${seed}`
  const changedFromSaved = useMemo(
    () => (saved ? seeds.map((s, i) => s.trim() !== saved.seeds[i]).some(Boolean) : true),
    [saved, seeds],
  )
  const allFilled = seeds.every((s) => s.trim().length > 0)

  async function save() {
    setSaving(true)
    setErrors([])
    setSummary(null)
    try {
      const res = await fetch("/api/admin/brackets/cfp-seeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ season, seeds }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setErrors(json?.errors ?? [json?.error ?? `Save failed (HTTP ${res.status}).`])
        return
      }
      setSaved({ seeds: json.record.seeds, enteredAt: json.record.enteredAt })
      setSeeds(json.record.seeds)
      setPools(json.pools)
      setSummary(json)
      setConfirmed(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-8 space-y-6" data-testid="cfp-seeding">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs font-bold uppercase tracking-wide text-white/60">
          Season
          <input
            type="number"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value) || currentCfbSeason())}
            className="mt-1 block w-32 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-base font-bold text-white"
            data-testid="cfp-seeding-season"
          />
        </label>
        <p className="pb-2 text-xs leading-5 text-white/55">
          {loading
            ? "Loading…"
            : `${pools ?? 0} pool${pools === 1 ? "" : "s"} for this season · ${
                saved ? `seeds saved ${saved.enteredAt ? new Date(saved.enteredAt).toLocaleString() : ""}` : "no seeds saved yet"
              }`}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ol className="space-y-2" aria-label="Seeds in order">
          {seeds.map((value, index) => (
            <li key={index} className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-right text-sm font-black text-cyan-200">#{index + 1}</span>
              <input
                value={value}
                onChange={(e) => {
                  const next = [...seeds]
                  next[index] = e.target.value
                  setSeeds(next)
                  setConfirmed(false)
                }}
                placeholder={index < 4 ? "First-round bye" : "Team name"}
                maxLength={60}
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-white/30"
                data-testid={`cfp-seed-${index + 1}`}
              />
            </li>
          ))}
        </ol>

        <div className="space-y-4" data-testid="cfp-seeding-preview">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs font-black uppercase tracking-wide text-white/60">First round</p>
            <ul className="mt-2 space-y-1 text-sm text-white/85">
              {FIRST_ROUND.map(([home, away]) => (
                <li key={home}>
                  #{home} {name(home)} <span className="text-white/40">vs</span> #{away} {name(away)}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <p className="text-xs font-black uppercase tracking-wide text-white/60">Quarterfinals</p>
            <ul className="mt-2 space-y-1 text-sm text-white/85">
              {QUARTERFINALS.map(([bye, [a, b]]) => (
                <li key={bye}>
                  #{bye} {name(bye)} <span className="text-white/40">vs</span> winner of #{a}/#{b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {errors.length > 0 ? (
        <ul className="space-y-1 rounded-2xl border border-rose-300/25 bg-rose-300/[0.08] px-4 py-3 text-sm font-bold text-rose-100" data-testid="cfp-seeding-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-4">
        <label className="flex items-start gap-3 text-sm leading-6 text-amber-50">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 h-4 w-4"
            data-testid="cfp-seeding-confirm"
          />
          I&apos;ve checked all twelve teams and their seeds against the official College Football Playoff
          announcement.
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!confirmed || !allFilled || !changedFromSaved || saving || loading}
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-cyan-300 px-5 py-2 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="cfp-seeding-save"
        >
          {saving ? "Saving…" : saved ? "Save corrections and update pools" : "Save seeds and fill every pool"}
        </button>
      </div>

      {summary ? (
        <div className="rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.06] p-4 text-sm leading-6 text-emerald-50" data-testid="cfp-seeding-summary">
          <p className="font-black">Saved.</p>
          <p>
            {summary.pools} pool{summary.pools === 1 ? "" : "s"} · {summary.sweep.slotsFilled} slots filled ·{" "}
            {summary.sweep.picksMigrated} picks moved with them
            {summary.corrections.length > 0
              ? ` · ${summary.corrections.length} correction${summary.corrections.length === 1 ? "" : "s"} (${summary.corrected.slotsRenamed} slots, ${summary.corrected.picksRenamed} picks renamed)`
              : ""}
          </p>
          {summary.sweep.errors.length > 0 ? (
            <p className="mt-2 font-bold text-rose-100">Some pools failed — save again to retry: {summary.sweep.errors.join("; ")}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
