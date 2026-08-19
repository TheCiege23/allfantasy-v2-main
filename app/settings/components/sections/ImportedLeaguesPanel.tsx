"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { RefreshCw, ExternalLink, Search } from "lucide-react"

/**
 * The real per-league list for the "League Imports" tab.
 *
 * Source: GET /api/league/list (getDashboardLeagueListForUser) — merges native +
 * imported + Sleeper + legacy leagues into one normalized array. Only the two
 * genuinely-backed row actions are offered: Open (link) and Resync
 * (POST /api/leagues/import/resync — imported leagues only). There is no
 * member-level archive/disconnect endpoint, so those reference actions are
 * intentionally omitted. See memory `settings-panels-data-backing`.
 */

const IMPORT_PLATFORMS = new Set(["sleeper", "espn", "yahoo", "mfl", "fleaflicker", "fantrax"])

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

function platformLabel(p?: string): string {
  const map: Record<string, string> = {
    sleeper: "Sleeper", espn: "ESPN", yahoo: "Yahoo", mfl: "MFL",
    fleaflicker: "Fleaflicker", fantrax: "Fantrax", allfantasy: "AllFantasy", native: "AllFantasy",
  }
  return map[(p ?? "").toLowerCase()] ?? (p ? p[0]!.toUpperCase() + p.slice(1) : "—")
}

function syncPill(status?: string | null): { label: string; color: string; bg: string } {
  const s = (status ?? "").toLowerCase()
  if (s === "syncing" || s === "pending" || s === "importing")
    return { label: "Syncing…", color: "var(--accent-cyan-strong)", bg: "color-mix(in srgb, var(--accent-cyan) 16%, transparent)" }
  if (s === "error" || s === "failed")
    return { label: "Sync error", color: "var(--accent-red-strong)", bg: "color-mix(in srgb, var(--accent-red-strong) 14%, transparent)" }
  return { label: "Active", color: "#7ee081", bg: "color-mix(in srgb, #7ee081 15%, transparent)" }
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

export function ImportedLeaguesPanel() {
  const [leagues, setLeagues] = useState<LeagueRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [platform, setPlatform] = useState("all")
  const [resyncing, setResyncing] = useState<Record<string, "busy" | "done" | "error">>({})

  useEffect(() => {
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

  async function resync(l: LeagueRow) {
    if (!l.platformLeagueId || !l.platform) return
    setResyncing((r) => ({ ...r, [l.id]: "busy" }))
    try {
      const res = await fetch("/api/leagues/import/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: l.platform, sourceId: l.platformLeagueId }),
      })
      setResyncing((r) => ({ ...r, [l.id]: res.ok ? "done" : "error" }))
    } catch {
      setResyncing((r) => ({ ...r, [l.id]: "error" }))
    }
  }

  // Only leagues with a live native backing are resyncable. Historical career-board
  // snapshots (from /api/league/list) carry a platformLeagueId but no navigation/unified
  // record — resyncing those would re-import and materialize a native league from what the
  // user sees as read-only history, so they're excluded.
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
            const rs = resyncing[l.id]
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
                </div>
                <span className="shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: pill.bg, color: pill.color }}>
                  {pill.label}
                </span>
                {l.lastSyncedAt ? (
                  <span className="shrink-0 text-[10.5px]" style={{ color: "var(--muted)" }}>{relTime(l.lastSyncedAt)}</span>
                ) : null}
                <div className="flex shrink-0 gap-1.5">
                  <Link
                    href={openHref}
                    className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Link>
                  {canResync(l) ? (
                    <button
                      type="button"
                      onClick={() => void resync(l)}
                      disabled={rs === "busy"}
                      className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium disabled:opacity-50"
                      style={{ borderColor: "var(--border)", color: rs === "error" ? "var(--accent-red-strong)" : "var(--muted2)" }}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${rs === "busy" ? "animate-spin" : ""}`} />
                      {rs === "busy" ? "Resyncing…" : rs === "done" ? "Queued" : rs === "error" ? "Failed" : "Resync"}
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
