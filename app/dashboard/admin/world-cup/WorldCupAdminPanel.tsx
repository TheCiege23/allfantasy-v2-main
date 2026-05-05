"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Activity,
  ChevronRight,
  Copy,
  Filter,
  Lock,
  LockOpen,
  RefreshCw,
  Search,
  Trash2,
  Trophy,
  Users,
} from "lucide-react"

type Challenge = {
  id: string
  name: string
  ownerName: string
  ownerUserId: string
  seasonYear: number
  inviteCode: string
  visibility: string
  status: string
  participantCount: number
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

type ActionState = { id: string; action: string; loading: boolean; result: string | null; error: string | null }

const STATUS_OPTIONS = ["", "open", "live", "locked", "final", "setup"]
const STATUS_COLORS: Record<string, string> = {
  open: "bg-emerald-500/15 text-emerald-200",
  live: "bg-rose-500/15 text-rose-200",
  locked: "bg-amber-500/15 text-amber-200",
  final: "bg-blue-500/15 text-blue-200",
  setup: "bg-zinc-500/15 text-zinc-400",
}

export default function WorldCupAdminPanel() {
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [actionState, setActionState] = useState<ActionState | null>(null)
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null)

  const fetchChallenges = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set("q", search)
      if (statusFilter) params.set("status", statusFilter)
      const res = await fetch(`/api/brackets/world-cup/admin/challenges?${params}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const d = await res.json()
      setChallenges(d.challenges ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load challenges")
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter])

  useEffect(() => {
    fetchChallenges()
  }, [fetchChallenges])

  async function runAction(challengeId: string, action: string) {
    setActionState({ id: challengeId, action, loading: true, result: null, error: null })
    try {
      const res = await fetch("/api/brackets/world-cup/admin/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, challengeId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`)
      setActionState({ id: challengeId, action, loading: false, result: `${action} succeeded`, error: null })
      await fetchChallenges()
    } catch (err) {
      setActionState({
        id: challengeId,
        action,
        loading: false,
        result: null,
        error: err instanceof Error ? err.message : "Action failed",
      })
    }
  }

  async function copyInvite(code: string) {
    const url = `${window.location.origin}/join/bracket/${code}`
    await navigator.clipboard?.writeText(url).catch(() => {})
    setCopiedInvite(code)
    setTimeout(() => setCopiedInvite(null), 1400)
  }

  const busy = (id: string, action: string) =>
    actionState?.id === id && actionState.action === action && actionState.loading

  return (
    <div className="min-h-screen bg-[#05070b] px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black">World Cup Admin</h1>
            <p className="mt-1 text-sm text-white/45">
              Manage all FIFA World Cup bracket challenges
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard/admin/world-cup/health"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/[0.08]"
            >
              <Activity className="h-3.5 w-3.5" />
              Health
            </Link>
            <button
              type="button"
              onClick={fetchChallenges}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/[0.08] disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              type="text"
              placeholder="Search name or invite code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-300/40 focus:outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-full rounded-lg border border-white/10 bg-[#05070b] py-2 pl-9 pr-8 text-sm text-white focus:border-cyan-300/40 focus:outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s || "All statuses"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Toast / action result */}
        {actionState && !actionState.loading && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              actionState.error
                ? "border-rose-400/25 bg-rose-400/10 text-rose-100"
                : "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
            }`}
          >
            {actionState.error ?? actionState.result}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.03]">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white/40">Challenge</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white/40">Owner</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white/40">Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white/40">
                  <Users className="inline h-3.5 w-3.5" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white/40">Invite</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white/40">Last Sync</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-white/40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-white/30">
                    <RefreshCw className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : challenges.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-white/30">
                    No challenges found
                  </td>
                </tr>
              ) : (
                challenges.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Trophy className="h-4 w-4 shrink-0 text-cyan-300/60" />
                        <div>
                          <Link
                            href={`/brackets/world-cup/${c.id}`}
                            className="flex items-center gap-1 font-bold text-white hover:text-cyan-200"
                          >
                            {c.name}
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                          <div className="text-[10px] text-white/30">
                            {c.seasonYear} · {c.visibility}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-white/55">{c.ownerName}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_COLORS[c.status] ?? "bg-zinc-500/15 text-zinc-400"}`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-white/70">{c.participantCount}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => copyInvite(c.inviteCode)}
                        className="flex items-center gap-1 rounded bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-white/55 hover:bg-white/[0.08]"
                        title="Copy invite link"
                      >
                        {c.inviteCode}
                        <Copy className="h-3 w-3" />
                        {copiedInvite === c.inviteCode && (
                          <span className="text-cyan-300">Copied</span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-white/35">
                      {c.lastSyncedAt
                        ? new Date(c.lastSyncedAt).toLocaleString()
                        : "Never"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <ActionBtn
                          label="Sync"
                          icon={<RefreshCw className="h-3 w-3" />}
                          busy={busy(c.id, "sync")}
                          onClick={() => runAction(c.id, "sync")}
                        />
                        <ActionBtn
                          label="Recalc"
                          icon={<Activity className="h-3 w-3" />}
                          busy={busy(c.id, "recalculate")}
                          onClick={() => runAction(c.id, "recalculate")}
                        />
                        {c.status === "open" || c.status === "live" ? (
                          <ActionBtn
                            label="Lock"
                            icon={<Lock className="h-3 w-3" />}
                            busy={busy(c.id, "lock")}
                            onClick={() => runAction(c.id, "lock")}
                          />
                        ) : c.status === "locked" ? (
                          <ActionBtn
                            label="Unlock"
                            icon={<LockOpen className="h-3 w-3" />}
                            busy={busy(c.id, "unlock")}
                            onClick={() => runAction(c.id, "unlock")}
                          />
                        ) : null}
                        <ActionBtn
                          label="New Link"
                          icon={<Copy className="h-3 w-3" />}
                          busy={busy(c.id, "regenerate_invite")}
                          onClick={() => runAction(c.id, "regenerate_invite")}
                        />
                        <ActionBtn
                          label="Delete"
                          icon={<Trash2 className="h-3 w-3" />}
                          busy={busy(c.id, "delete")}
                          onClick={() => {
                            if (confirm(`Delete "${c.name}"? This cannot be undone.`)) {
                              runAction(c.id, "delete")
                            }
                          }}
                          danger
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && challenges.length > 0 && (
          <p className="mt-3 text-right text-xs text-white/25">{challenges.length} challenge{challenges.length !== 1 ? "s" : ""}</p>
        )}
      </div>
    </div>
  )
}

function ActionBtn({
  label,
  icon,
  busy,
  onClick,
  danger,
}: {
  label: string
  icon: React.ReactNode
  busy: boolean
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${
        danger
          ? "border border-rose-400/25 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
          : "border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08]"
      }`}
    >
      {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
  )
}
