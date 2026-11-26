"use client"

import { useState, useEffect } from "react"
import { X, DollarSign, ArrowDownCircle } from "lucide-react"
import {
  canSubmitClaim,
  clampFaabBid,
  normalizePriorityOrder,
  parseOptionalNumber,
} from "@/lib/waiver-wire/WaiverClaimFlowController"
import { useHoldUnsavedWork } from "@/lib/core-app/unsavedWork"
import { PlayerAvatar } from "@/components/app/draft-room/PlayerAvatar"

type RosterOption = { id: string; name?: string | null }

type DrawerProps = {
  open: boolean
  onClose: () => void
  /** `headshotUrl` / `teamLogoUrl` are optional: without them the header shows initials and the team abbreviation. */
  player: { id: string; name: string; position: string | null; team: string | null; headshotUrl?: string | null; teamLogoUrl?: string | null } | null
  faabMode: boolean
  faabRemaining: number | null
  hasOpenRosterSpot?: boolean
  onSubmit: (opts: { dropPlayerId: string | null; faabBid: number | null; priorityOrder: number | null }) => Promise<void> | void
  rosterPlayerIds: string[]
  /** Optional roster options with display names for the drop selector. When provided, options show name (fallback: id). */
  rosterPlayers?: RosterOption[]
  /**
   * The player is a free agent being added now, not claimed: the sheet says "Add player", asks for
   * no claim priority and its button reads "Add". Absent, it is a waiver claim as before.
   */
  immediate?: boolean
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
  immediate = false,
}: DrawerProps) {
  const dropOptions = rosterPlayers?.length ? rosterPlayers : rosterPlayerIds.map((id) => ({ id, name: null }))
  // The name alone: a roster id means nothing to a manager. The id is the fallback when no name is known.
  const getDropLabel = (opt: RosterOption) => opt.name?.trim() || opt.id
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

  // A claim being composed (drop, bid, priority): no deploy reload while it is (lib/core-app/unsavedWork).
  useHoldUnsavedWork(open && !!player)

  if (!open || !player) return null

  const claimValidation = canSubmitClaim({
    dropPlayerId: dropId || null,
    rosterPlayerIds,
    hasOpenRosterSpot,
  })
  const normalizedBid =
    faabMode && bid !== "" ? clampFaabBid(parseOptionalNumber(bid) ?? 0, faabRemaining) : null

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

  const needsDrop = !hasOpenRosterSpot
  const dropLabel = dropId ? getDropLabel(dropOptions.find((o) => o.id === dropId) ?? { id: dropId }) : null
  const content = (
    <div
      className="af-core af-league-transactions af-claim-panel flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl border border-[var(--line2)] bg-[var(--surface2)] shadow-2xl sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:border-l"
      role="dialog"
      aria-modal="true"
      aria-label={immediate ? `Add ${player.name}` : `Waiver claim for ${player.name}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line2)] p-4">
        <div className="flex min-w-0 items-center gap-3">
        <PlayerAvatar
          headshotUrl={player.headshotUrl ?? null}
          displayName={player.name}
          teamLogoUrl={player.teamLogoUrl ?? null}
          teamAbbr={player.team && player.team.toUpperCase() !== "FA" ? player.team : null}
          position={player.position}
          size={44}
          testIdBase="waiver-claim-avatar"
        />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{immediate ? "Add player" : "Waiver claim"}</p>
          <h2 className="truncate text-base font-semibold text-[var(--text)]">Add {player.name}</h2>
          <p className="text-xs text-[var(--muted)]">
            {player.position} · {player.team || "FA"}
          </p>
        </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close waiver claim"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--line2)] text-[var(--muted)] hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm text-[var(--muted)]">
        <div>
          <label className="mb-1.5 block text-xs text-[var(--muted)]" htmlFor="waiver-drop-player">
            {needsDrop ? "Your roster is full. Choose a player to drop" : "Drop a player (optional)"}
          </label>
          <div className="flex items-center gap-2">
            <ArrowDownCircle className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <select
              id="waiver-drop-player"
              value={dropId}
              onChange={(e) => setDropId(e.target.value)}
              aria-label="Drop player selector"
              data-testid="waiver-drop-player-selector"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 text-sm text-[var(--text)] outline-none"
            >
              <option value="">{needsDrop ? "Choose a player" : "No drop"}</option>
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
            <label className="mb-1.5 block text-xs text-[var(--muted)]" htmlFor="waiver-faab-bid">
              FAAB bid
            </label>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              <input
                id="waiver-faab-bid"
                type="number"
                inputMode="numeric"
                min={0}
                max={faabRemaining ?? undefined}
                value={bid}
                onChange={(e) => setBid(e.target.value)}
                aria-label="FAAB bid input"
                data-testid="waiver-faab-bid-input"
                className="min-h-11 w-28 rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 text-sm text-[var(--text)] outline-none"
              />
              {faabRemaining != null && <span className="text-xs text-[var(--accent)]">${faabRemaining} remaining</span>}
            </div>
          </div>
        )}

        {/* A free agent is added now; only a claim waits in an order. */}
        {!immediate && (
          <div>
            <label className="mb-1.5 block text-xs text-[var(--muted)]" htmlFor="waiver-claim-priority">
              Claim order (optional): 1 runs first
            </label>
            <input
              id="waiver-claim-priority"
              type="number"
              inputMode="numeric"
              min={0}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              aria-label="Claim priority input"
              data-testid="waiver-claim-priority-input"
              className="min-h-11 w-28 rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 text-sm text-[var(--text)] outline-none"
            />
          </div>
        )}

        <div className="rounded-lg border border-[var(--line2)] bg-[var(--surface2)] px-3 py-2.5 text-xs text-[var(--text)]">
          <span className="text-[var(--muted)]">{immediate ? "Summary:" : "Claim summary:"}</span>{" "}
          <span data-testid="waiver-claim-summary">
            Add {player.name}
            {dropLabel ? ` · drop ${dropLabel}` : ""}
            {normalizedBid != null ? ` · $${normalizedBid} bid` : ""}
          </span>
        </div>
        {!claimValidation.valid && (
          <p className="text-xs text-amber-300" data-testid="waiver-claim-validation-message">
            {claimValidation.reason}
          </p>
        )}
        {!immediate && (
          <p className="text-xs text-[var(--muted)]">
            Claims are processed by your league&apos;s waiver settings. Chimmy suggestions are advice only and do not
            guarantee a claim succeeds.
          </p>
        )}
      </div>

      {/* Always on screen: the buttons used to sit at the end of the body, under the league's tab bar. */}
      <div className="flex items-center gap-2 border-t border-[var(--line2)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          data-testid="waiver-claim-cancel"
          className="min-h-12 rounded-xl border border-[var(--line2)] px-4 text-sm text-[var(--muted)] hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !claimValidation.valid}
          data-testid="waiver-claim-submit"
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--bg)] disabled:opacity-60"
        >
          {submitting && <span className="h-3.5 w-3.5 animate-spin rounded-full border border-black/10 border-t-black" />}
          {immediate ? (dropId ? "Add and drop" : "Add player") : "Confirm claim"}
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
        className="fixed inset-0 z-[1190] bg-black/50 backdrop-blur-[1px]"
      />
      {/* Above the league's bottom tab bar and the chat bubbles, which sat over the sheet's buttons. */}
      <div className="fixed inset-x-0 bottom-0 z-[1200] flex justify-center sm:inset-y-0 sm:right-0 sm:left-auto" data-testid="waiver-claim-drawer">
        {content}
      </div>
    </>
  )
}

