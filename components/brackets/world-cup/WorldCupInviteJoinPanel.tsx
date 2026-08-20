"use client"

import { useRouter } from "next/navigation"
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
} from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"

export type InvitePreviewPayload = {
  inviteCode: string
  challengeId: string
  name: string
  ownerName: string
  seasonYear: number
  participantCount: number
  status: string
  visibility: string
  joinPreview?: {
    requiresJoinPassword: boolean
    joinBlockedReason: "full" | "locked_no_late_join" | null
    poolLocked: boolean
    allowLateJoin: boolean
    isFull: boolean
    maxParticipants: number
  }
}

export type WorldCupInviteJoinPanelHandle = {
  previewInvite: (inviteCode: string) => Promise<void>
}

const WorldCupInviteJoinPanel = forwardRef<
  WorldCupInviteJoinPanelHandle,
  {
    title?: string
    initialCode?: string
    onPreviewLoaded?: () => void
  }
>(function WorldCupInviteJoinPanel({ title = "Join with invite code", initialCode = "", onPreviewLoaded }, ref) {
  const router = useRouter()
  const [code, setCode] = useState(initialCode)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [preview, setPreview] = useState<InvitePreviewPayload | null>(null)
  const [password, setPassword] = useState("")
  const [joining, setJoining] = useState(false)

  const loadPreview = useCallback(
    async (inviteCode: string) => {
      const trimmed = inviteCode.trim().toUpperCase()
      if (trimmed.length < 4) {
        toast.error("Enter a valid invite code")
        return
      }
      setLoadingPreview(true)
      try {
        const res = await fetch(`/api/brackets/world-cup/invite/${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error((data as { error?: string }).error || "Invite not found")
          setPreview(null)
          return
        }
        setPreview(data.invite as InvitePreviewPayload)
        setCode(trimmed)
        setPassword("")
        onPreviewLoaded?.()
      } finally {
        setLoadingPreview(false)
      }
    },
    [onPreviewLoaded]
  )

  useImperativeHandle(
    ref,
    () => ({
      previewInvite: (inviteCode: string) => loadPreview(inviteCode),
    }),
    [loadPreview]
  )

  const lookup = useCallback(() => void loadPreview(code), [code, loadPreview])

  const join = useCallback(async () => {
    if (!preview?.inviteCode) return
    const blocked = preview.joinPreview?.joinBlockedReason
    if (blocked) {
      toast.error(
        blocked === "full"
          ? "This pool is full."
          : "This pool is closed to new players."
      )
      return
    }
    setJoining(true)
    try {
      const res = await fetch(`/api/brackets/world-cup/invite/${encodeURIComponent(preview.inviteCode)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinPassword: preview.joinPreview?.requiresJoinPassword ? password : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error((data as { error?: string }).error || "Could not join")
        return
      }
      const entryId = (data as { entryId?: string }).entryId
      const challengeId = (data as { challengeId?: string }).challengeId ?? preview.challengeId
      toast.success("You're in — Bracket 1 is ready.")
      const qs = new URLSearchParams()
      qs.set("guided", "1")
      if (entryId) qs.set("entry", entryId)
      router.push(`/brackets/world-cup/${challengeId}?${qs.toString()}`)
      router.refresh()
    } finally {
      setJoining(false)
    }
  }, [password, preview, router])

  return (
    <div data-testid="world-cup-invite-join-panel" className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-white/45">{title}</h3>
      <p className="mt-1 text-xs text-white/45">
        Enter the invite code from your commissioner. Password-protected pools require the join password set in pool
        settings.
      </p>
      <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input
          data-testid="world-cup-join-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="WCUP invite code"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 touch-manipulation rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm font-mono text-white sm:min-w-[200px]"
        />
        <button
          type="button"
          data-testid="world-cup-join-lookup"
          disabled={loadingPreview}
          onClick={() => void lookup()}
          className="inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-4 py-2.5 text-xs font-bold text-white sm:min-h-0 sm:py-2"
        >
          {loadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Preview
        </button>
      </div>

      {preview ? (
        <div
          data-testid="world-cup-join-preview"
          className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4"
        >
          <p className="text-sm font-black text-white">{preview.name}</p>
          <p className="mt-1 text-xs text-white/55">
            Host: {preview.ownerName} · {preview.participantCount} playing · {preview.visibility}
          </p>
          {preview.joinPreview?.joinBlockedReason === "full" ? (
            <p className="mt-2 text-xs font-bold text-rose-200">This pool is full.</p>
          ) : null}
          {preview.joinPreview?.joinBlockedReason === "locked_no_late_join" ? (
            <p className="mt-2 text-xs font-bold text-rose-200">
              Pool locked — not accepting new players.
            </p>
          ) : null}
          {preview.joinPreview?.requiresJoinPassword ? (
            <label className="mt-3 block text-xs text-white/70">
              Join password
              <input
                type="password"
                data-testid="world-cup-join-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              />
            </label>
          ) : null}
          <button
            type="button"
            data-testid="world-cup-join-submit"
            disabled={
              joining ||
              Boolean(preview.joinPreview?.joinBlockedReason) ||
              (preview.joinPreview?.requiresJoinPassword && password.trim().length === 0)
            }
            onClick={() => void join()}
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-cyan-300 py-2.5 text-xs font-black text-black disabled:opacity-40"
          >
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join Pool"}
          </button>
        </div>
      ) : null}
    </div>
  )
})

export default WorldCupInviteJoinPanel

WorldCupInviteJoinPanel.displayName = "WorldCupInviteJoinPanel"
