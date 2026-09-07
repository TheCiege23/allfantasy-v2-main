"use client"

import { useCallback, useState } from "react"

type Lifecycle = {
  raw: string | null
  normalized: string
  coerced: boolean
  allowedTransitions: string[]
}

type Snapshot = {
  league: {
    id: string
    name: string | null
    sport: string
    season: number
    platform: string
    lifecycleState: string | null
    locked: boolean
    emergencyPaused: boolean
    status: string | null
  } | null
  draftSession: Record<string, unknown> | null
  waiverRunsRecent: Array<{ id: string; runAt: string; status: string; runType: string }>
  rosterCount: number
}

type RecentAction = {
  id: string
  action: string
  adminUserId: string
  createdAt: string
}

type Loaded = { snapshot: Snapshot; lifecycle: Lifecycle; recentActions: RecentAction[] }

/** Mirrors `AdminRecoveryAction` in lib/admin/recovery/adminRecoveryService.ts. */
type Action =
  | { type: "lifecycle_transition"; nextState: string; force?: boolean }
  | { type: "enqueue_waiver_process" }
  | { type: "enqueue_scoring_week"; season: number; weekOrRound: number; lockScores?: boolean }
  | { type: "enqueue_specialty_automation"; season: number; week?: number | null; trigger?: string }
  | { type: "stat_correction_sync"; season: number; week: number }
  | { type: "draft_pause"; confirm: true }

const CARD = "rounded-3xl border border-white/10 bg-black/45 p-6 shadow-[0_28px_90px_-54px_rgba(34,211,238,0.5)] backdrop-blur-xl"
const DANGER_CARD = "rounded-3xl border border-rose-300/25 bg-black/45 p-6 shadow-[0_28px_90px_-54px_rgba(244,63,94,0.6)] backdrop-blur-xl"
const LABEL = "text-xs font-black uppercase tracking-[0.14em] text-white/55"
const INPUT = "mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-black/35 px-4 text-sm font-semibold text-white outline-none placeholder:text-white/30 focus:border-cyan-300/65 disabled:cursor-not-allowed disabled:opacity-50"
const BTN = "min-h-12 rounded-2xl bg-cyan-300 px-5 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
const BTN_DANGER = "min-h-12 rounded-2xl bg-rose-400 px-5 text-sm font-black text-slate-950 transition hover:bg-rose-300 disabled:cursor-not-allowed disabled:opacity-50"

export default function LeagueRecoveryClient() {
  const [leagueId, setLeagueId] = useState("")
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string; detail?: unknown } | null>(null)

  // Per-action inputs.
  const [nextState, setNextState] = useState("")
  const [forceState, setForceState] = useState("")
  const [forceConfirm, setForceConfirm] = useState("")
  const [pauseConfirm, setPauseConfirm] = useState("")
  const [season, setSeason] = useState("")
  const [weekOrRound, setWeekOrRound] = useState("")
  const [lockScores, setLockScores] = useState(false)
  const [trigger, setTrigger] = useState("")
  const [statWeek, setStatWeek] = useState("")

  const league = loaded?.snapshot.league ?? null
  const leagueName = league?.name ?? ""

  const load = useCallback(async () => {
    const id = leagueId.trim()
    if (!id) return
    setLoading(true)
    setLoadError(null)
    setResult(null)
    setLoaded(null)
    try {
      const res = await fetch(`/api/admin/leagues/${encodeURIComponent(id)}/recovery`, { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        setLoadError(body?.error || `Could not load league (HTTP ${res.status}).`)
        return
      }
      setLoaded(body as Loaded)
      setNextState("")
      setForceState("")
      setForceConfirm("")
      setPauseConfirm("")
    } catch {
      setLoadError("Request failed — check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  const run = useCallback(
    async (label: string, action: Action) => {
      const id = leagueId.trim()
      if (!id) return
      setBusy(label)
      setResult(null)
      try {
        const res = await fetch(`/api/admin/leagues/${encodeURIComponent(id)}/recovery`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        })
        const body = await res.json().catch(() => ({}))
        setResult(
          res.ok && body?.ok
            ? { ok: true, text: `${label} completed.`, detail: body.detail }
            : { ok: false, text: body?.error || `${label} failed (HTTP ${res.status}).`, detail: body?.issues },
        )
        // Re-read afterwards: the state this screen offers actions from has just changed.
        await load()
      } catch {
        setResult({ ok: false, text: `${label} failed — request error.` })
      } finally {
        setBusy(null)
      }
    },
    [leagueId, load],
  )

  const num = (s: string) => {
    const n = Number(s.trim())
    return Number.isFinite(n) && s.trim() !== "" ? n : null
  }

  return (
    <div className="mt-8 space-y-5">
      {/* 1 ─ load ─────────────────────────────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">1. Load the league</h2>
        <p className="mt-2 text-xs leading-5 text-white/50">
          Paste the league id from the support ticket. There is no picker on purpose — a dropdown of
          every league is how you act on the wrong one.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void load() }}
            placeholder="league id"
            className={`${INPUT} mt-0 flex-1`}
          />
          <button type="button" onClick={() => void load()} disabled={loading || !leagueId.trim()} className={BTN}>
            {loading ? "Loading…" : "Load"}
          </button>
        </div>

        {loadError ? (
          <p className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-300/[0.08] px-4 py-3 text-sm font-bold text-rose-100">{loadError}</p>
        ) : null}

        {loaded && league ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-xs leading-5 text-white/65">
              <p><span className="font-black text-white">{league.name ?? "(unnamed)"}</span> · {league.sport} · {league.season} · {league.platform}</p>
              <p className="mt-2">
                Lifecycle: <span className="font-black text-white">{loaded.lifecycle.normalized}</span>
                {loaded.lifecycle.coerced ? (
                  <span className="ml-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-2 py-0.5 font-black text-amber-100">
                    stored value is {loaded.lifecycle.raw === null ? "NULL" : `"${loaded.lifecycle.raw}"` } — this state is a fallback, not a fact
                  </span>
                ) : null}
              </p>
              <p className="mt-2">
                Rosters: <span className="font-black text-white">{loaded.snapshot.rosterCount}</span>
                {" · "}Locked: <span className="font-black text-white">{String(league.locked)}</span>
                {" · "}Emergency paused: <span className="font-black text-white">{String(league.emergencyPaused)}</span>
                {" · "}Draft session: <span className="font-black text-white">{loaded.snapshot.draftSession ? "present" : "none"}</span>
              </p>
            </div>
            <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-5 text-white/55">
              <summary className="cursor-pointer font-black text-white/80">Raw snapshot</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-cyan-100/80">
                {JSON.stringify(loaded.snapshot, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </section>

      {loaded && league ? (
        <>
          {result ? (
            <p className={`rounded-2xl border px-4 py-3 text-sm font-black ${result.ok ? "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100" : "border-rose-300/25 bg-rose-300/[0.08] text-rose-100"}`}>
              {result.text}
              {result.detail ? <span className="ml-2 font-mono text-xs font-normal opacity-80">{JSON.stringify(result.detail)}</span> : null}
            </p>
          ) : null}

          {/* 2 ─ lifecycle ──────────────────────────────────────────────────────────────── */}
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">2. Lifecycle</h2>
            <p className="mt-2 text-xs leading-5 text-white/50">
              Only transitions that are legal from <span className="font-black text-white/80">{loaded.lifecycle.normalized}</span> are listed.
              The server derives this from the same validator that enforces it.
            </p>
            {loaded.lifecycle.allowedTransitions.length === 0 ? (
              <p className="mt-4 text-sm font-bold text-white/55">No legal transitions from this state.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <select value={nextState} onChange={(e) => setNextState(e.target.value)} className={`${INPUT} mt-0 flex-1`}>
                  <option value="">Choose a state…</option>
                  {loaded.lifecycle.allowedTransitions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => void run("Lifecycle transition", { type: "lifecycle_transition", nextState })}
                  disabled={!nextState || busy !== null}
                  className={BTN}
                >
                  {busy === "Lifecycle transition" ? "Working…" : "Transition"}
                </button>
              </div>
            )}
          </section>

          {/* 3 ─ queues ─────────────────────────────────────────────────────────────────── */}
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">3. Re-run automation</h2>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void run("Waiver process", { type: "enqueue_waiver_process" })} disabled={busy !== null} className={BTN}>
                {busy === "Waiver process" ? "Working…" : "Enqueue waiver process"}
              </button>
              <span className="text-xs text-white/45">
                Last run: {loaded.snapshot.waiverRunsRecent[0]
                  ? `${loaded.snapshot.waiverRunsRecent[0].status} · ${new Date(loaded.snapshot.waiverRunsRecent[0].runAt).toLocaleString()}`
                  : "none recorded"}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="block"><span className={LABEL}>Season</span>
                <input value={season} onChange={(e) => setSeason(e.target.value)} inputMode="numeric" placeholder="2026" className={INPUT} /></label>
              <label className="block"><span className={LABEL}>Week / round</span>
                <input value={weekOrRound} onChange={(e) => setWeekOrRound(e.target.value)} inputMode="numeric" placeholder="1" className={INPUT} /></label>
              <label className="flex items-end gap-2 pb-1">
                <input type="checkbox" checked={lockScores} onChange={(e) => setLockScores(e.target.checked)} className="size-4 accent-cyan-300" />
                <span className="text-xs font-bold text-white/60">Lock scores</span>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  const s = num(season), w = num(weekOrRound)
                  if (s === null || w === null) return
                  void run("Scoring week", { type: "enqueue_scoring_week", season: s, weekOrRound: w, lockScores })
                }}
                disabled={busy !== null || num(season) === null || num(weekOrRound) === null}
                className={BTN}
              >
                {busy === "Scoring week" ? "Working…" : "Enqueue scoring week"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const s = num(season)
                  if (s === null) return
                  void run("Specialty automation", { type: "enqueue_specialty_automation", season: s, week: num(weekOrRound), trigger: trigger.trim() || undefined })
                }}
                disabled={busy !== null || num(season) === null}
                className={BTN}
              >
                {busy === "Specialty automation" ? "Working…" : "Enqueue specialty automation"}
              </button>
              <input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="trigger (optional)" className={`${INPUT} mt-0 w-48`} />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className="block"><span className={LABEL}>Stat correction — season</span>
                <input value={season} onChange={(e) => setSeason(e.target.value)} inputMode="numeric" placeholder="2026" className={INPUT} /></label>
              <label className="block"><span className={LABEL}>Week</span>
                <input value={statWeek} onChange={(e) => setStatWeek(e.target.value)} inputMode="numeric" placeholder="1" className={INPUT} /></label>
              <button
                type="button"
                onClick={() => {
                  const s = num(season), w = num(statWeek)
                  if (s === null || w === null) return
                  void run("Stat correction", { type: "stat_correction_sync", season: s, week: w })
                }}
                disabled={busy !== null || num(season) === null || num(statWeek) === null}
                className={`${BTN} self-end`}
              >
                {busy === "Stat correction" ? "Working…" : "Reprocess week"}
              </button>
            </div>
          </section>

          {/* 4 ─ destructive ────────────────────────────────────────────────────────────── */}
          <section className={DANGER_CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-rose-100/85">4. Disruptive — read before using</h2>

            <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-4">
              <h3 className="text-xs font-black uppercase tracking-[0.14em] text-rose-100/85">Pause the draft</h3>
              <p className="mt-2 text-xs leading-5 text-white/55">
                {loaded.snapshot.draftSession
                  ? "There is a live draft session. Pausing it interrupts an event managers are sitting in."
                  : "No draft session on this league — this will be refused."}
              </p>
              <label className="mt-3 block">
                <span className={LABEL}>Type the league name to enable</span>
                <input value={pauseConfirm} onChange={(e) => setPauseConfirm(e.target.value)} placeholder={leagueName || "(unnamed league)"} className={INPUT} />
              </label>
              <button
                type="button"
                onClick={() => void run("Draft pause", { type: "draft_pause", confirm: true })}
                disabled={busy !== null || !leagueName || pauseConfirm.trim() !== leagueName}
                className={`${BTN_DANGER} mt-3 w-full`}
              >
                {busy === "Draft pause" ? "Pausing…" : "Pause the draft"}
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-300/[0.06] p-4">
              <h3 className="text-xs font-black uppercase tracking-[0.14em] text-rose-100/85">Force a lifecycle transition</h3>
              <p className="mt-2 text-xs leading-5 text-white/55">
                Separate from section 2 on purpose. This <span className="font-black text-rose-100">bypasses the validity table entirely</span> —
                it can move the league to a state the engine does not expect from here. Use it to unstick something the legal
                transitions cannot reach, not as a shortcut.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={LABEL}>Target state (any)</span>
                  <input value={forceState} onChange={(e) => setForceState(e.target.value)} placeholder="e.g. pre_draft" className={INPUT} /></label>
                <label className="block"><span className={LABEL}>Type the league name to enable</span>
                  <input value={forceConfirm} onChange={(e) => setForceConfirm(e.target.value)} placeholder={leagueName || "(unnamed league)"} className={INPUT} /></label>
              </div>
              <button
                type="button"
                onClick={() => void run("Forced transition", { type: "lifecycle_transition", nextState: forceState.trim(), force: true })}
                disabled={busy !== null || !forceState.trim() || !leagueName || forceConfirm.trim() !== leagueName}
                className={`${BTN_DANGER} mt-3 w-full`}
              >
                {busy === "Forced transition" ? "Forcing…" : "Force transition"}
              </button>
            </div>
          </section>

          {/* 5 ─ audit ──────────────────────────────────────────────────────────────────── */}
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">5. Recent recovery actions on this league</h2>
            {loaded.recentActions.length === 0 ? (
              <p className="mt-3 text-sm font-bold text-white/50">None recorded.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-xs leading-5 text-white/65">
                {loaded.recentActions.map((a) => (
                  <li key={a.id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2">
                    <span className="font-black text-white">{a.action}</span>
                    {" · "}{a.adminUserId}
                    {" · "}{new Date(a.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
