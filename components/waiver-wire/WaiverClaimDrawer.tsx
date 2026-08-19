"use client"

import { useState, useEffect } from "react"
import { X, DollarSign, ArrowDownCircle } from "lucide-react"
import {
  canSubmitClaim,
  clampFaabBid,
  getClaimSummary,
  normalizePriorityOrder,
  parseOptionalNumber,
} from "@/lib/waiver-wire/WaiverClaimFlowController"

type RosterOption = { id: string; name?: string | null }

type DrawerProps = {
  open: boolean
  onClose: () => void
  player: { id: string; name: string; position: string | null; team: string | null } | null
  faabMode: boolean
  faabRemaining: number | null
  hasOpenRosterSpot?: boolean
  onSubmit: (opts: { dropPlayerId: string | null; faabBid: number | null; priorityOrder: number | null }) => Promise<void> | void
  rosterPlayerIds: string[]
  /** Optional roster options with display names for the drop selector. When provided, options show name (fallback: id). */
  rosterPlayers?: RosterOption[]
}

export default function WaiverClaimDrawer({
  open,
  onClose,
  player,
  faabMode,
  faabRemaining,
  hasOpenRosterSpot = true,
  onSubmit,
  rosterPlayerIds,
  rosterPlayers,
}: DrawerProps) {
  const dropOptions = rosterPlayers?.length ? rosterPlayers : rosterPlayerIds.map((id) => ({ id, name: null }))
  const getDropLabel = (opt: RosterOption) => (opt.name?.trim() ? `${opt.name} (${opt.id})` : opt.id)
  const [dropId, setDropId] = useState<string>("")
  const [bid, setBid] = useState<string>("")
  const [priority, setPriority] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setDropId("")
      setBid("")
      setPriority("")
      setSubmitting(false)
    }
  }, [open])

  if (!open || !player) return null

  const claimValidation = canSubmitClaim({
    dropPlayerId: dropId || null,
    rosterPlayerIds,
    hasOpenRosterSpot,
  })
  const normalizedBid =
    faabMode && bid !== "" ? clampFaabBid(parseOptionalNumber(bid) ?? 0, faabRemaining) : null
  const claimSummary = getClaimSummary(player.name, dropId || null, normalizedBid)

  const handleSubmit = async () => {
    if (submitting || !claimValidation.valid) return
    setSubmitting(true)
    try {
      const faabBid = normalizedBid
      const priorityOrder = normalizePriorityOrder(priority)
      await onSubmit({
        dropPlayerId: dropId || null,
        faabBid,
        priorityOrder,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const content = (
    <div className="w-full max-w-md rounded-t-2xl border border-white/15 bg-black/95 p-4 shadow-2xl sm:h-full sm:max-w-md sm:rounded-none sm:border-l sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-white/50">Waiver claim</p>
          <h2 className="text-sm font-semibold text-white">
            Add {player.name}{" "}
            <span className="text-xs text-white/60">
              {player.position} · {player.team || "FA"}
            </span>
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 text-white/60 hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 space-y-3 text-xs text-white/80">
        <div>
          <label className="mb-1 block text-[11px] text-white/60">Drop player (optional)</label>
          <div className="flex items-center gap-2">
            <ArrowDownCircle className="h-3.5 w-3.5 text-white/40" />
            <select
              value={dropId}
              onChange={(e) => setDropId(e.target.value)}
              aria-label="Drop player selector"
              data-testid="waiver-drop-player-selector"
              className="flex-1 rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white outline-none"
            >
              <option value="">No drop (requires open roster spot)</option>
              {dropOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {getDropLabel(opt)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {faabMode && (
          <div>
            <label className="mb-1 block text-[11px] text-white/60">FAAB bid</label>
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-[#ff9ec0]" />
              <input
                type="number"
                min={0}
                max={faabRemaining ?? undefined}
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                aria-label="FAAB bid input"
                data-testid="waiver-faab-bid-input"
                className="w-24 rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white outline-none"
              />
              {faabRemaining != null && (
                <span className="text-[11px] text-[#ffb8d1]">Remaining: {faabRemaining}</span>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-[11px] text-white/60">Claim priority (optional)</label>
          <input
            type="number"
            min={0}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            aria-label="Claim priority input"
            data-testid="waiver-claim-priority-input"
            className="w-28 rounded-lg border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white outline-none"
          />
        </div>

        <div className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] text-white/70">
          <span className="text-white/50">Claim summary:</span>{" "}
          <span data-testid="waiver-claim-summary">{claimSummary}</span>
        </div>
        {!claimValidation.valid && (
          <p className="text-[11px] text-amber-300" data-testid="waiver-claim-validation-message">
            {claimValidation.reason}
          </p>
        )}
        <p className="mt-1 text-[11px] text-white/50">
          Claims will be processed according to your league&apos;s waiver settings. AI suggestions are advisory only and do
          not guarantee that a claim will succeed.
        </p>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          data-testid="waiver-claim-cancel"
          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !claimValidation.valid}
          data-testid="waiver-claim-submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#ff3d81] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#ff3d81] disabled:opacity-60"
        >
          {submitting && (
            <span className="h-3 w-3 animate-spin rounded-full border border-black/10 border-t-black" />
          )}
          Confirm claim
        </button>
      </div>
    </div>
  )

  return (
    <>
      <button
        type="button"
        aria-label="Close waiver claim drawer"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
      />
      <div className="fixed inset-x-0 bottom-0 z-50 sm:inset-y-0 sm:right-0 sm:left-auto" data-testid="waiver-claim-drawer">
        {content}
      </div>
    </>
  )
}

