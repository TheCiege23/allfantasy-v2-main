"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import type { ReportForReview } from "@/lib/moderation/AdminReportReview"

const WHERE: Record<string, string> = { league: "League chat", bracket: "Bracket chat", platform: "DM / huddle" }

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}

/**
 * One card per report. The message is shown UNCENSORED on purpose: the reviewer
 * has to see what was actually said to judge it.
 */
export function ModerationQueue({ reports }: { reports: ReportForReview[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(id: string, action: "remove" | "dismiss") {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/moderation/reports/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setBusy(null)
    }
  }

  if (reports.length === 0) {
    return <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/60">Nothing to review.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      ) : null}
      {reports.map((r) => {
        const m = r.message
        const pending = r.status === "pending"
        return (
          <article key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" data-testid="report-card">
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
              <span className="rounded-full border border-white/15 px-2 py-0.5">{m ? WHERE[m.store] : "Message missing"}</span>
              {m?.roomName ? <span>{m.roomName}</span> : null}
              <span>· reported {ago(r.createdAt)} by @{r.reporter.username ?? r.reporter.id.slice(0, 8)}</span>
              <span>· reason: {r.reason}</span>
              {r.reportsOnMessage > 1 ? <span className="text-amber-300">· {r.reportsOnMessage} reports on this message</span> : null}
              {!pending ? <span className="text-white/40">· {r.status}</span> : null}
            </div>
            {m ? (
              <>
                <p className="mt-2 text-sm font-semibold text-white">@{m.authorUsername ?? m.authorId ?? "unknown"}</p>
                <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${m.deleted ? "italic text-white/40" : "text-white/90"}`}>
                  {m.text}
                </p>
                {m.deleted ? (
                  <p className="mt-1 text-xs text-white/40">{m.removedByModeration ? "Removed by moderation" : "Deleted by its author"}</p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm italic text-white/40">This message no longer exists.</p>
            )}
            {pending ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => void act(r.id, "remove")}
                  className="rounded-xl bg-rose-500/90 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {m && !m.deleted ? "Remove message" : "Close report"}
                </button>
                <button
                  type="button"
                  disabled={busy === r.id}
                  onClick={() => void act(r.id, "dismiss")}
                  className="rounded-xl border border-white/20 px-3 py-1.5 text-sm font-semibold text-white/80 disabled:opacity-50"
                >
                  Dismiss — no action
                </button>
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
