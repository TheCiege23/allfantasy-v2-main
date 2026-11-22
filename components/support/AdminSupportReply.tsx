"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { SUPPORT_MESSAGE_MAX, type SupportStatus } from "@/lib/support/supportInboxCore"

/** The admin inbox's reply box and close / reopen button (app/admin/support). Refreshes the page after. */
export function AdminSupportReply({ threadId, status }: { threadId: string; status: SupportStatus }) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/admin/support/${encodeURIComponent(threadId)}`

  async function call(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? "That did not go through.")
        return false
      }
      router.refresh()
      return true
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4" data-testid="admin-support-reply">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={SUPPORT_MESSAGE_MAX}
        placeholder="Reply as AllFantasy Support…"
        aria-label="Reply"
        className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={async () => {
            if (await call("POST", { message: text })) setText("")
          }}
          className="rounded-xl bg-cyan-400 px-3 py-2 text-sm font-bold text-[#020817] disabled:opacity-50"
        >
          Send reply
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void call("PATCH", { status: status === "closed" ? "open" : "closed" })}
          className="rounded-xl border border-white/20 px-3 py-2 text-sm text-white/80 disabled:opacity-50"
        >
          {status === "closed" ? "Reopen" : "Close"}
        </button>
        {error ? <span className="text-sm text-rose-300" role="alert">{error}</span> : null}
      </div>
    </div>
  )
}
