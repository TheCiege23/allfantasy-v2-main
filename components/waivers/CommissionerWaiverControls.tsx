"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Lock, Play, Unlock } from "lucide-react"
import { toast } from "sonner"
import { invalidateIntelligence } from "@/lib/dashboard/intelligence-events"

type Props = {
  leagueId: string
  /** Refresh parent waiver data after actions */
  onAfterAction?: () => void
}

/**
 * Commissioner-only: run waivers now, lock/unlock claim submission (uses commissioner API + state endpoint).
 */
export default function CommissionerWaiverControls({ leagueId, onAfterAction }: Props) {
  const [visible, setVisible] = useState(false)
  const [processingLocked, setProcessingLocked] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const refreshState = useCallback(async () => {
    const res = await fetch(`/api/waiver-wire/leagues/${leagueId}/state`)
    if (!res.ok) return
    const data = await res.json().catch(() => ({}))
    setProcessingLocked(Boolean(data?.state?.processingLocked))
  }, [leagueId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [commRes, stateRes] = await Promise.all([
        fetch(`/api/commissioner/leagues/${leagueId}/waivers?type=settings`),
        fetch(`/api/waiver-wire/leagues/${leagueId}/state`),
      ])
      if (cancelled) return
      setVisible(commRes.ok)
      if (stateRes.ok) {
        const data = await stateRes.json().catch(() => ({}))
        setProcessingLocked(Boolean(data?.state?.processingLocked))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const runAction = async (action: "lock_waivers" | "unlock_waivers" | "process") => {
    const key = action
    setBusy(key)
    try {
      if (action === "process") {
        const res = await fetch(`/api/commissioner/leagues/${leagueId}/waivers`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "process" }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(typeof json?.error === "string" ? json.error : "Failed to process waivers")
          return
        }
        toast.success(`Processed ${json.processed ?? 0} claim result(s).`)
        // Phase 3B.5: notify intelligence rail after waivers process (roster-changing).
        invalidateIntelligence({ leagueId, reason: "waiver_claim" })
      } else {
        const res = await fetch(`/api/commissioner/leagues/${leagueId}/waivers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(typeof json?.error === "string" ? json.error : "Action failed")
          return
        }
        setProcessingLocked(Boolean(json.processingLocked))
        toast.success(action === "lock_waivers" ? "Waiver claims locked." : "Waiver claims unlocked.")
      }
      await refreshState()
      onAfterAction?.()
    } finally {
      setBusy(null)
    }
  }

  if (!visible) return null

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100"
      data-testid="commissioner-waiver-controls"
    >
      <span className="font-medium text-amber-50/90">Commish</span>
      <button
        type="button"
        disabled={busy != null}
        onClick={() => runAction("process")}
        className="inline-flex items-center gap-1 rounded border border-amber-300/50 px-2 py-0.5 text-[11px] hover:bg-amber-500/20 disabled:opacity-50"
      >
        {busy === "process" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        Run waivers
      </button>
      {processingLocked ? (
        <button
          type="button"
          disabled={busy != null}
          onClick={() => runAction("unlock_waivers")}
          className="inline-flex items-center gap-1 rounded border border-emerald-400/40 px-2 py-0.5 text-[11px] text-emerald-100 hover:bg-emerald-500/15 disabled:opacity-50"
        >
          {busy === "unlock_waivers" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
          Unlock claims
        </button>
      ) : (
        <button
          type="button"
          disabled={busy != null}
          onClick={() => runAction("lock_waivers")}
          className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-0.5 text-[11px] hover:bg-white/10 disabled:opacity-50"
        >
          {busy === "lock_waivers" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
          Lock claims
        </button>
      )}
    </div>
  )
}
