"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { RefreshCw, ExternalLink, Search } from "lucide-react"
import { SourceActionLink } from "@/components/league-links/SourceActionLink"

/**
 * The real per-league list for the "League Imports" tab.
 *
 * Source: GET /api/league/list (getDashboardLeagueListForUser) — merges native +
 * imported + Sleeper + legacy leagues into one normalized array. Only the two
 * genuinely-backed row actions are offered: Open (link) and Resync.
 *
 * Resync is DB-first + background (Launch Batch 2 · B6): POST /api/leagues/import/resync ENQUEUES a
 * durable job and returns immediately (202); this panel then POLLS
 * GET /api/leagues/import/resync/status and exits "Refreshing" on every terminal outcome. The previous
 * DB snapshot stays visible throughout, the request never hangs, and navigating away never cancels the
 * job (it is a durable DB row a worker drains out-of-band). See memory `settings-panels-data-backing`.
 */

const IMPORT_PLATFORMS = new Set(["sleeper", "espn", "yahoo", "mfl", "fleaflicker", "fantrax"])

const POLL_INTERVAL_MS = 3000
// Stop the visible spinner after this long. The job is durable and keeps running server-side; the row
// simply shows "Refreshing in the background" so it is never stuck on a spinner forever.
const MAX_POLL_MS = 90_000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type LeagueRow = {
  id: string
  name?: string
  platform?: string
  platformLeagueId?: string | null
  season?: string | number | null
  teamCount?: number | null
  leagueSize?: number | null
  scoring?: string | null
  leagueType?: string | null
  syncStatus?: string | null
  lastSyncedAt?: string | null
  userRole?: string | null
  navigationLeagueId?: string | null
  hasUnifiedRecord?: boolean | null
}

type RefreshPhase = "refreshing" | "updated" | "no_change" | "failed" | "rate_limited" | "background"
type RefreshState = {
  phase: RefreshPhase
  lastChecked?: string | null
  lastSuccessfullyUpdated?: string | null
}

function platformLabel(p?: string): string {
  const map: Record<string, string> = {
    sleeper: "Sleeper", espn: "ESPN", yahoo: "Yahoo", mfl: "MFL",
    fleaflicker: "Fleaflicker", fantrax: "Fantrax", allfantasy: "AllFantasy", native: "AllFantasy",
  }
  return map[(p ?? "").toLowerCase()] ?? (p ? p[0]!.toUpperCase() + p.slice(1) : "—")
}

/**
 * Base freshness pill from the SERVER's stored syncStatus. It never claims "Syncing…" at rest — an
 * imported-but-never-refreshed league is `pending`, and nothing is actually syncing then (that was the
 * B6 "stuck on Syncing" symptom). Live refresh progress is shown by the row caption, not this pill.
 */
function syncPill(status?: string | null): { label: string; color: string; bg: string } {
  const s = (status ?? "").toLowerCase()
  if (s === "error" || s === "failed")
    return { label: "Sync error", color: "var(--accent-red-strong)", bg: "color-mix(in srgb, var(--accent-red-strong) 14%, transparent)" }
  if (s === "partial")
    return { label: "Partial", color: "var(--accent-amber-strong, #e0b877)", bg: "color-mix(in srgb, #e0b877 15%, transparent)" }
  if (s === "synced" || s === "active")
    return { label: "Active", color: "#7ee081", bg: "color-mix(in srgb, #7ee081 15%, transparent)" }
  return { label: "Ready", color: "var(--muted)", bg: "color-mix(in srgb, var(--muted) 15%, transparent)" }
}

function relTime(iso?: string | null): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ""
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/** Honest terminal caption for the refresh action. Never says "Queued" for a failed/timed-out refresh. */
function refreshCaption(rs: RefreshState | undefined): { text: string; color: string } | null {
  if (!rs) return null
  switch (rs.phase) {
    case "refreshing":
      return { text: "Refreshing in the background…", color: "var(--accent-cyan-strong)" }
    case "updated":
      return { text: `Updated${rs.lastSuccessfullyUpdated ? ` · ${relTime(rs.lastSuccessfullyUpdated)}` : ""}`, color: "#7ee081" }
    case "no_change":
      return { text: "Checked — no new information", color: "var(--muted)" }
    case "failed":
      return { text: "Refresh failed — your previous data is still available", color: "var(--accent-red-strong)" }
    case "rate_limited":
      return { text: "Too many refreshes in progress — try again shortly", color: "var(--accent-amber-strong, #e0b877)" }
    case "background":
      return { text: "Refreshing in the background — check back shortly", color: "var(--accent-cyan-strong)" }
    default:
      return null
  }
}

export function ImportedLeaguesPanel() {
  const [leagues, setLeagues] = useState<LeagueRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [platform, setPlatform] = useState("all")
  const [refresh, setRefresh] = useState<Record<string, RefreshState>>({})

  // Leagues currently being polled — the single source of truth for the double-click guard. A ref (not
  // state) so it is read synchronously inside the async click handler without a stale closure.
  const activePolls = useRef<Set<string>>(new Set())
  const unmountedRef = useRef(false)

  useEffect(() => {
    unmountedRef.current = false
    const polls = activePolls.current // stable Set identity for the component's life; safe in cleanup
    let cancelled = false
    void (async () => {
      const data = await fetch("/api/league/list", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      if (cancelled) return
      if (data && Array.isArray(data.leagues)) setLeagues(data.leagues as LeagueRow[])
      else setLeagues([])
      setLoading(false)
    })()
    return () => {
      cancelled = true
      // Stop all polling on unmount. The durable jobs keep running server-side; navigating away never
      // cancels them.
      unmountedRef.current = true
      polls.clear()
    }
  }, [])

  const platforms = useMemo(() => {
    const set = new Set<string>()
    ;(leagues ?? []).forEach((l) => l.platform && set.add(l.platform.toLowerCase()))
    return Array.from(set)
  }, [leagues])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (leagues ?? []).filter((l) => {
      if (platform !== "all" && (l.platform ?? "").toLowerCase() !== platform) return false
      if (q && !(l.name ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [leagues, query, platform])

  async function pollStatus(l: LeagueRow, deadline: number) {
    const key = l.id
    while (!unmountedRef.current && activePolls.current.has(key) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      if (unmountedRef.current || !activePolls.current.has(key)) return
      let data: { ok?: boolean; phase?: string; lastChecked?: string | null; lastSuccessfullyUpdated?: string | null } | null = null
      try {
        const res = await fetch(
          `/api/leagues/import/resync?provider=${encodeURIComponent(l.platform ?? "")}&sourceId=${encodeURIComponent(l.platformLeagueId ?? "")}`,
          { cache: "no-store" },
        )
        data = res.ok ? await res.json() : null
      } catch {
        data = null
      }
      if (unmountedRef.current || !activePolls.current.has(key)) return
      if (!data?.ok) continue // transient status error — keep polling
      const base = { lastChecked: data.lastChecked ?? null, lastSuccessfullyUpdated: data.lastSuccessfullyUpdated ?? null }
      if (data.phase === "refreshing") {
        setRefresh((r) => ({ ...r, [key]: { phase: "refreshing", ...base } }))
        continue
      }
      // Terminal — exit the spinner honestly.
      const phase: RefreshPhase =
        data.phase === "updated" ? "updated" : data.phase === "failed" ? "failed" : "no_change"
      activePolls.current.delete(key)
      setRefresh((r) => ({ ...r, [key]: { phase, ...base } }))
      return
    }
    // Deadline reached while still refreshing — the job is durable and keeps running; drop the spinner.
    if (!unmountedRef.current && activePolls.current.has(key)) {
      activePolls.current.delete(key)
      setRefresh((r) => ({ ...r, [key]: { ...r[key], phase: "background" } }))
    }
  }

  async function resync(l: LeagueRow) {
    if (!l.platformLeagueId || !l.platform) return
    const key = l.id
    // Double-click guard: one in-flight refresh per league (the server also dedupes by idempotency key).
    if (activePolls.current.has(key) || refresh[key]?.phase === "refreshing") return
    activePolls.current.add(key)
    setRefresh((r) => ({ ...r, [key]: { phase: "refreshing" } }))

    let res: Response
    try {
      res = await fetch("/api/leagues/import/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: l.platform, sourceId: l.platformLeagueId }),
      })
    } catch {
      activePolls.current.delete(key)
      setRefresh((r) => ({ ...r, [key]: { phase: "failed" } }))
      return
    }

    if (res.status === 429) {
      activePolls.current.delete(key)
      setRefresh((r) => ({ ...r, [key]: { phase: "rate_limited" } }))
      return
    }

    let body: { status?: string; lastSuccessfullyUpdated?: string | null } | null = null
    try {
      body = await res.json()
    } catch {
      body = null
    }

    if (!res.ok) {
      activePolls.current.delete(key)
      setRefresh((r) => ({ ...r, [key]: { phase: "failed" } }))
      return
    }

    // Already fresh — a successful refresh happened moments ago, so no new job was queued.
    if (body?.status === "up_to_date") {
      activePolls.current.delete(key)
      setRefresh((r) => ({ ...r, [key]: { phase: "no_change", lastSuccessfullyUpdated: body?.lastSuccessfullyUpdated ?? null } }))
      return
    }

    // queued | already_running → the durable worker will process it; poll the DB-backed status.
    setRefresh((r) => ({ ...r, [key]: { phase: "refreshing", lastSuccessfullyUpdated: body?.lastSuccessfullyUpdated ?? null } }))
    void pollStatus(l, Date.now() + MAX_POLL_MS)
  }

  // Only leagues with a live native backing are resyncable. Historical career-board snapshots (from
  // /api/league/list) carry a platformLeagueId but no navigation/unified record — resyncing those would
  // re-import and materialize a native league from what the user sees as read-only history, so they're
  // excluded.
  const canResync = (l: LeagueRow) =>
    Boolean(l.platformLeagueId) &&
    IMPORT_PLATFORMS.has((l.platform ?? "").toLowerCase()) &&
    (Boolean(l.navigationLeagueId) || l.hasUnifiedRecord === true)

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your leagues…"
            className="w-full rounded-lg border py-2 pl-8 pr-3 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          />
        </div>
        {platforms.length > 1 ? (
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="rounded-lg border py-2 px-3 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          >
            <option value="all">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>{platformLabel(p)}</option>
            ))}
          </select>
        ) : null}
      </div>

      {loading ? (
        <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>Loading your leagues…</p>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>
          {(leagues ?? []).length === 0 ? "No leagues imported yet." : "No leagues match your filters."}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((l) => {
            const pill = syncPill(l.syncStatus)
            const managers = l.teamCount ?? l.leagueSize
            const meta = [platformLabel(l.platform), managers ? `${managers} managers` : null, l.leagueType || l.scoring, l.season]
              .filter(Boolean)
              .join(" · ")
            const openHref = l.navigationLeagueId ? `/league/${l.navigationLeagueId}` : "/dashboard"
            const rs = refresh[l.id]
            const busy = rs?.phase === "refreshing"
            const caption = refreshCaption(rs)
            // Show last successfully-updated and last-checked separately when they differ.
            const lastUpdated = rs?.lastSuccessfullyUpdated ?? l.lastSyncedAt ?? null
            const lastChecked = rs?.lastChecked ?? null
            return (
              <li
                key={l.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                style={{ borderColor: "var(--border)", background: "var(--panel)" }}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold"
                  style={{ background: "color-mix(in srgb, var(--accent-cyan) 22%, transparent)", color: "var(--text)" }}
                >
                  {(l.name ?? "?").slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>{l.name ?? "Untitled league"}</div>
                  <div className="truncate text-[11.5px]" style={{ color: "var(--muted)" }}>{meta}</div>
                  {caption ? (
                    <div className="mt-0.5 truncate text-[11px] font-medium" style={{ color: caption.color }}>{caption.text}</div>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: pill.bg, color: pill.color }}>
                  {pill.label}
                </span>
                {lastUpdated ? (
                  <span className="shrink-0 text-[10.5px]" style={{ color: "var(--muted)" }}>
                    Updated {relTime(lastUpdated)}
                    {lastChecked && lastChecked !== lastUpdated ? ` · checked ${relTime(lastChecked)}` : ""}
                  </span>
                ) : null}
                <div className="flex shrink-0 gap-1.5">
                  <Link
                    href={openHref}
                    className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Link>
                  <SourceActionLink
                    platform={l.platform}
                    sourceLeagueId={l.platformLeagueId}
                    leagueName={l.name}
                    season={l.season}
                    action="open"
                    className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--muted2)" }}
                  />
                  {canResync(l) ? (
                    <button
                      type="button"
                      onClick={() => void resync(l)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium disabled:opacity-60"
                      style={{ borderColor: "var(--border)", color: rs?.phase === "failed" ? "var(--accent-red-strong)" : "var(--muted2)" }}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                      {busy ? "Refreshing…" : "Resync"}
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
