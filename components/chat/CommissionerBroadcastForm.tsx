"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { CalendarClock, Megaphone, Send } from "lucide-react"

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
 *
 * SCHEDULE FOR LATER (2026-10-19, spec §2.1): the same announcement, posted at a time the commissioner
 * picks, through `/api/commissioner/leagues/:id/scheduled-announcements`. The list under the box shows
 * what is waiting, with Cancel, and what posted or failed (and why).
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

type Scheduled = { id: string; message: string; sendAt: string; status: string; reason?: string }

/** The `<input type="datetime-local">` value for a Date, in the viewer's own time zone. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function whenText(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : iso
}

const STATUS_TEXT: Record<string, string> = {
  pending: "Scheduled",
  sending: "Posting now",
  sent: "Posted",
  failed: "Didn't post",
  cancelled: "Cancelled",
}

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
  const [mode, setMode] = useState<"now" | "later">("now")
  const [sendAtLocal, setSendAtLocal] = useState("")
  const [scheduled, setScheduled] = useState<Scheduled[]>([])
  const scheduleUrl = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/scheduled-announcements`

  const loadScheduled = useCallback(async () => {
    try {
      const res = await fetch(scheduleUrl, { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json().catch(() => null)) as { announcements?: Scheduled[] } | null
      setScheduled(Array.isArray(data?.announcements) ? data.announcements : [])
    } catch {
      /* the list is a convenience; sending still works */
    }
  }, [scheduleUrl])

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

  useEffect(() => {
    if (availability.state === "ready") void loadScheduled()
  }, [availability.state, loadScheduled])

  const handleSchedule = async (text: string) => {
    const at = new Date(sendAtLocal)
    if (!sendAtLocal || !Number.isFinite(at.getTime())) {
      setError("Pick a date and time for the post.")
      return
    }
    setSending(true)
    try {
      const res = await fetch(scheduleUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, sendAt: at.toISOString() }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; announcement?: Scheduled }
      if (!res.ok || !data.announcement) {
        setError(data?.error || "That didn't schedule. Give it another shot in a moment.")
        return
      }
      setAnnouncement("")
      setSendAtLocal("")
      setSentNote(`Scheduled for ${whenText(data.announcement.sendAt)}. It posts within 15 minutes of that time.`)
      await loadScheduled()
    } catch {
      setError("Connection dropped before it saved. Your message is still here.")
    } finally {
      setSending(false)
    }
  }

  const cancel = async (id: string) => {
    setError(null)
    setSentNote(null)
    try {
      const res = await fetch(`${scheduleUrl}?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(data?.error || "That didn't cancel. Give it another shot in a moment.")
      else setSentNote("Cancelled. It won't post.")
    } catch {
      setError("Connection dropped before it cancelled.")
    }
    await loadScheduled()
  }

  const handleSubmit = async () => {
    const text = announcement.trim()
    if (!text || sending) return
    setError(null)
    setSentNote(null)
    if (mode === "later") {
      await handleSchedule(text)
      return
    }
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
      <p className="mt-1 text-[11px]" style={{ color: "var(--muted2)" }}>
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
      <p className="mt-1 text-[11px]" style={{ color: "var(--muted2)" }}>
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
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]" role="radiogroup" aria-label="When to post">
        {(["now", "later"] as const).map((m) => (
          <label key={m} className="inline-flex min-h-[32px] items-center gap-1.5" style={{ color: "var(--text)" }}>
            <input
              type="radio"
              name={`announce-when-${leagueId}`}
              checked={mode === m}
              onChange={() => setMode(m)}
              data-testid={`commissioner-announcement-when-${m}`}
            />
            {m === "now" ? "Send now" : "Schedule"}
          </label>
        ))}
        {mode === "later" && (
          <input
            type="datetime-local"
            value={sendAtLocal}
            min={toLocalInputValue(new Date(Date.now() + 15 * 60 * 1000))}
            onChange={(e) => setSendAtLocal(e.target.value)}
            aria-label="Post at"
            data-testid="commissioner-announcement-send-at"
            className="min-h-[32px] rounded-lg border px-2 py-1 text-[11px]"
            style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
          />
        )}
      </div>
      {error && (
        <p className="mt-1 text-[11px]" role="alert" style={{ color: "var(--accent-red-strong)" }}>
          {error}
        </p>
      )}
      {sentNote && !error && (
        <p className="mt-1 text-[11px]" role="status" style={{ color: "var(--accent-amber-strong)" }}>
          {sentNote}
        </p>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!announcement.trim() || sending || (mode === "later" && !sendAtLocal)}
        data-testid="commissioner-announcement-send"
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
        style={{
          borderColor: "var(--accent-amber-strong)",
          color: "var(--accent-amber-strong)",
          background: "color-mix(in srgb, var(--accent-amber) 15%, transparent)",
        }}
      >
        {mode === "later" ? <CalendarClock className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
        {mode === "later" ? (sending ? "Scheduling…" : "Schedule @everyone") : sending ? "Sending…" : "Send @everyone"}
      </button>
      {scheduled.length > 0 && (
        <ul className="mt-3 space-y-1.5" data-testid="commissioner-announcement-scheduled">
          {scheduled.map((a) => (
            <li
              key={a.id}
              className="flex items-start justify-between gap-2 rounded-lg border px-2 py-1.5 text-[11px]"
              style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
              data-testid="commissioner-announcement-scheduled-row"
            >
              <span className="min-w-0" style={{ color: "var(--text)" }}>
                <span className="font-semibold">{STATUS_TEXT[a.status] ?? a.status}</span>
                {" · "}
                {whenText(a.sendAt)}
                <span className="block truncate" style={{ color: "var(--muted2)" }}>{a.message}</span>
                {a.reason && a.status === "failed" && (
                  <span className="block" style={{ color: "var(--accent-red-strong)" }}>{a.reason}</span>
                )}
              </span>
              {a.status === "pending" && (
                <button
                  type="button"
                  onClick={() => void cancel(a.id)}
                  className="min-h-[32px] shrink-0 rounded-lg border px-2 text-[11px]"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>,
  )
}
