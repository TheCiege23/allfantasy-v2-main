"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Megaphone, Send } from "lucide-react"

/**
 * The Commissioner tab's @everyone announcement, for one league.
 *
 * 🛑 IT COULD NOT DELIVER ANYWHERE (found 2026-09-25). It posted to
 * `/api/shared/chat/threads/<leagueChatThreadId>/broadcast`, and it was only shown when that link
 * was set — which nothing in the app ever set (0 of 390 leagues in production). The link could only
 * be a platform thread, and a league's own chat is not one.
 *
 * It now uses the one announcement path that works: `POST /api/commissioner/broadcast`, the same
 * route as the Commissioner Hub, the format hubs and the draft room. That route decides who may send
 * (head commissioner or co-commissioner, in a league AllFantasy runs — lib/commissioner/broadcastAccess.ts),
 * posts into the league's own chat as a commissioner announcement, and notifies members who have not
 * turned announcements off. Whether to offer the box at all comes from `GET /api/commissioner/leagues`,
 * which answers with that same rule, so this never offers a send the route would refuse.
 */

type Props = {
  leagueId: string
  onSent?: () => void
  className?: string
}

type Availability =
  | { state: "checking" }
  | { state: "ready" }
  | { state: "imported"; platform: string }
  | { state: "not_commissioner" }

type BroadcastLeagueRow = { id?: unknown; isNative?: unknown; platform?: unknown }

const MAX_LENGTH = 500

function platformLabel(platform: string): string {
  const p = platform.trim()
  if (!p) return "the platform it was imported from"
  return p.charAt(0).toUpperCase() + p.slice(1)
}

/** The route's per-league refusal, said plainly. */
function refusalText(error: unknown): string {
  if (error === "Forbidden") return "Only this league's commissioner or a co-commissioner can send announcements."
  if (typeof error === "string" && error.trim()) return `${error.trim()}.`
  return "That didn't post. Give it another shot in a moment."
}

export default function CommissionerBroadcastForm({ leagueId, onSent, className = "" }: Props) {
  const [availability, setAvailability] = useState<Availability>({ state: "checking" })
  const [announcement, setAnnouncement] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentNote, setSentNote] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setAvailability({ state: "checking" })
    fetch("/api/commissioner/leagues", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { leagues?: BroadcastLeagueRow[] } | null
        if (!active) return
        if (!res.ok || !Array.isArray(data?.leagues)) {
          // The send route is the authority either way; if the list is unreachable, let it decide.
          setAvailability({ state: "ready" })
          return
        }
        const row = data.leagues.find((l) => l?.id === leagueId)
        if (!row) setAvailability({ state: "not_commissioner" })
        else if (row.isNative === false) {
          setAvailability({ state: "imported", platform: typeof row.platform === "string" ? row.platform : "" })
        } else setAvailability({ state: "ready" })
      })
      .catch(() => {
        if (active) setAvailability({ state: "ready" })
      })
    return () => {
      active = false
    }
  }, [leagueId])

  const handleSubmit = async () => {
    const text = announcement.trim()
    if (!text || sending) return
    setError(null)
    setSentNote(null)
    setSending(true)
    try {
      const res = await fetch("/api/commissioner/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueIds: [leagueId], message: text }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        results?: Array<{ leagueId?: string; sent?: boolean; error?: string }>
      }
      if (!res.ok) {
        setError(data?.error || "That didn't post. Give it another shot in a moment.")
        return
      }
      const result = (data.results ?? []).find((r) => r.leagueId === leagueId)
      if (!result?.sent) {
        setError(refusalText(result?.error))
        return
      }
      setAnnouncement("")
      setSentNote("Posted to league chat. The whole league has it.")
      onSent?.()
    } catch {
      setError("Connection dropped before it sent. Your message is still here.")
    } finally {
      setSending(false)
    }
  }

  const heading = (
    <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--text)" }}>
      <Megaphone className="h-4 w-4" style={{ color: "var(--accent-amber-strong)" }} />
      Commissioner announcement
    </div>
  )

  const shell = (children: ReactNode) => (
    <div
      className={`rounded-xl border p-3 ${className}`}
      data-testid="commissioner-announcement"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--accent-amber) 8%, var(--panel))",
      }}
    >
      {heading}
      {children}
    </div>
  )

  if (availability.state === "checking") {
    return shell(
      <p className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
        Checking this league…
      </p>,
    )
  }

  if (availability.state === "imported") {
    return shell(
      <p className="mt-1 text-[11px]" style={{ color: "var(--muted2)" }} data-testid="commissioner-announcement-unavailable">
        There&apos;s no league chat here to post to. This league runs on {platformLabel(availability.platform)}, so
        its chat lives there — post your announcement on {platformLabel(availability.platform)}.
      </p>,
    )
  }

  if (availability.state === "not_commissioner") {
    return shell(
      <p className="mt-1 text-[11px]" style={{ color: "var(--muted2)" }} data-testid="commissioner-announcement-unavailable">
        Only this league&apos;s commissioner or a co-commissioner can send announcements.
      </p>,
    )
  }

  return shell(
    <>
      <p className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
        Lands in league chat as a commissioner announcement, and everyone gets pinged unless your league has announcement alerts switched off.
      </p>
      <textarea
        value={announcement}
        onChange={(e) => setAnnouncement(e.target.value)}
        data-testid="commissioner-announcement-input"
        aria-label="Commissioner announcement"
        placeholder="Trade deadline is Sunday 11:59 PM ET. Get your offers in."
        maxLength={MAX_LENGTH}
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none"
        style={{
          borderColor: "var(--border)",
          background: "var(--panel2)",
          color: "var(--text)",
        }}
      />
      {error && (
        <p className="mt-1 text-[10px]" role="alert" style={{ color: "var(--accent-red-strong)" }}>
          {error}
        </p>
      )}
      {sentNote && !error && (
        <p className="mt-1 text-[10px]" role="status" style={{ color: "var(--accent-amber-strong)" }}>
          {sentNote}
        </p>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!announcement.trim() || sending}
        data-testid="commissioner-announcement-send"
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
        style={{
          borderColor: "var(--accent-amber-strong)",
          color: "var(--accent-amber-strong)",
          background: "color-mix(in srgb, var(--accent-amber) 15%, transparent)",
        }}
      >
        <Send className="h-3.5 w-3.5" />
        {sending ? "Sending…" : "Send @everyone"}
      </button>
    </>,
  )
}
